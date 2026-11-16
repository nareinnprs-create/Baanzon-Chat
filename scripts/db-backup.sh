#!/bin/bash
# Nightly MongoDB backup loop (supervisor keeps this alive).
# Local: /workspace/backups (7-day retention). Off-pod: Cloudflare R2 bucket baanzon-backups.
# Vars are extracted directly from .env (sourcing it breaks on the EMAIL_FROM line).
ENVF=$( [ "$(cat /workspace/data/active-port 2>/dev/null)" = "3090" ] && echo /workspace/baanzon/.env || echo /workspace/baanzon-next/.env )
MONGO_URI=$(grep -m1 '^MONGO_URI=' "$ENVF" | sed 's/^MONGO_URI=//; s/^"//; s/"$//')
CF_TOKEN=$(grep -m1 '^CF_TOKEN=' "$ENVF" | sed 's/^CF_TOKEN=//; s/^"//; s/"$//')
CF_ACCOUNT=4e15812ef9050c3973a906ff4dbc386a
BUCKET=baanzon-backups
mkdir -p /workspace/backups

r2() { # r2 METHOD PATH [FILE] -> http code (PUT/DELETE) or body (GET)
  local m=$1 p=$2 f=$3
  if [ -n "$f" ]; then
    curl -s -o /dev/null -w '%{http_code}' -X "$m" \
      "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/r2/buckets/$BUCKET/objects/$p" \
      -H "Authorization: Bearer $CF_TOKEN" -H 'Content-Type: application/octet-stream' --data-binary "@$f"
  else
    curl -s -X "$m" "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/r2/buckets/$BUCKET/$p" \
      -H "Authorization: Bearer $CF_TOKEN"
  fi
}

r2_prune() { # keep newest N objects under prefix (keys sort chronologically)
  local prefix=$1 keep=$2
  r2 GET "objects?prefix=$prefix&per_page=100" | node -e "
    let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
      try{const j=JSON.parse(d);const ks=(j.result||[]).map(o=>o.key).sort().reverse();ks.slice($keep).forEach(k=>console.log(k));}catch(e){}
    })" | while read -r k; do
      [ -n "$k" ] && { r2 DELETE "objects/$k" >/dev/null; echo "pruned: $k"; }
    done
}

while true; do
  NOW=$(date -u +%Y%m%d_%H%M%S)
  if [ -z "$MONGO_URI" ]; then
    echo "[$NOW] backup SKIPPED: no MONGO_URI"
  else
    S=$(date +%s)
    if /usr/local/bin/mongodump --uri "$MONGO_URI" --archive=/workspace/backups/mongo-$NOW.gz --gzip --quiet; then
      SZ=$(du -h /workspace/backups/mongo-$NOW.gz | cut -f1)
      echo "[$NOW] backup ok ${SZ} took $(( $(date +%s) - S ))s"
      if [ -n "$CF_TOKEN" ]; then
        CODE=$(r2 PUT "mongo/mongo-$NOW.gz" "/workspace/backups/mongo-$NOW.gz")
        echo "[$NOW] r2 push: $CODE"
        r2_prune "mongo/" 7
      else
        echo "[$NOW] r2 push SKIPPED: no CF_TOKEN"
      fi
    else
      echo "[$NOW] backup FAILED rc=$?"
    fi
  fi
  ls -t /workspace/backups/mongo-*.gz 2>/dev/null | tail -n +8 | xargs -r rm -f
  sleep 86400
done
