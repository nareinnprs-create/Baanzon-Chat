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
for i in 1 2 3 4; do
  if rm -rf "$NEW_DIR" "$OLD_DIR" 2>/dev/null; then break; fi
  echo "[apply] rm retry $i (network-volume rm race)"; sleep 5
done
rm -rf "$NEW_DIR" "$OLD_DIR" 2>/dev/null || true
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

# Read only the two required keys; do not source the file because provider URLs
# and secrets may contain shell metacharacters or unrelated dotenv lines.
env_value() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); sub(/[[:space:]]*\r?$/, ""); print; exit }' "$APP_DIR/.env"
}
if [ -z "$(env_value OPRAIZ_API_KEY)" ] || [ -z "$(env_value OPRAIZ_BASEURL)" ]; then
  echo "[apply] REQUIRED: OPRAIZ_API_KEY and OPRAIZ_BASEURL must be configured"
  exit 1
fi

echo "[apply] validating Cloudflare provider routing"
node "$NEW_DIR/scripts/validate-provider-routing.js" "$NEW_DIR/baanzon.yaml" --fix
node "$NEW_DIR/scripts/validate-provider-routing.js" "$NEW_DIR/baanzon.yaml"

echo "[apply] preparing prod deps (lockfile cache)"
cd "$NEW_DIR"
LOCK_SHA=$(sha256sum package-lock.json | cut -d' ' -f1)
DEPS_ROOT=/workspace/.prod-deps
DEPS_DIR="$DEPS_ROOT/$LOCK_SHA-workspaces-v2"
DEPS_TMP="$DEPS_ROOT/.install-$LOCK_SHA-workspaces-v2-$$"
mkdir -p "$DEPS_ROOT"
if [ ! -f "$DEPS_DIR/.ready" ]; then
  rm -rf "$DEPS_TMP"
  mkdir -p "$DEPS_TMP"
  (NPM_CONFIG_CACHE=/workspace/.npm-cache npm ci --omit=dev --no-audit --no-fund) >/workspace/npminstall.log 2>&1 \
    || { echo "[apply] npm ci FAILED"; tail -5 /workspace/npminstall.log; rm -rf "$DEPS_TMP"; exit 1; }
  mv node_modules "$DEPS_TMP/node_modules"
  touch "$DEPS_TMP/.ready"
  rm -rf "$DEPS_DIR"
  mv "$DEPS_TMP" "$DEPS_DIR"
else
  echo "[apply] reusing prod deps for lockfile $LOCK_SHA"
fi
rm -rf node_modules
ln -s "$DEPS_DIR/node_modules" node_modules
echo "[apply] deps ready: $(ls node_modules | wc -l) top-level packages"
if [ -d "$APP_DIR" ]; then mv "$APP_DIR" "$OLD_DIR"; fi
mv "$NEW_DIR" "$APP_DIR"

echo "[apply] restarting api under supervisord"
SUPERVISOR_CONF=/etc/supervisor/conf.d/baanzon.conf
if [ -f "$SUPERVISOR_CONF" ]; then
  sed -i "s#command=/bin/bash -lc 'set -a; source /workspace/baanzon/.env; exec node api/server/index.js'#command=node api/server/index.js#" "$SUPERVISOR_CONF"
fi
supervisorctl reread >/dev/null 2>&1 || true
supervisorctl restart all >/dev/null 2>&1 || true
supervisorctl restart baanzon-api 2>/dev/null || supervisorctl start baanzon-api 2>/dev/null || echo "[apply] WARN supervisor missing - manual remediation needed"

echo "[apply] health-gate node http://127.0.0.1:3080/readyz"
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:3080/readyz >/dev/null; then echo "[apply] healthy"; printf '%s' "$NEW_SHA" > /workspace/.release-sha; rm -rf "$OLD_DIR" 2>/dev/null & exit 0; fi
  sleep 3
done
# rollback on failure
if [ -d "$OLD_DIR" ]; then
  echo "[apply] health gate FAILED - rolling back to previous release"
  mv "$APP_DIR" "$APP_DIR-tmp" 2>/dev/null || true
  mv "$OLD_DIR" "$APP_DIR"
  supervisorctl restart baanzon-api || true
  rm -rf "$APP_DIR-tmp" 2>/dev/null || true
fi
exit 1
