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

echo "[apply] installing prod deps (persistent cache)"
cd "$NEW_DIR"
NPM_CONFIG_CACHE=/workspace/.npm-cache npm ci --omit=dev --no-audit --no-fund >/workspace/npminstall.log 2>&1 \
  || { echo "[apply] npm ci FAILED"; tail -5 /workspace/npminstall.log; exit 1; }
echo "[apply] deps ready: $(ls node_modules | wc -l) top-level packages"
if [ -d "$APP_DIR" ]; then mv "$APP_DIR" "$OLD_DIR"; fi
mv "$NEW_DIR" "$APP_DIR"

echo "[apply] restarting api under supervisord"
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
  rm -rf "$APP_DIR-tmp"
  supervisorctl restart baanzon-api || true
fi
exit 1
