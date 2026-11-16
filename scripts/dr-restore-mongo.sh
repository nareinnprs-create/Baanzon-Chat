#!/bin/bash
# Restore MongoDB from a mongodump archive produced by db-backup.sh.
# Usage: dr-restore-mongo.sh /workspace/backups/mongo-YYYYmmdd_HHMMSS.gz
# Assumes the pod's baanzon-api supervisor program is RUNNING (mongod must be up).
set -e
ARCHIVE="$1"
[ -x /usr/local/bin/mongodump ] || { echo "install mongodump first (see docs/dr-runbook.md)"; exit 1; }
[ -f "$ARCHIVE" ] || { echo "usage: $0 <mongo-*.gz archive>"; exit 1; }
MONGO_URI=$(grep -m1 '^MONGO_URI=' /workspace/baanzon/.env | sed 's/^MONGO_URI=//; s/^"//; s/"$//')
[ -n "$MONGO_URI" ] || { echo "no MONGO_URI in .env"; exit 1; }
echo "restoring $ARCHIVE ..."
mongorestore --uri "$MONGO_URI" --drop --archive="$ARCHIVE" --gzip
echo "restore complete. Restart the API to drop cached auth users:"
echo "  supervisorctl restart baanzon-api"
