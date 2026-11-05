# Secret & key rotation runbook — Baanzon Chat

All secrets live in pod `.env` (`/workspace/baanzon/.env`). Every rotation below is
`change env -> supervisorctl restart baanzon-api` unless noted. Downtime: one restart (~45s).
Rotate quarterly, immediately after any suspected leak, and whenever an operator with access leaves.

## What rotates and how

| Secret | Used by | Rotation steps | User impact |
|---|---|---|---|
| `JWT_SECRET` (+ `JWT_REFRESH_SECRET`) | Access/refresh tokens | 1. Add the new value as `JWT_SECRET` (replacing old). 2. Restart. All existing tokens invalidate — users sign in again. For zero-downtime rotation set `JWT_SECRET_OLD` if the auth stack supports secondary verify (check `packages/api` auth), else accept the re-login. | Everyone re-logs in |
| `MEILI_MASTER_KEY` | Meilisearch | Rotate inside Meili first (`PATCH /indexes` re-key is not supported — dump + reimport with new key), then update `.env` and restart both meilisearch and baanzon-api. High effort: only rotate on leak. | Search briefly unavailable |
| `OPRAIZ_API_KEY` (CF Workers AI token) | All chat inference | Create a new token in the CF dashboard with Workers AI permission -> update `.env` -> restart. Old token revokes at CF. | None if done in order |
| `CF_API_TOKEN` / `CF_ACCOUNT_ID` | Image gen, CF zone ops | Same as above (CF dashboard -> Roll token). | None |
| `RUNPOD_API_KEY` | vLLM fallback gateway | RunPod console -> API Keys -> rotate -> update `RUNPOD_API_KEY` in `.env`. | None (idle path) |
| `DODO_API_KEY` + `DODO_WEBHOOK_SECRET` | Payments + webhook auth | Dodo dashboard -> API keys. Update `.env`. Webhook secret must match Dodo's webhook config (Standard Webhooks HMAC). | New checkouts only |
| `MONGO_INITDB_ROOT_PASSWORD` | MongoDB | mongod admin rotation: create new user, switch `MONGO_URI`, drop old user. Multi-step — schedule a window. | Brief |
| `MEILI_MASTER_KEY` see above | | | |
| `SEARXNG_INSTANCE_URL` | Deep research search | Self-hosted; rotate only if exposed publicly (it is 127.0.0.1-only). | None |
| `ZEPTOMAIL_API_KEY` (`EMAIL_PASSWORD`) | Outbound email | Zoho ZeptoMail -> SMTP credentials -> new key. **No spaces in the .env line** (values truncate at space). | None |
| `CFAT_*` Page Shield / R2 tokens | Backups, R2 | CF dashboard -> API Tokens -> roll. Update `.env` lines (`CF_API_TOKEN`, R2 keys in backup script env). | Backups continue next cycle |

## Which secrets NOT to rotate without migration

- `ENCRYPTION_KEY`-class values (if present): encrypting stored data (2FA secrets, API keys). Rotating
  without re-encrypting data bricks stored secrets. Check `packages/data-schemas` crypto usage first.

## Emergency leak procedure

1. Rotate the leaked secret at its provider (revoke old).
2. Update pod `.env`, restart.
3. If a JWT/session secret leaked: rotate AND force logout-all (admin: invalidate sessions).
4. Record the incident in `docs/AUDIT-2026-11-05.md`.

## Verification after any rotation

- `curl -A "Mozilla/5.0" https://baanzonchat.opraiz.com/readyz` -> `{"status":"ok",...}`
- One chat round-trip (login -> send -> reply streams).
- One login from a fresh private window (JWT path).
