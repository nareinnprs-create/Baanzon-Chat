#!/usr/bin/env bash
# SearXNG installer for the pod (rescue lane, stage=searxng). SearXNG is not on
# PyPI (the `searxng` name there is an unrelated MCP server), so this installs
# from source into a venv on the persistent volume, writes JSON-capable
# settings, supervises gunicorn on 127.0.0.1:8888, verifies the JSON search API
# and points SEARXNG_INSTANCE_URL at it in the ACTIVE slot's .env (picked up on
# the next boot - no restart here, so the live site never blinks).
set -u

BASE=/workspace/searxng
SRC=$BASE/searxng-src
VENV=$BASE/venv
SETTINGS=$BASE/settings.yml
APP_STR='searx.webapp:app'
ACTIVE_FILE=/workspace/data/active-port
ENV_DIR=/workspace/baanzon
if [ -f "$ACTIVE_FILE" ] && [ "$(cat "$ACTIVE_FILE" 2>/dev/null | tr -dc 0-9)" = "3091" ]; then
  ENV_DIR=/workspace/baanzon-next
fi

echo "=== searxng: venv ==="
mkdir -p "$BASE" /workspace/data
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV" || { echo "[searxng] FAILED: venv creation"; exit 1; }
  "$VENV/bin/pip" install --upgrade pip -q
fi
# The PyPI `searxng` name is an unrelated MCP server - remove it if present.
"$VENV/bin/pip" uninstall -y searXNG 2>/dev/null | tail -1 || true

echo "=== searxng: source ==="
python3 --version 2>&1 || echo "[searxng] WARNING: python3 missing"
STAMP=$(date +%s)
for i in 1 2 3 4 5; do
  rm -rf "$SRC" 2>/dev/null || true
  if [ ! -d "$SRC" ]; then break; fi
  echo "[searxng] rm retry $i (network-volume rm race)"
  sleep 5
done
if [ -d "$SRC" ]; then
  SRC="$BASE/searxng-src-$STAMP"
  echo "[searxng] cleanup failed - using fresh dir $SRC"
fi
# Tarball only (no git): the repo's utils/templates files contain colons in
# their names and this pod's volume rejects them, so exclude that directory -
# gunicorn only needs the searx package and requirements.txt.
mkdir -p "$SRC"
curl -SsL https://github.com/searxng/searxng/archive/refs/heads/master.tar.gz -o "$BASE/src.tar.gz" 2>"$BASE/tarball-error.log" \
  || { echo "[searxng] FAILED: tarball download: $(tail -2 "$BASE/tarball-error.log" 2>/dev/null)"; exit 1; }
tar -xzf "$BASE/src.tar.gz" -C "$SRC" --strip-components=1 --exclude='utils/templates' \
  || { echo "[searxng] FAILED: tarball extract"; exit 1; }
echo "[searxng] source extracted (templates excluded)"
"$VENV/bin/pip" install -q -r "$SRC/requirements.txt" gunicorn \
  || { echo "[searxng] FAILED: requirements install"; exit 1; }
( cd "$SRC" && SEARXNG_SETTINGS_PATH="$SETTINGS" "$VENV/bin/python" -c "import searx.webapp" ) 2>"$BASE/import-error.log" \
  || { echo "[searxng] FAILED: searx.webapp import:"; tail -8 "$BASE/import-error.log"; exit 1; }
echo "[searxng] source ready"

echo "=== searxng: settings ==="
# Always regenerate: machine-owned file, and a deterministic single `search:`
# block (an appended duplicate crashes SearXNG's YAML parse). The JSON format
# is required by the search API the app and Deep Research call.
SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
cat > "$SETTINGS" <<EOF
use_default_settings: true
server:
  bind_address: 127.0.0.1
  port: 8888
  secret_key: "$SECRET"
search:
  formats:
    - html
    - json
EOF
chmod 600 "$SETTINGS"
echo "[searxng] settings written ($SETTINGS)"

echo "=== searxng: supervisor ==="
cat > /etc/supervisor/conf.d/searxng.conf <<EOF
[program:searxng]
command=$VENV/bin/gunicorn --preload --workers 2 --bind 127.0.0.1:8888 --timeout 120 --chdir $SRC 'searx.webapp:app'
directory=$SRC
autostart=true
autorestart=true
stopasgroup=true
environment=SEARXNG_SETTINGS_PATH="$SETTINGS"
stdout_logfile=/workspace/baanzon/logs/supervisor-searxng.log
redirect_stderr=true
EOF
supervisorctl reread >/dev/null 2>&1 || true
supervisorctl update >/dev/null 2>&1 || true
for i in 1 2 3 4 5; do
  if supervisorctl status searxng 2>/dev/null | grep -q RUNNING; then break; fi
  sleep 4
  supervisorctl start searxng >/dev/null 2>&1 || true
done
supervisorctl status searxng || true
tail -60 /workspace/baanzon/logs/supervisor-searxng.log 2>/dev/null || true

echo "=== searxng: verify JSON search API ==="
sleep 3
CODE=$(curl -s -o /tmp/searxng-probe.json -w '%{http_code}' --max-time 20 'http://127.0.0.1:8888/search?q=baanzon&format=json' || echo 000)
if [ "$CODE" = "200" ]; then
  echo "[searxng] JSON search API: 200 ($(wc -c < /tmp/searxng-probe.json) bytes)"
else
  echo "[searxng] WARNING: JSON probe returned $CODE"
  tail -15 /workspace/baanzon/logs/supervisor-searxng.log 2>/dev/null || true
fi

echo "=== searxng: point the active slot at the instance ==="
if ! grep -qE '^SEARXNG_INSTANCE_URL=' "$ENV_DIR/.env" 2>/dev/null; then
  printf 'SEARXNG_INSTANCE_URL=http://127.0.0.1:8888\n' >> "$ENV_DIR/.env"
  chmod 600 "$ENV_DIR/.env"
  echo "[searxng] SEARXNG_INSTANCE_URL added to $ENV_DIR/.env (takes effect on the next boot)"
else
  echo "[searxng] SEARXNG_INSTANCE_URL already present in $ENV_DIR/.env"
fi
supervisorctl status | grep -E 'searxng|baanzon-api' || true
echo "=== searxng: done ==="
