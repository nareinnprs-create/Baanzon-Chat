# DR Runbook — Baanzon Chat pod (squrllcijupg4p)

Single-pod deployment. Code is rebuildable from CI (`b1` → Validate → Deploy,
blue-green apply). State lives on the pod's NFS volume and is what DR protects.

## What exists today

| Asset | Location | Purpose |
|---|---|---|
| `db-backup` supervisor program | pod, `/workspace/tools/db-backup.sh` | Nightly: `mongodump --archive` + tar of the active slot's `uploads/` + Meili HTTP dump, all pushed to R2 with 7-nightly retention per prefix; log `/workspace/logs/db-backup.log` |
| Mongo restore | repo `scripts/dr-restore-mongo.sh` | `--drop` restore of a dump archive |
| NFS watchdog | pod, `/workspace/tools/nfs-watchdog.sh` | Kills frozen node pids after 3 slow cycles, revives FATAL supervisor programs |
| Blue-green slots | pod | blue `/workspace/baanzon`:3090, green `/workspace/baanzon-next`:3091; `/workspace/data/active-port` selects; inactive slot is instant rollback |
| Gate | pod `/workspace/gate/pod-gate.js`:3080 | Cloudflared target; always proxies the active slot |
| CI rebuild | `.github/workflows/deploy.yml` | Fresh tarball + `npm ci` + readyz gate + flip; pod `.env` carried forward from the active slot |

## Incident procedures

### NFS degrade (boots/deploys crawl, rchar rate ≈ 0–20 KB/s)
1. Confirm progress: read `/proc/<pid>/io` twice 4s apart. **Never kill a process
   whose rchar/RSS is still growing** — patient boots complete.
2. If truly stuck, the proven fix is a pod stop/resume (resets the NFS session):
   `runpodctl pod stop squrllcijupg4p`, wait for EXITED, `runpodctl pod start squrllcijupg4p`.
   Expect ~5–10 min total outage; supervisor autostarts everything.
3. The Runpod console often lies (`initializing/awaiting_container` while the pod
   serves). Verify via SSH or the public URL, not the console.

### Bad release (flip completed, site broken)
The previous release stays in the inactive slot: set `active-port` to the other
slot, restart the inactive slot's program, and the gate serves the old release.
Roll the fix forward via CI afterwards.

### MongoDB restore
1. Pick the newest healthy archive: `ls -t /workspace/backups/mongo-*.gz | head -1`.
2. `bash scripts/dr-restore-mongo.sh <archive>` (drops + restores).
3. `supervisorctl restart baanzon-api`.

### Restore drill (repeatable, prod-safe)

`bash scripts/dr-drill-mongo.sh` restores the newest archive into a scratch db
(`drill_restore.*`), prints document counts, drops the scratch db. Last run:
2026-11-16 (PASS — update this line each time you drill).

## Known gaps (not yet implemented)

- **Off-pod `.env` snapshots are manual** — mongo/uploads/meili rotate nightly;
  push a fresh `env/env-<UTC>` whenever a secret changes.

## Backup layout (R2 bucket `baanzon-backups`)

| Key | Content | Retention |
|---|---|---|
| `mongo/mongo-<UTC>.gz` | mongodump archive | 7 daily, pruned by the loop |
| `uploads/uploads-<UTC>.tar.gz` | active slot's `uploads/` (it always holds the union — the apply copies uploads active→staged on every deploy) | 7 daily |
| `meili/meili-<UTC>.dump` | Meilisearch dump (consistent snapshot via its HTTP API) | 7 daily |
| `env/env-<UTC>` | full slot `.env` (all operator secrets) | manual pushes |

The backup loop reads the ACTIVE slot's `.env` (resolves via
`/workspace/data/active-port`) — safe across blue-green flips. Operator secrets
in R2 are protected by bucket access control; the `CF_TOKEN` that unlocks the
bucket lives in `.env` itself, so the snapshot and its key co-locate by design.
