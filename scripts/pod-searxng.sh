#!/usr/bin/env bash
# SearXNG installer for the pod (rescue lane, stage=searxng). Installs into a
# venv on the persistent volume, writes minimal JSON-capable settings, adds a
# supervisor program on 127.0.0.1:8888, verifies the JSON search API and points
# SEARXNG_INSTANCE_URL at it in the ACTIVE slot's .env (picked up on the next
# boot - no restart here, so the live site never blinks).
set -u

BASE=/workspace/searxng
VENV=$BASE/venv
SETTINGS=$BASE/settings.yml
APP_DIR=${SEARXNG_APP_DIR:-/workspace/baanzon-next}
# The ACTIVE slot's .env is the one users boot with; default to the blue slot
# and prefer green when the pointer says so.
ACTIVE_FILE=/workspace/data/active-port
ENV_DIR=/workspace/baanzon
if [ -f "$ACTIVE_FILE" ] && [ "$(cat "$ACTIVE_FILE" 2>/dev/null | tr -dc 0-9)" = "3091" ]; then
  ENV_DIR=/workspace/baanzon-next
fi

echo "=== searxng: install ==="
mkdir -p "$BASE" /workspace/data
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV" || { echo "[searxng] FAILED: venv creation"; exit 1; }
  "$VENV/bin/pip" install --upgrade pip -q
fi
if [ ! -x "$VENV/bin/gunicorn" ]; then
  "$VENV/bin/pip" install -q searxng gunicorn || { echo "[searxng] FAILED: pip install"; exit 1; }
fi
echo "[searxng] deps ready"

echo "=== searxng: settings ==="
# Always regenerate: machine-owned file, and a deterministic single `search:`
# block (an appended duplicate crashes SearXNG's YAML parse).
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

echo "=== searxng: import preflight ==="
if ! "$VENV/bin/python" -c "import searxng.webapp" 2>"$BASE/import-error.log"; then
  echo "[searxng] WARNING: searxng.webapp import failed:"
  tail -6 "$BASE/import-error.log" || true
fi

echo "=== searxng: supervisor ==="
cat > /etc/supervisor/conf.d/searxng.conf <<EOF
[program:searxng]
command=$VENV/bin/gunicorn --workers 2 --bind 127.0.0.1:8888 --timeout 120 'searxng.webapp:app'
directory=$BASE
autostart=true
autorestart=true
stopasgroup=true
environment=SEARXNG_SETTINGS_PATH="$SETTINGS",PYTHONPATH="$VENV/lib/python3.11/site-packages"
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

echo "=== searxng: verify JSON search API ==="
sleep 3
CODE=$(curl -s -o /tmp/searxng-probe.json -w '%{http_code}' --max-time 20 'http://127.0.0.1:8888/search?q=baanzon&format=json' || echo 000)
if [ "$CODE" = "200" ]; then
  echo "[searxng] JSON search API: 200 ($(wc -c < /tmp/searxng-probe.json) bytes)"
else
  echo "[searxng] WARNING: JSON probe returned $CODE - check $BASE/../baanzon/logs/supervisor-searxng.log"
  tail -5 /workspace/baanzon/logs/supervisor-searxng.log 2>/dev/null || true
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
