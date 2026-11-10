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
  env_value() {
    awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); sub(/[[:space:]]*\r?$/, ""); print; exit }' .env
  }
  KEY="$(env_value ZEPTOMAIL_API_KEY)"
  [ -n "$KEY" ] || KEY="$(env_value EMAIL_PASSWORD)"
  FROM="$(env_value EMAIL_FROM)"
  TO="$(env_value ALERT_EMAIL)"
  [ -n "$TO" ] || TO="$FROM"
  if [ -n "$KEY" ] && [ -n "$FROM" ] && [ -n "$TO" ]; then
    payload=$(jq -n \
      --arg from "$FROM" \
      --arg to "$TO" \
      --arg body "/readyz has failed $FAILS consecutive checks. https://baanzonchat.opraiz.com is degraded or down. Check: ssh pod -> supervisorctl status" \
      '{from:{address:$from,name:"Baanzon Monitor"},to:[{email_address:{address:$to}}],subject:"BAANZON DOWN",htmlbody:$body}')
    curl -s -m 30 -X POST https://transactional.zeptomail.in/v1.1/email \
      -H "Authorization: Zoho-enczapikey $KEY" -H "Content-Type: application/json" \
      -d "$payload" \
      > /dev/null
  fi
fi
