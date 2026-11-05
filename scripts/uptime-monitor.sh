#!/usr/bin/env bash
# Uptime monitor: pings production /readyz every run; on 3 consecutive failures
# emails the operator via ZeptoMail (works once ZeptoMail credits are topped up).
# State: /workspace/baanzon/logs/uptime-state (consecutive failure count).
set -u
cd /workspace/baanzon
URL="https://baanzonchat.opraiz.com/readyz"
STATE="logs/uptime-state"
FAILS=0
[ -f "$STATE" ] && FAILS=$(cat "$STATE")
if curl -s -m 20 -A "Mozilla/5.0" "$URL" | grep -q '"status":"ok"'; then
  if [ "$FAILS" -ge 3 ]; then
    echo "recovered at $(date -u)" > "$STATE.recovered"
  fi
  echo 0 > "$STATE"
  exit 0
fi
FAILS=$((FAILS + 1))
echo "$FAILS" > "$STATE"
if [ "$FAILS" -eq 3 ]; then
  # 3 consecutive failures -> alert once (resets when healthy again)
  source .env 2>/dev/null
  KEY="${ZEPTOMAIL_API_KEY:-${EMAIL_PASSWORD:-}}"
  FROM="${EMAIL_FROM:-}"
  TO="${ALERT_EMAIL:-${EMAIL_FROM:-}}"
  if [ -n "$KEY" ] && [ -n "$FROM" ] && [ -n "$TO" ]; then
    curl -s -m 30 -X POST https://transactional.zeptomail.in/v1.1/email \
      -H "Authorization: Zoho-enczapikey $KEY" -H "Content-Type: application/json" \
      -d "{\"from\":{\"address\":\"$FROM\",\"name\":\"Baanzon Monitor\"},\"to\":[{\"email_address\":{\"address\":\"$TO\"}}],\"subject\":\"BAANZON DOWN\",\"htmlbody\":\"/readyz has failed $FAILS consecutive checks. https://baanzonchat.opraiz.com is degraded or down. Check: ssh pod -> supervisorctl status\"}" \
      > /dev/null
  fi
fi
