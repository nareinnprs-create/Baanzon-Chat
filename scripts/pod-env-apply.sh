#!/bin/bash
# Ensure the pod's .env exists, merge operator-provided key=value lines
# (stdin) into it, and restart the api when the app tree can run. Values
# arrive from the Pod rescue workflow's RESCUE_* repository secrets; this
# script never echoes them. When .env is missing (lost release), a minimal
# replacement is assembled from pod-derivable values (mongod on localhost,
# meili key from a live process, fresh JWT/CREDS) so the next deploy - which
# owns unpacking, npm ci and the release swap - finds a usable .env.
set -u
APP_DIR=/workspace/baanzon
ENV_FILE="$APP_DIR/.env"
CREATED=no

if [ ! -f "$ENV_FILE" ]; then
  mkdir -p "$APP_DIR"
  echo "[env-apply] no .env - assembling minimal replacement"
  REC=/workspace/.env-recovered
  : > "$REC"; chmod 600 "$REC"
  for pid in $(pgrep -f meilisearch 2>/dev/null); do
    echo "# meilisearch/$pid" >> "$REC"
    tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep -E "^(MEILI|MEILISEARCH)" >> "$REC" || true
  done
  for pid in $(pgrep -f "api/server/index.js" 2>/dev/null); do
    echo "# node/$pid" >> "$REC"
    tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep -vE "^(PATH|LS_COLORS|PWD|SHLVL|_=|HOME|LANG|HOSTNAME|TERM|OLDPWD|npm_)" >> "$REC" || true
  done
  grep -hE "^environment=" /etc/supervisor/conf.d/*.conf 2>/dev/null >> "$REC" || true

  MEILI_KEY=$(grep -oE "^(MEILI_MASTER_KEY|MEILI_KEY)=..*" "$REC" | head -1 | cut -d= -f2-)

  APP_DB="baanzon"
  if command -v mongosh >/dev/null 2>&1; then
    DBS=$(mongosh --quiet --eval "JSON.stringify(db.adminCommand({listDatabases:1}).databases.map(function(d){return d.name}))" 2>/dev/null || true)
    for db in $(echo "$DBS" | tr -d '[]",'); do
      case "$db" in ""|admin|local|config) continue ;; esac
      HAS=$(mongosh --quiet "$db" --eval "JSON.stringify(db.getCollectionNames().indexOf('users')>=0)" 2>/dev/null | tail -1)
      if [ "$HAS" = "true" ]; then APP_DB="$db"; break; fi
    done
  fi
  echo "[env-apply] mongo app db=$APP_DB"

  JWT=$(openssl rand -hex 32)
  JWT_REFRESH=$(openssl rand -hex 32)
  CREDS=$(openssl rand -hex 16)
  CREDS_IV=$(openssl rand -hex 8)
  [ -z "$MEILI_KEY" ] && MEILI_KEY=$(openssl rand -hex 24)

  cat > "$ENV_FILE" <<EOF
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
EOF
  # provisioning artifacts may still hold the real keys; merge any hits
  SCAN_HITS=$(grep -hoE "(OPRAIZ_API_KEY|OPRAIZ_BASEURL|DODO_API_KEY|DODO_WEBHOOK_SECRET|MEILI_MASTER_KEY|JWT_SECRET|JWT_REFRESH_SECRET|CREDS_KEY|CREDS_IV|MONGO_URI)=[^\"' ]+" \
    /workspace/opraiz-providers.sh /workspace/provision*.log "$REC" 2>/dev/null | sort -u)
  if [ -n "$SCAN_HITS" ]; then
    echo "$SCAN_HITS" | while IFS= read -r line; do
      printf '%s\n' "$line" >> "$ENV_FILE"
    done
    echo "[env-apply] merged $(echo "$SCAN_HITS" | grep -c . ) provisioning scan hits"
  fi
  chmod 600 "$ENV_FILE"
  echo "[env-apply] minimal .env created; keys: $(grep -oE '^[A-Z_0-9]+' "$ENV_FILE" | tr '\n' ' ')"
  echo "=== OPERATOR KEYS NEEDED: OPRAIZ_API_KEY, OPRAIZ_BASEURL, DODO_WEBHOOK_SECRET, SMTP/OpenID if used ==="
  CREATED=yes
fi

chmod 600 "$ENV_FILE" 2>/dev/null || true
APPLIED=""
while IFS= read -r line; do
  case "$line" in ""|\#*) continue ;; esac
  key="${line%%=*}"
  val="${line#*=}"
  [ -n "$key" ] || continue
  [ -n "$val" ] || continue
  if grep -qE "^${key}=" "$ENV_FILE"; then
    grep -vE "^${key}=" "$ENV_FILE" > "$ENV_FILE.tmp"
    printf '%s\n' "$line" >> "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '%s\n' "$line" >> "$ENV_FILE"
  fi
  APPLIED="$APPLIED $key"
done
echo "[env-apply] updated keys:${APPLIED:- (none)}"
chmod 600 "$ENV_FILE"

# restart only when the app tree can actually run; after a lost release the
# deploy owns unpacking and the swap
if [ -f "$APP_DIR/package.json" ] && [ -d "$APP_DIR/node_modules" ]; then
  supervisorctl reread >/dev/null 2>&1 || true
  supervisorctl update >/dev/null 2>&1 || true
  supervisorctl restart baanzon-api >/dev/null 2>&1 || supervisorctl start baanzon-api >/dev/null 2>&1 || true
  # restart can hit a transient spawn error on the network volume; keep trying
  for r in 1 2 3 4 5 6; do
    if supervisorctl status baanzon-api 2>/dev/null | grep -q RUNNING; then break; fi
    sleep 5
    supervisorctl start baanzon-api 2>/dev/null || true
  done
  for i in $(seq 1 60); do
    if curl -sf http://127.0.0.1:3080/readyz >/dev/null; then echo "[env-apply] api ready after $((i*3))s"; break; fi
    sleep 3
  done
  supervisorctl status baanzon-api || true
  curl -s -o /dev/null -w "[env-apply] local /health: %{http_code}\n" --max-time 10 http://127.0.0.1:3080/health || true
else
  echo "[env-apply] app tree not runnable yet ($CREATED) - leaving the restart to the next deploy"
fi
