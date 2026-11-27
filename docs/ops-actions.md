# Ops actions

Write counterpart to `GET /api/admin/ops-summary`, used by the OPRAIZ
Management console.

```
POST /api/admin/ops-action
Authorization: Bearer $OPS_SUMMARY_KEY
X-Ops-Actor: <operator id or email>        (required)

{ "action": "...", "target": "...", "params": { ... },
  "idempotencyKey": "...", "reason": "...", "confirm": "...", "dryRun": false }
```

The key is header-only and compared with `crypto.timingSafeEqual`. A missing or
short `OPS_SUMMARY_KEY` returns 401 for every request; a missing actor returns 400.

Response is the resulting state, never a bare `{ok:true}`:

```json
{
  "ok": true,
  "action": "user.set_role",
  "target": "<userId>",
  "changed": { "role": "ADMIN", "previousRole": "USER" },
  "auditId": "<ops_audit id>",
  "appliedAt": "<ISO>"
}
```

`dryRun: true` returns `changed`, `before`, `after` and `auditId: null` without
writing anything.

## Allow-list

| Action                   | Params                              | Destructive | Confirm           | Reason   | Status                           |
| ------------------------ | ----------------------------------- | ----------- | ----------------- | -------- | -------------------------------- |
| `user.suspend`           | —                                   | no          | —                 | —        | enabled (revokes sessions)       |
| `user.reactivate`        | —                                   | no          | —                 | —        | enabled                          |
| `user.set_role`          | `role`                              | no          | —                 | required | enabled                          |
| `user.reset_2fa`         | —                                   | no          | —                 | —        | enabled                          |
| `user.revoke_sessions`   | —                                   | no          | —                 | —        | enabled                          |
| `user.export`            | —                                   | no          | —                 | —        | **disabled** (no export worker)  |
| `user.delete`            | —                                   | **yes**     | `target` (userId) | required | enabled                          |
| `entitlement.set_plan`   | `plan` (`free/lite/pro/enterprise`) | no          | —                 | —        | enabled                          |
| `credits.grant`          | `amount`, `note`                    | no          | —                 | required | enabled                          |
| `credits.adjust`         | `amount` (signed), `note`           | **yes**     | `target`          | required | enabled                          |
| `model.assign`           | `product`, `layers[]`               | no          | —                 | —        | enabled                          |
| `search.reindex`         | —                                   | no          | —                 | —        | **disabled** (no reindex worker) |
| `cache.clear`            | `scope` (`config/overrides/all`)    | no          | —                 | —        | enabled                          |
| `announcement.broadcast` | `segment`, `message`                | **yes**     | `segment`         | required | enabled                          |
| `feature.toggle`         | `flag`, `enabled`                   | no          | —                 | —        | enabled                          |

Segments are explicit (`role:USER`, `role:ADMIN`, `plan:pro`, …). There is no
"all users" segment and no bulk user target.

`model.assign` validates every layer against the **live Cloudflare catalog**
(names + deprecation properties). A model that is absent or deprecated is
rejected; the assignment is persisted in `ops_settings` as
`model-assignment:<product>` and takes effect on the next config reload.

## Safety contract

1. Destructive actions require `confirm` to exactly echo the target (or the
   broadcast segment). Mismatch → 400, nothing applied.
2. `dryRun` validates and returns the projection without writing state or audit.
3. `idempotencyKey` (8–200 chars) is unique. Replaying the same key with the same
   body returns the first result; a different body returns 409.
4. `reason` (≥ 8 chars) is required for `credits.*`, `user.delete`,
   `user.set_role` and `announcement.broadcast`.
5. Every applied action writes exactly **one** `ops_audit` row **before** the
   mutation; if that write fails the action fails and nothing is applied.
6. Rate limits: 30 actions/minute per key, 5 destructive actions/hour per key.
7. Exactly one target per call.

## Audit shape (`ops_audit`)

```json
{
  "at": "<Date>",
  "actor": "ops@opraiz.com",
  "action": "user.delete",
  "target": "<userId>",
  "params": { "…": "…" },
  "before": { "id": "…", "role": "USER" },
  "after": { "deleted": true },
  "reason": "gdpr request",
  "idempotencyKey": "…",
  "status": "applied",
  "result": { "ok": true, "…": "…" }
}
```

`params.message` is stored as `{ "length": n }` — announcement bodies are never
persisted in the audit. No message text, titles, prompts, skill bodies, provider
keys, tokens or end-user IPs are written.
