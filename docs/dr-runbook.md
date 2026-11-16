# DR Runbook — Baanzon Chat pod (squrllcijupg4p)

Single-pod deployment. Code is rebuildable from CI (`b1` → Validate → Deploy,
blue-green apply). State lives on the pod's NFS volume and is what DR protects.

## What exists today

| Asset | Location | Purpose |
|---|---|---|
| `db-backup` supervisor program | pod, `/workspace/tools/db-backup.sh` | Nightly `mongodump --archive` to `/workspace/backups/`, 7-day retention, log `/workspace/logs/db-backup.log` |
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

## Known gaps (not yet implemented)

- **Off-pod backups**: the dump archive lives on the same NFS volume it protects.
  True DR needs the R2 push from `scripts/cloudflare-backup.sh`, which requires a
  Cloudflare API token with R2 write on bucket `baanzon-backups` (account
  `4e15812ef9050c3973a906ff4dbc386a`) in the pod `.env`.
- **Uploads/images and Meili snapshots** are not backed up yet.
- **`.env` secret store**: operator holds the values; nothing automated.
- **Restore drill**: has not been rehearsed end-to-end.
