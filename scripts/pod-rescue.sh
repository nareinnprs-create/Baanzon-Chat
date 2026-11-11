#!/bin/bash
# Pod rescue: diagnose /workspace after a failed deploy rollback, restore the
# app dir if any candidate tree survives, and if .env was lost assemble a
# minimal replacement from pod-derivable values (mongod on localhost, meili
# key from /proc, fresh JWT/CREDS) so the site can come back up before the
# operator re-enters the secret keys. Runs ON the pod over SSH via the Pod
# rescue workflow. Prints only paths, sizes and names - never file contents -
# so no secrets reach the CI log.
set -u
APP_DIR=/workspace/baanzon
CANDIDATES="$APP_DIR-tmp /workspace/baanzon-old /workspace/baanzon-next"

echo "=== diagnose ==="
ls -la /workspace 2>/dev/null | head -30 || echo "(no /workspace)"
for d in $CANDIDATES "$APP_DIR"; do
  if [ -d "$d" ]; then
    env_s=missing; [ -f "$d/.env" ] && env_s="present($(stat -c%s "$d/.env")B)"
    yaml_s=missing; [ -f "$d/baanzon.yaml" ] && yaml_s=present
    nm_s=no; [ -d "$d/node_modules" ] && nm_s=yes
    echo "-- $d : .env=$env_s baanzon.yaml=$yaml_s node_modules=$nm_s entries=$(ls "$d" 2>/dev/null | wc -l)"
  else
    echo "-- $d : ABSENT"
  fi
done
echo "-- stray .env files (paths only)"
find /workspace /root -maxdepth 4 -name ".env*" -not -path "*/node_modules/*" 2>/dev/null | head -20
echo "-- release sha: $(cat /workspace/.release-sha 2>/dev/null || echo none)"
echo "-- supervisor programs"
grep -hE "^\[program:" /etc/supervisor/conf.d/*.conf 2>/dev/null || echo "(no conf)"
supervisorctl status 2>&1 | head -10
echo "-- processes"
ps -eo args --no-headers 2>/dev/null | grep -E "node|mongod|meili|cloudflared" | grep -v grep | awk '{print $1}' | sort | uniq -c
for pid in $(pgrep -x mongod 2>/dev/null); do
  echo "-- mongod/$pid dbpath=$(tr '\0' '\n' < /proc/$pid/cmdline 2>/dev/null | grep -A1 dbpath | tail -1) port=$(tr '\0' '\n' < /proc/$pid/cmdline 2>/dev/null | grep -A1 port | tail -1)"
done
df -h /workspace 2>/dev/null | tail -1

echo "=== restore ==="
if [ ! -f "$APP_DIR/.env" ]; then
  SRC=""
  for c in $CANDIDATES; do
    if [ -d "$c" ] && [ -f "$c/.env" ]; then SRC="$c"; break; fi
  done
  if [ -n "$SRC" ]; then
    if [ -d "$APP_DIR" ]; then
      cp "$SRC/.env" "$APP_DIR/.env" && echo "[rescue] .env copied from $SRC"
      [ -f "$SRC/baanzon.yaml" ] && cp "$SRC/baanzon.yaml" "$APP_DIR/baanzon.yaml"
    else
      mv "$SRC" "$APP_DIR" && echo "[rescue] app dir restored from $SRC"
    fi
  else
    echo "[rescue] no candidate tree holds .env"
  fi
fi
if [ -f "$APP_DIR/.env" ] && [ ! -f "$APP_DIR/baanzon.yaml" ]; then
  for c in $CANDIDATES; do
    if [ -f "$c/baanzon.yaml" ]; then cp "$c/baanzon.yaml" "$APP_DIR/baanzon.yaml" && echo "[rescue] baanzon.yaml copied from $c"; break; fi
  done
fi
if [ ! -d "$APP_DIR" ] || [ ! -f "$APP_DIR/package.json" ]; then
  for c in $CANDIDATES; do
    if [ -d "$c" ] && [ -f "$c/package.json" ]; then
      [ -d "$APP_DIR" ] && rm -rf "$APP_DIR" 2>/dev/null || true
      mv "$c" "$APP_DIR" && echo "[rescue] code-only app dir restored from $c"
      break
    fi
  done
fi

if [ -f "$APP_DIR/.env" ]; then
  echo "[rescue] .env present - skipping reconstruction"
else
  if [ ! -d "$APP_DIR" ] || [ ! -f "$APP_DIR/package.json" ]; then
    echo "=== ENV_MISSING_NO_CODE ==="
    echo "[rescue] no .env and no code tree; nothing to start"
    exit 0
  fi
  echo "=== assemble minimal .env ==="
  REC=/workspace/.env-recovered
  : > "$REC"; chmod 600 "$REC"
  for pid in $(pgrep -f meilisearch 2>/dev/null); do
    echo "# meilisearch/$pid" >> "$REC"
    tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep -E "^(MEILI|MEILISEARCH)" >> "$REC" || true
    tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null | grep -iE "master[-_ ]?key|--env" >> "$REC" || true
  done
  for pid in $(pgrep -f "api/server/index.js" 2>/dev/null); do
    echo "# node/$pid" >> "$REC"
    tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep -vE "^(PATH|LS_COLORS|PWD|SHLVL|_=|HOME|LANG|HOSTNAME|TERM|OLDPWD|npm_)" >> "$REC" || true
  done
  grep -hE "^environment=" /etc/supervisor/conf.d/*.conf 2>/dev/null >> "$REC" || true
  echo "[rescue] staged $(wc -l < "$REC") candidate lines (not printed)"

  MEILI_KEY=$(grep -oE "^(MEILI_MASTER_KEY|MEILI_KEY)=..*" "$REC" | head -1 | cut -d= -f2-)
  [ -z "$MEILI_KEY" ] && MEILI_KEY=$(grep -oiE "master[-_ ]?key[= ][A-Za-z0-9]+" "$REC" | head -1 | sed 's/.*[= ]//')

  APP_DB=""
  MONGO_AUTH=no
  if command -v mongosh >/dev/null 2>&1; then
    DBS=$(mongosh --quiet --eval "JSON.stringify(db.adminCommand({listDatabases:1}).databases.map(function(d){return d.name}))" 2>/dev/null || true)
    if [ -z "$DBS" ]; then MONGO_AUTH=yes; fi
    for db in $(echo "$DBS" | tr -d '[]",'); do
      case "$db" in ""|admin|local|config) continue ;; esac
      HAS=$(mongosh --quiet "$db" --eval "JSON.stringify(db.getCollectionNames().indexOf('users')>=0)" 2>/dev/null | tail -1)
      if [ "$HAS" = "true" ]; then APP_DB="$db"; break; fi
    done
  fi
  [ -z "$APP_DB" ] && APP_DB="baanzon"
  echo "[rescue] mongo auth=$MONGO_AUTH app db=$APP_DB (from: $( [ -n "$DBS" ] && echo probe || echo fallback ))"

  JWT=$(openssl rand -hex 32)
  JWT_REFRESH=$(openssl rand -hex 32)
  CREDS=$(openssl rand -hex 16)
  CREDS_IV=$(openssl rand -hex 8)
  if [ -z "$MEILI_KEY" ]; then MEILI_KEY=$(openssl rand -hex 24); fi

  cat > "$APP_DIR/.env" <<EOF
APP_TITLE=Baanzon Chat
HOST=0.0.0.0
PORT=3080
NODE_ENV=production
DOMAIN_CLIENT=https://baanzonchat.opraiz.com
DOMAIN_SERVER=https://baanzonchat.opraiz.com
ALLOWED_ORIGINS=https://baanzonchat.opraiz.com
TRUST_PROXY=1
MONGO_URI=mongodb://127.0.0.1:27017/$APP_DB
MEILI_HOST=http://127.0.0.1:7700
MEILI_MASTER_KEY=$MEILI_KEY
JWT_SECRET=$JWT
JWT_REFRESH_SECRET=$JWT_REFRESH
CREDS_KEY=$CREDS
CREDS_IV=$CREDS_IV
ALLOW_EMAIL_LOGIN=true
ALLOW_REGISTRATION=true
ALLOW_SOCIAL_LOGIN=false
ALLOW_PASSWORD_RESET=false
ALLOW_UNVERIFIED_EMAIL_LOGIN=false
ALLOW_SHARED_LINKS=false
SEARCH=false
LOG_TO_FILE=true
# --- operator action: re-enter the lost production keys ---
OPRAIZ_API_KEY=
OPRAIZ_BASEURL=
DODO_API_KEY=
DODO_WEBHOOK_SECRET=
EOF
  chmod 600 "$APP_DIR/.env"
  echo "[rescue] minimal .env written; keys: $(grep -oE '^[A-Z_0-9]+' "$APP_DIR/.env" | tr '\n' ' ')"
  echo "=== OPERATOR KEYS NEEDED: OPRAIZ_API_KEY, OPRAIZ_BASEURL, DODO_API_KEY, DODO_WEBHOOK_SECRET, SMTP/OpenID if used ==="
fi

echo "=== start ==="
if [ ! -f "$APP_DIR/.env" ]; then
  echo "[rescue] still no .env - leaving api stopped"
  exit 0
fi
supervisorctl reread >/dev/null 2>&1 || true
supervisorctl update >/dev/null 2>&1 || true
supervisorctl restart baanzon-api >/dev/null 2>&1 || supervisorctl start baanzon-api >/dev/null 2>&1 || true
for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:3080/readyz >/dev/null; then echo "[rescue] api ready after $((i*3))s"; break; fi
  sleep 3
done
supervisorctl status 2>&1 | head -6
curl -s -o /dev/null -w "[rescue] local /health: %{http_code}\n" --max-time 10 http://127.0.0.1:3080/health || true
echo "=== done ==="
