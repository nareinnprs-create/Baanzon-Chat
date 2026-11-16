#!/bin/bash
# Nightly MongoDB backup loop (supervisor keeps this alive). 7-day local retention.
# Extracts MONGO_URI directly from .env (sourcing it breaks on the EMAIL_FROM line).
MONGO_URI=$(grep -m1 '^MONGO_URI=' /workspace/baanzon/.env | sed 's/^MONGO_URI=//; s/^"//; s/"$//')
mkdir -p /workspace/backups
while true; do
  NOW=$(date -u +%Y%m%d_%H%M%S)
  if [ -z "$MONGO_URI" ]; then
    echo "[$NOW] backup SKIPPED: no MONGO_URI"
  else
    S=$(date +%s)
    if /usr/local/bin/mongodump --uri "$MONGO_URI" --archive=/workspace/backups/mongo-$NOW.gz --gzip --quiet; then
      SZ=$(du -h /workspace/backups/mongo-$NOW.gz | cut -f1)
      echo "[$NOW] backup ok ${SZ} took $(( $(date +%s) - S ))s"
    else
      echo "[$NOW] backup FAILED rc=$?"
    fi
  fi
  ls -t /workspace/backups/mongo-*.gz 2>/dev/null | tail -n +8 | xargs -r rm -f
  sleep 86400
done
