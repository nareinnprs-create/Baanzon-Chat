#!/bin/bash
# Pod rescue: diagnose /workspace after a failed deploy rollback, rescue any
# stray .env / baanzon.yaml copies BEFORE anything destructive, restore the
# app dir, merge pod-derivable and provisioning-scan secrets into .env, and
# start the api. Runs ON the pod over SSH via the Pod rescue workflow.
# Prints only paths, sizes and names - never file contents - so no secrets
# reach the CI log.
set -u
APP_DIR=/workspace/baanzon

echo "=== diagnose ==="
ls -la /workspace 2>/dev/null | head -30 || echo "(no /workspace)"
for d in "$APP_DIR" "$APP_DIR/baanzon" "$APP_DIR-tmp" /workspace/baanzon-old /workspace/baanzon-next; do
  if [ -d "$d" ]; then
    env_s=missing; [ -f "$d/.env" ] && env_s="present($(stat -c%s "$d/.env")B)"
    yaml_s=missing; [ -f "$d/baanzon.yaml" ] && yaml_s=present
    nm_s=no; [ -d "$d/node_modules" ] && nm_s=yes
    echo "-- $d : .env=$env_s baanzon.yaml=$yaml_s node_modules=$nm_s entries=$(ls "$d" 2>/dev/null | wc -l)"
  else
    echo "-- $d : ABSENT"
  fi
done
echo "-- supervisor"
supervisorctl status 2>&1 | head -8
echo "-- api log tail (redacted)"
if [ -f "$APP_DIR/logs/supervisor-api.log" ]; then
  tail -n 80 "$APP_DIR/logs/supervisor-api.log" 2>/dev/null \
    | sed -E 's#[a-z+]+://[^ @"]*@#REDACTED_URI@#g; s#(cfat_|dodo_live_|dodo_test_|rpa_|sk-)[A-Za-z0-9._-]+#\1REDACTED#g' \
    | grep -aE "error|Error|ERROR|FATAL|Cannot|Cannot find|throw|EADDR|ECONN|MONGO|Mongo|EEXIST|missing|at " | head -40
else
  echo "(no log at $APP_DIR/logs/supervisor-api.log)"
  ls "$APP_DIR/logs" 2>/dev/null | head -10
fi

echo "=== stray rescue (before anything destructive) ==="
n=0
while IFS= read -r f; do
  n=$((n+1))
  cp "$f" "/workspace/.env-rescued-$n" && echo "[rescue] saved stray env: $f ($(stat -c%s "$f")B)"
done < <(find /workspace -maxdepth 5 \( -name ".env" -o -name ".env.*" \) \
  -not -path "*/node_modules/*" \
  -not -path "${APP_DIR}/.env" \
  -not -name ".env-recovered" -not -name ".env-rescued-*" 2>/dev/null)
[ "$n" = "0" ] && echo "[rescue] no stray .env files found"
for f in /workspace/baanzon/baanzon/baanzon.yaml /workspace/baanzon/baanzon.yaml; do
  if [ -f "$f" ]; then cp "$f" /workspace/baanzon.yaml-rescued && echo "[rescue] saved stray yaml: $f"; break; fi
done

echo "=== restore ==="
if [ ! -f "$APP_DIR/.env" ]; then
  SRCENV=$(ls -S /workspace/.env-rescued-* 2>/dev/null | head -1)
  if [ -n "${SRCENV:-}" ]; then
    mkdir -p "$APP_DIR"
    cp "$SRCENV" "$APP_DIR/.env" && echo "[rescue] .env restored from $SRCENV ($(stat -c%s "$APP_DIR/.env")B)"
  else
    echo "[rescue] no rescued .env available"
  fi
fi
if [ ! -f "$APP_DIR/baanzon.yaml" ]; then
  [ -f /workspace/baanzon.yaml-rescued ] && cp /workspace/baanzon.yaml-rescued "$APP_DIR/baanzon.yaml" && echo "[rescue] baanzon.yaml restored from stray"
fi
# code tree: restore from the newest candidate when APP_DIR lacks package.json
if [ ! -d "$APP_DIR" ] || [ ! -f "$APP_DIR/package.json" ]; then
  for c in "$APP_DIR-tmp" /workspace/baanzon-old /workspace/baanzon-next; do
    if [ -d "$c" ] && [ -f "$c/package.json" ]; then
      [ -d "$APP_DIR" ] && rm -rf "$APP_DIR" 2>/dev/null || true
      mv "$c" "$APP_DIR" && echo "[rescue] code-only app dir restored from $c"
      break
    fi
  done
fi

# secret scan: provisioning artifacts and the staging file may hold the real
# keys; merge any KEY=VALUE hits into .env without printing them
echo "=== secret scan ==="
SCAN_HITS=$(grep -hoE "(OPRAIZ_API_KEY|OPRAIZ_BASEURL|DODO_API_KEY|DODO_WEBHOOK_SECRET|JWT_SECRET|JWT_REFRESH_SECRET|CREDS_KEY|CREDS_IV|MEILI_MASTER_KEY|MONGO_URI)=[^\"' ]+" \
  /workspace/opraiz-providers.sh /workspace/provision*.log /workspace/.env-recovered 2>/dev/null | sort -u)
SCAN_COUNT=$(echo "$SCAN_HITS" | grep -c . 2>/dev/null || echo 0)
echo "[rescue] scan hits: $SCAN_COUNT"
if [ -f "$APP_DIR/.env" ] && [ -n "$SCAN_HITS" ]; then
  chmod 600 "$APP_DIR/.env" 2>/dev/null || true
  echo "$SCAN_HITS" | while IFS= read -r line; do
    key="${line%%=*}"
    val="${line#*=}"
    [ -n "$key" ] || continue
    [ -n "$val" ] || continue
    if grep -qE "^${key}=" "$APP_DIR/.env"; then
      grep -vE "^${key}=" "$APP_DIR/.env" > "$APP_DIR/.env.tmp"
      printf '%s\n' "$line" >> "$APP_DIR/.env.tmp"
      mv "$APP_DIR/.env.tmp" "$APP_DIR/.env"
    else
      printf '%s\n' "$line" >> "$APP_DIR/.env"
    fi
  done
  echo "[rescue] merged scan hits into .env"
elif [ ! -f "$APP_DIR/.env" ] && [ -n "$SCAN_HITS" ]; then
  printf '%s\n' "$SCAN_HITS" > "$APP_DIR/.env"
  echo "[rescue] seeded .env from scan hits"
fi

if [ ! -f "$APP_DIR/.env" ]; then
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
  done
  for pid in $(pgrep -f "api/server/index.js" 2>/dev/null); do
    echo "# node/$pid" >> "$REC"
    tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep -vE "^(PATH|LS_COLORS|PWD|SHLVL|_=|HOME|LANG|HOSTNAME|TERM|OLDPWD|npm_)" >> "$REC" || true
  done
  grep -hE "^environment=" /etc/supervisor/conf.d/*.conf 2>/dev/null >> "$REC" || true

  MEILI_KEY=$(grep -oE "^(MEILI_MASTER_KEY|MEILI_KEY)=..*" "$REC" | head -1 | cut -d= -f2-)

  APP_DB="baanzon"
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
  echo "[rescue] mongo auth=$MONGO_AUTH app db=$APP_DB"

  JWT=$(openssl rand -hex 32)
  JWT_REFRESH=$(openssl rand -hex 32)
  CREDS=$(openssl rand -hex 16)
  CREDS_IV=$(openssl rand -hex 8)
  [ -z "$MEILI_KEY" ] && MEILI_KEY=$(openssl rand -hex 24)

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
EOF
  # re-run the scan merge over the fresh file so provisioning keys win
  if [ -n "$SCAN_HITS" ]; then
    echo "$SCAN_HITS" | while IFS= read -r line; do
      key="${line%%=*}"; val="${line#*=}"
      [ -n "$key" ] && [ -n "$val" ] && printf '%s\n' "$line" >> "$APP_DIR/.env"
    done
  fi
  chmod 600 "$APP_DIR/.env"
  echo "[rescue] minimal .env written; keys: $(grep -oE '^[A-Z_0-9]+' "$APP_DIR/.env" | tr '\n' ' ')"
  echo "=== OPERATOR KEYS NEEDED: OPRAIZ_API_KEY, OPRAIZ_BASEURL, DODO_API_KEY, DODO_WEBHOOK_SECRET, SMTP/OpenID if used ==="
fi

echo "=== start ==="
[ -f "$APP_DIR/baanzon.yaml" ] || echo "[rescue] WARNING: baanzon.yaml missing - api boots on defaults until the next deploy carries it"
supervisorctl reread >/dev/null 2>&1 || true
supervisorctl update >/dev/null 2>&1 || true
supervisorctl restart baanzon-api >/dev/null 2>&1 || supervisorctl start baanzon-api >/dev/null 2>&1 || true
# restart can hit a transient spawn error on the network volume; keep trying
for i in 1 2 3 4 5 6; do
  if supervisorctl status baanzon-api 2>/dev/null | grep -q RUNNING; then break; fi
  sleep 5
  supervisorctl start baanzon-api 2>/dev/null || true
done
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:3080/readyz >/dev/null; then echo "[rescue] api ready after $((i*3))s"; break; fi
  sleep 3
done
supervisorctl status 2>&1 | head -8
curl -s -o /dev/null -w "[rescue] local /health: %{http_code}\n" --max-time 10 http://127.0.0.1:3080/health || true
echo "=== done ==="
