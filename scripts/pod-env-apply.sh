#!/bin/bash
# Merge operator-provided key=value lines (stdin) into the pod's .env and
# restart the api. Values arrive from the Pod rescue workflow's RESCUE_*
# repository secrets; this script never echoes them.
set -u
APP_DIR=/workspace/baanzon
ENV_FILE="$APP_DIR/.env"
[ -f "$ENV_FILE" ] || { echo "[env-apply] no $ENV_FILE - run the diagnose stage first"; exit 1; }
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
supervisorctl restart baanzon-api >/dev/null 2>&1 || supervisorctl start baanzon-api >/dev/null 2>&1 || true
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:3080/readyz >/dev/null; then echo "[env-apply] api ready after $((i*3))s"; break; fi
  sleep 3
done
supervisorctl status baanzon-api || true
curl -s -o /dev/null -w "[env-apply] local /health: %{http_code}\n" --max-time 10 http://127.0.0.1:3080/health || true
