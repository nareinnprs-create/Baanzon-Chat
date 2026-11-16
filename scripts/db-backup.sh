#!/bin/bash
# Nightly backup loop (supervisor keeps this alive).
# Mongo: mongodump archive. Uploads: tar of the ACTIVE slot's uploads/ (it
# always holds the union — pod-apply-release.sh copies uploads active->staged
# on every deploy). Meili: consistent dump via its HTTP API. All three push to
# the R2 bucket, 7 nightly objects per prefix. Vars are extracted directly
# from .env (sourcing it breaks on the EMAIL_FROM line) and re-resolved every
# cycle so blue-green flips are picked up.
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

env_val() { grep -m1 "^$1=" "$2" | sed "s/^$1=//; s/^\"//; s/\"\$//"; }

while true; do
  NOW=$(date -u +%Y%m%d_%H%M%S)
  SLOT=$([ "$(cat /workspace/data/active-port 2>/dev/null)" = "3090" ] && echo /workspace/baanzon || echo /workspace/baanzon-next)
  ENVF=$SLOT/.env
  MONGO_URI=$(env_val MONGO_URI "$ENVF")
  CF_TOKEN=$(env_val CF_TOKEN "$ENVF")
  MEILI_HOST=$(env_val MEILI_HOST "$ENVF")
  MEILI_MASTER_KEY=$(env_val MEILI_MASTER_KEY "$ENVF")

  if [ -z "$MONGO_URI" ]; then
    echo "[$NOW] backup SKIPPED: no MONGO_URI"
  else
    S=$(date +%s)
    if /usr/local/bin/mongodump --uri "$MONGO_URI" --archive=/workspace/backups/mongo-$NOW.gz --gzip --quiet; then
      echo "[$NOW] backup ok $(du -h /workspace/backups/mongo-$NOW.gz | cut -f1) took $(( $(date +%s) - S ))s"
      if [ -n "$CF_TOKEN" ]; then
        echo "[$NOW] mongo r2 push: $(r2 PUT "mongo/mongo-$NOW.gz" "/workspace/backups/mongo-$NOW.gz")"
        r2_prune "mongo/" 7
      fi
    else
      echo "[$NOW] backup FAILED rc=$?"
    fi
  fi

  if [ -n "$(ls -A "$SLOT/uploads" 2>/dev/null)" ]; then
    tar -czf /workspace/backups/uploads-$NOW.tar.gz -C "$SLOT" uploads 2>/dev/null
    if [ -n "$CF_TOKEN" ]; then
      echo "[$NOW] uploads r2 push: $(r2 PUT "uploads/uploads-$NOW.tar.gz" "/workspace/backups/uploads-$NOW.tar.gz") ($(du -h /workspace/backups/uploads-$NOW.tar.gz | cut -f1))"
      r2_prune "uploads/" 7
    fi
  fi

  if [ -n "$MEILI_HOST" ] && [ -n "$MEILI_MASTER_KEY" ]; then
    rm -f /workspace/dumps/*.dump 2>/dev/null
    MCODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$MEILI_HOST/dumps" -H "Authorization: Bearer $MEILI_MASTER_KEY")
    D=""
    if [ "$MCODE" = "202" ]; then
      for i in $(seq 1 36); do # up to ~6 min for the dump to appear and finish
        sleep 10
        D=$(ls -t /workspace/dumps/*.dump 2>/dev/null | head -1)
        if [ -n "$D" ]; then
          S1=$(stat -c%s "$D"); sleep 4; S2=$(stat -c%s "$D")
          [ "$S1" = "$S2" ] && [ "$S1" != "0" ] && break
        fi
      done
    fi
    if [ -n "$D" ]; then
      cp "$D" /workspace/backups/meili-$NOW.dump
      if [ -n "$CF_TOKEN" ]; then
        echo "[$NOW] meili r2 push: $(r2 PUT "meili/meili-$NOW.dump" "/workspace/backups/meili-$NOW.dump") ($(du -h /workspace/backups/meili-$NOW.dump | cut -f1))"
        r2_prune "meili/" 7
      fi
      rm -f "$D"
    else
      echo "[$NOW] meili dump trigger: $MCODE, no dump file produced"
    fi
  fi

  for p in mongo uploads meili; do
    ls -t /workspace/backups/$p-* 2>/dev/null | tail -n +8 | xargs -r rm -f
  done
  sleep 86400
done
