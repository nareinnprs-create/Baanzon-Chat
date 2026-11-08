#!/bin/bash
# Baanzon Chat — Cloudflare R2 backup script
# Runs nightly via cron. Dumps MongoDB, tars uploads, pushes to R2 via CF API.
# Retention: 7 daily, 4 weekly, 3 monthly (auto-pruned).
set -e
cd /workspace

CF_TOKEN="__CF_TOKEN__"
CF_ACCOUNT="4e15812ef9050c3973a906ff4dbc386a"
BUCKET="baanzon-backups"
NOW=$(date -u +%Y-%m-%d_%H%M%S)
DOW=$(date -u +%u)  # 1=Mon..7=Sun
DOM=$(date -u +%d)
BACKUP_DIR=/tmp/baanzon-backup
mkdir -p "$BACKUP_DIR"

# 1) MongoDB dump
mongodump --uri "$MONGO_URI" --archive="$BACKUP_DIR/mongo-$NOW.gz" --gzip 2>/dev/null

# 2) Uploads/images backup
tar -czf "$BACKUP_DIR/uploads-$NOW.tar.gz" -C /workspace/baanzon images 2>/dev/null || true

# 3) Meilisearch data snapshot
curl -s -X POST "http://127.0.0.1:7700/dumps" -H "Authorization: Bearer $MEILI_MASTER_KEY" > /dev/null 2>&1 || true
sleep 3
latest_dump=$(ls -t /workspace/data/meili_data/dumps/*.dump 2>/dev/null | head -1)
[ -n "$latest_dump" ] && cp "$latest_dump" "$BACKUP_DIR/meili-$NOW.dump"

# 4) Push to R2 via CF API
upload_to_r2() {
  local file="$1" key="$2"
  curl -s -o /dev/null -w "%{http_code}" -X PUT \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/r2/buckets/$BUCKET/objects/$key" \
    -H "Authorization: Bearer $CF_TOKEN" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@$file"
}

echo "[$NOW] mongo: $(upload_to_r2 "$BACKUP_DIR/mongo-$NOW.gz" "mongo/mongo-$NOW.gz")"
echo "[$NOW] uploads: $(upload_to_r2 "$BACKUP_DIR/uploads-$NOW.tar.gz" "uploads/uploads-$NOW.tar.gz")"
[ -f "$BACKUP_DIR/meili-$NOW.dump" ] && echo "[$NOW] meili: $(upload_to_r2 "$BACKUP_DIR/meili-$NOW.dump" "meili/meili-$NOW.dump")"

# 5) Retention: prune old backups by listing and deleting
list_and_prune() {
  local prefix="$1" keep_count="$2"
  local objects
  objects=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/r2/buckets/$BUCKET/objects?prefix=$prefix&per_page=100" \
    -H "Authorization: Bearer $CF_TOKEN")
  # Extract keys + sort by date (they're ISO timestamps in the key)
  local sorted
  sorted=$(echo "$objects" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
      try {
        const j = JSON.parse(d);
        const keys = (j.result||[]).map(o=>({key:o.key,uploaded:o.uploaded})).sort((a,b)=>b.uploaded.localeCompare(a.uploaded));
        const toDelete = keys.slice($keep_count);
        for (const k of toDelete) console.log(k.key);
      } catch(e) {}
    })")
  for key in $sorted; do
    curl -s -o /dev/null -X DELETE \
      "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/r2/buckets/$BUCKET/objects/$key" \
      -H "Authorization: Bearer $CF_TOKEN"
    echo "pruned: $key"
  done
}

# Daily backups: keep 7
list_and_prune "mongo/mongo-" 7
list_and_prune "uploads/uploads-" 7
list_and_prune "meili/meili-" 7

# Weekly (Sunday): keep 4 — tag weekly backups by copying
if [ "$DOW" = "7" ]; then
  for f in "$BACKUP_DIR"/mongo-*.gz; do
    week=$(date -u +%Y-%U)
    upload_to_r2 "$f" "weekly/mongo-$week.gz"
  done
  list_and_prune "weekly/mongo-" 4
fi

# Monthly (1st): keep 3
if [ "$DOM" = "01" ]; then
  for f in "$BACKUP_DIR"/mongo-*.gz; do
    month=$(date -u +%Y-%m)
    upload_to_r2 "$f" "monthly/mongo-$month.gz"
  done
  list_and_prune "monthly/mongo-" 3
fi

rm -rf "$BACKUP_DIR"
echo "[$NOW] backup complete"
