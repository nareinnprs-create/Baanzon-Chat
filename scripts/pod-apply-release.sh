#!/bin/bash
# Apply a release tarball onto the pod. Invoked by the deploy workflow over SSH.
set -euo pipefail
RELEASE_SRC=/workspace/_release
APP_DIR=/workspace/baanzon
NEW_DIR=/workspace/baanzon-next
OLD_DIR=/workspace/baanzon-old

echo "[apply] unpacking release"
# No-op guard: identical payload already deployed (docs-only pushes etc.)
NEW_SHA=$(sha256sum "$RELEASE_SRC/baanzon-app.tar.gz" | cut -d' ' -f1)
if [ -f /workspace/.release-sha ] && [ "$(cat /workspace/.release-sha)" = "$NEW_SHA" ]; then
  echo "[apply] payload unchanged (sha match) - nothing to do"
  exit 0
fi
# self-heal: a failed rollback can leave APP_DIR missing or .env-less while a
# usable release survives in a candidate dir; restore before anything else.
if [ ! -f "$APP_DIR/.env" ]; then
  for c in "$APP_DIR-tmp" "$OLD_DIR"; do
    if [ -f "$c/.env" ]; then
      echo "[apply] self-heal: $APP_DIR unusable - restoring from $c"
      [ -d "$APP_DIR" ] && rm -rf "$APP_DIR" 2>/dev/null || true
      mv "$c" "$APP_DIR"
      break
    fi
  done
fi
# never destroy the release backup while the live .env is unaccounted for
for i in 1 2 3 4; do
  if [ -f "$APP_DIR/.env" ]; then rm -rf "$OLD_DIR" 2>/dev/null || true; fi
  if rm -rf "$NEW_DIR" 2>/dev/null; then break; fi
  echo "[apply] rm retry $i (network-volume rm race)"; sleep 5
done
rm -rf "$NEW_DIR" 2>/dev/null || true
if [ -f "$APP_DIR/.env" ]; then rm -rf "$OLD_DIR" 2>/dev/null || true; fi
# single-replica pod: without this the schedules engine refuses to arm and
# schedule writes 503 forever (matches the previous live deployment's setting)
if ! grep -qE "^SCHEDULES_SINGLE_PROCESS=" "$APP_DIR/.env"; then
  printf 'SCHEDULES_SINGLE_PROCESS=true\n' >> "$APP_DIR/.env"
fi
mkdir -p "$NEW_DIR"
tar --no-same-owner --no-same-permissions -xzf "$RELEASE_SRC/baanzon-app.tar.gz" -C "$NEW_DIR"

# preserve operator-managed files the tarball must not carry
for f in .env baanzon.yaml; do
  if [ -f "$APP_DIR/$f" ]; then cp "$APP_DIR/$f" "$NEW_DIR/$f"; fi
done
for d in images uploads logs; do
  mkdir -p "$NEW_DIR/$d"
  if [ -d "$APP_DIR/$d" ]; then cp -a "$APP_DIR/$d/." "$NEW_DIR/$d/" 2>/dev/null || true; fi
done

# data dirs: live OUTSIDE the app dir at /workspace/data/{mongodb,meili_data}
# (mongod/meili supervisor conf point there) so releases never touch them.

if [ ! -f "$APP_DIR/.env" ]; then
  echo "[apply] REQUIRED: $APP_DIR/.env is missing"
  exit 1
fi

# Read only the two provider keys; do not source the file because provider URLs
# and secrets may contain shell metacharacters or unrelated dotenv lines.
env_value() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); sub(/[[:space:]]*\r?$/, ""); print; exit }' "$APP_DIR/.env"
}
# Recovery boot: warn rather than refuse - a missing provider key must not
# keep a half-reconstructed .env from booting the site (models fall back to
# the static list; the operator re-enters keys via the Pod rescue env stage).
if [ -z "$(env_value OPRAIZ_API_KEY)" ] || [ -z "$(env_value OPRAIZ_BASEURL)" ]; then
  echo "[apply] WARNING: OPRAIZ_API_KEY and/or OPRAIZ_BASEURL empty - Opraiz models will not resolve until the operator re-enters them"
fi

echo "[apply] validating Cloudflare provider routing"
node "$NEW_DIR/scripts/validate-provider-routing.js" "$NEW_DIR/baanzon.yaml" --fix
node "$NEW_DIR/scripts/validate-provider-routing.js" "$NEW_DIR/baanzon.yaml"

echo "[apply] preparing prod deps (lockfile cache)"
cd "$NEW_DIR"
(NPM_CONFIG_CACHE=/workspace/.npm-cache npm ci --omit=dev --no-audit --no-fund) >/workspace/npminstall.log 2>&1 \
  || { echo "[apply] npm ci FAILED"; tail -20 /workspace/npminstall.log; exit 1; }
echo "[apply] deps ready: $(ls node_modules | wc -l) top-level packages"
if [ -d "$APP_DIR" ]; then mv "$APP_DIR" "$OLD_DIR"; fi
mv "$NEW_DIR" "$APP_DIR"

echo "[apply] restarting api under supervisord"
SUPERVISOR_CONF=/etc/supervisor/conf.d/baanzon.conf
if [ -f "$SUPERVISOR_CONF" ]; then
  sed -i "/\[program:baanzon-api\]/,/^\[/ s#^command=.*#command=/bin/bash -lc 'exec node api/server/index.js'#" "$SUPERVISOR_CONF"
fi
supervisorctl reread >/dev/null 2>&1 || true
supervisorctl update >/dev/null 2>&1 || true
if ! supervisorctl restart baanzon-api; then
  echo "[apply] baanzon-api supervisor start failed"
  supervisorctl status baanzon-api || true
  if [ -f "$APP_DIR/logs/supervisor-api.log" ]; then
    tail -80 "$APP_DIR/logs/supervisor-api.log" || true
  fi
fi

echo "[apply] health-gate node http://127.0.0.1:3080/readyz"
# 450s: a cold start on the network volume (fresh node_modules, first Mongo
# connect) has taken well over 3 minutes under degraded I/O.
for i in $(seq 1 150); do
  if curl -sf http://127.0.0.1:3080/readyz >/dev/null; then echo "[apply] healthy"; printf '%s' "$NEW_SHA" > /workspace/.release-sha; rm -rf "$OLD_DIR" 2>/dev/null & exit 0; fi
  sleep 3
done
# rollback on failure
if [ -d "$OLD_DIR" ]; then
  echo "[apply] health gate FAILED - rolling back to previous release"
  mv "$APP_DIR" "$APP_DIR-tmp" 2>/dev/null || true
  mv "$OLD_DIR" "$APP_DIR" || { sleep 5; mv "$OLD_DIR" "$APP_DIR" || true; }
  sleep 2
  # restart can hit a transient spawn error on the network volume; keep
  # trying so a failed rollback never leaves the pod with no api running.
  supervisorctl restart baanzon-api || true
  for i in 1 2 3 4 5 6; do
    if supervisorctl status baanzon-api 2>/dev/null | grep -q RUNNING; then break; fi
    sleep 5
    supervisorctl start baanzon-api 2>/dev/null || true
  done
  supervisorctl status baanzon-api || true
  # only clean up the staged tree when the live .env is accounted for;
  # otherwise it may hold the only copy of .env for the next run's self-heal
  if [ -f "$APP_DIR/.env" ]; then rm -rf "$APP_DIR-tmp" 2>/dev/null || true; fi
fi
exit 1
