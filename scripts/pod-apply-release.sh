#!/bin/bash
# Apply a release tarball onto the pod. Invoked by the deploy workflow over SSH.
set -euo pipefail
RELEASE_SRC=/workspace/_release/deploy-files
APP_DIR=/workspace/baanzon
NEW_DIR=/workspace/baanzon-next
OLD_DIR=/workspace/baanzon-old

echo "[apply] unpacking release"
rm -rf "$NEW_DIR" "$OLD_DIR"
mkdir -p "$NEW_DIR"
tar -xzf "$RELEASE_SRC/baanzon-app.tar.gz" -C "$NEW_DIR"

# preserve operator-managed files the tarball must not carry
for f in .env baanzon.yaml; do
  if [ -f "$APP_DIR/$f" ]; then cp "$APP_DIR/$f" "$NEW_DIR/$f"; fi
done
for d in images uploads logs; do
  mkdir -p "$NEW_DIR/$d"
  if [ -d "$APP_DIR/$d" ]; then cp -a "$APP_DIR/$d/." "$NEW_DIR/$d/" 2>/dev/null || true; fi
done

echo "[apply] swapping release"
if [ -d "$APP_DIR" ]; then mv "$APP_DIR" "$OLD_DIR"; fi
mv "$NEW_DIR" "$APP_DIR"

echo "[apply] restarting api under supervisord"
supervisorctl reread >/dev/null 2>&1 || true
supervisorctl restart baanzon-api 2>/dev/null || supervisorctl start baanzon-api 2>/dev/null || echo "[apply] WARN supervisor missing - manual remediation needed"

echo "[apply] health-gate node http://127.0.0.1:3080/readyz"
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:3080/readyz >/dev/null; then echo "[apply] healthy"; rm -rf "$OLD_DIR"; exit 0; fi
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
