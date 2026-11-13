#!/usr/bin/env bash
# Blue-green deploy apply for the pod. Runs on the pod over SSH from GH Actions.
#
# Steady state: the gate process owns 127.0.0.1:3080 (cloudflared's target) and
# never restarts. Two api slots - blue (baanzon-api, /workspace/baanzon, :3090)
# and green (baanzon-api-next, /workspace/baanzon-next, :3091) - alternate as
# the active release via /workspace/data/active-port, which the gate re-reads
# per request. Each release stages the INACTIVE slot, boots and health-gates it
# there (the 5-8 minute cold start is invisible: the active release keeps
# serving), then flips one file. The previous release stays on disk as instant
# rollback (start its program + flip the file back).
set -u

RELEASE_SRC=/workspace/_release
GATE_DIR=/workspace/gate
NEW_SHA=$(sha256sum "$RELEASE_SRC/baanzon-app.tar.gz" 2>/dev/null | cut -d' ' -f1 || echo unknown)

if [ ! -f "$RELEASE_SRC/baanzon-app.tar.gz" ]; then
  echo "[apply] no release tarball at $RELEASE_SRC - nothing to do"
  exit 0
fi

# already applied and serving: skip the redundant redeploy
if [ -f /workspace/.release-sha ] && [ "$(cat /workspace/.release-sha)" = "$NEW_SHA" ]; then
  if curl -sf http://127.0.0.1:3080/readyz >/dev/null; then
    echo "[apply] release $NEW_SHA already applied and healthy - skipping"
    exit 0
  fi
fi

BLUE_DIR=/workspace/baanzon        BLUE_PORT=3090  BLUE_PROG=baanzon-api
GREEN_DIR=/workspace/baanzon-next  GREEN_PORT=3091 GREEN_PROG=baanzon-api-next
ACTIVE_FILE=/workspace/data/active-port

mkdir -p /workspace/data "$GATE_DIR" "$BLUE_DIR/logs" "$GREEN_DIR/logs"

# ---- which slot is active? -------------------------------------------------
if [ -f "$ACTIVE_FILE" ]; then
  ACTIVE_PORT=$(cat "$ACTIVE_FILE" 2>/dev/null | tr -dc 0-9)
fi
case "${ACTIVE_PORT:-}" in
  3091) ACTIVE_DIR=$GREEN_DIR; ACTIVE_PROG=$GREEN_PROG ;;
  *)    ACTIVE_PORT=3090; ACTIVE_DIR=$BLUE_DIR; ACTIVE_PROG=$BLUE_PROG ;;
esac
if [ "$ACTIVE_PORT" = "$BLUE_PORT" ]; then
  STAGE_DIR=$GREEN_DIR; STAGE_PORT=$GREEN_PORT; STAGE_PROG=$GREEN_PROG
else
  STAGE_DIR=$BLUE_DIR; STAGE_PORT=$BLUE_PORT; STAGE_PROG=$BLUE_PROG
fi
echo "[apply] active: $ACTIVE_PROG ($ACTIVE_DIR) :$ACTIVE_PORT - staging into $STAGE_PROG ($STAGE_DIR) :$STAGE_PORT"

# ---- stop the stale staging release before overwriting its tree ------------
if supervisorctl status "$STAGE_PROG" 2>/dev/null | grep -q RUNNING; then
  echo "[apply] stopping stale $STAGE_PROG (not serving; active is $ACTIVE_PROG)"
  supervisorctl stop "$STAGE_PROG" >/dev/null 2>&1 || true
fi

# ---- stage the new tree ----------------------------------------------------
for i in 1 2 3 4; do
  if rm -rf "$STAGE_DIR" 2>/dev/null; then break; fi
  echo "[apply] rm retry $i (network-volume rm race)"; sleep 5
done
rm -rf "$STAGE_DIR" 2>/dev/null || true
mkdir -p "$STAGE_DIR/logs"
tar --no-same-owner --no-same-permissions -xzf "$RELEASE_SRC/baanzon-app.tar.gz" -C "$STAGE_DIR"

# operator-managed files: .env is operator-managed (tarball must not carry it);
# baanzon.yaml is git-tracked, so the tarball's copy wins and the active slot's
# copy is only a fallback for tarballs built before it was tracked
if [ -f "$ACTIVE_DIR/.env" ]; then cp "$ACTIVE_DIR/.env" "$STAGE_DIR/.env"; fi
if [ ! -f "$STAGE_DIR/baanzon.yaml" ] && [ -f "$ACTIVE_DIR/baanzon.yaml" ]; then
  cp "$ACTIVE_DIR/baanzon.yaml" "$STAGE_DIR/baanzon.yaml"
fi
for d in images uploads; do
  mkdir -p "$STAGE_DIR/$d"
  if [ -d "$ACTIVE_DIR/$d" ]; then cp -a "$ACTIVE_DIR/$d/." "$STAGE_DIR/$d/" 2>/dev/null || true; fi
done

if [ ! -f "$STAGE_DIR/.env" ]; then
  echo "[apply] REQUIRED: no .env in $ACTIVE_DIR to carry forward - refusing to stage"
  exit 1
fi

# single-replica pod: without this the schedules engine refuses to arm and
# schedule writes 503 forever (matches the previous live deployment's setting)
if ! grep -qE "^SCHEDULES_SINGLE_PROCESS=" "$STAGE_DIR/.env"; then
  printf 'SCHEDULES_SINGLE_PROCESS=true\n' >> "$STAGE_DIR/.env"
fi

env_value() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); sub(/[[:space:]]*\r?$/, ""); print; exit }' "$STAGE_DIR/.env"
}
if [ -z "$(env_value OPRAIZ_API_KEY)" ] || [ -z "$(env_value OPRAIZ_BASEURL)" ]; then
  echo "[apply] WARNING: OPRAIZ_API_KEY and/or OPRAIZ_BASEURL empty - Opraiz models will not resolve until the operator re-enters them"
fi

echo "[apply] validating served model catalog (yaml parse + public-key contract)"
# validator runs before npm ci; resolve js-yaml/librechat-data-provider from the live slot
if ! NODE_PATH="$ACTIVE_DIR/node_modules" node "$STAGE_DIR/scripts/validate-provider-routing.js" "$STAGE_DIR/baanzon.yaml"; then
  echo "[apply] baanzon.yaml validation FAILED - active release untouched, no flip"
  exit 1
fi

echo "[apply] preparing prod deps (lockfile cache)"
cd "$STAGE_DIR" || exit 1
(NPM_CONFIG_CACHE=/workspace/.npm-cache npm ci --omit=dev --no-audit --no-fund) >/workspace/npminstall.log 2>&1 \
  || { echo "[apply] npm ci FAILED"; tail -20 /workspace/npminstall.log; exit 1; }
echo "[apply] deps ready: $(ls node_modules | wc -l) top-level packages"

# ---- db audit: repoint MONGO_URI before the new slot boots ------------------
# a stale pointer to an empty database breaks every login until the next
# rescue - audit per local database and repoint when the live one is empty
NODE_BIN=$(command -v node || true)
[ -z "$NODE_BIN" ] && for c in /usr/local/bin/node /usr/bin/node $(ls -t /root/.nvm/versions/node/*/bin/node 2>/dev/null | head -1); do
  [ -x "$c" ] && NODE_BIN="$c" && break
done
if [ -n "$NODE_BIN" ] && [ -d "$STAGE_DIR/node_modules/mongodb" ]; then
  AUDIT=$("$NODE_BIN" -e '
const path = process.argv[1];
let MongoClient;
try { MongoClient = require(path).MongoClient || require(path).default.MongoClient; }
catch (e) { console.log("audit-skip: no mongodb driver"); process.exit(0); }
(async () => {
  const c = new MongoClient("mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 5000 });
  await c.connect();
  const dbs = await c.db("admin").admin().listDatabases();
  let best = { name: "", n: -1 };
  for (const d of dbs.databases) {
    if (["admin","local","config"].includes(d.name)) continue;
    let n = 0;
    try { n = await c.db(d.name).collection("users").countDocuments({}); } catch (e) {}
    if (n > best.n) best = { name: d.name, n };
  }
  console.log("best-db=" + best.name + " users=" + best.n);
  await c.close();
})().catch(e => console.log("audit-error: " + String(e).slice(0,120)));
' "$STAGE_DIR/node_modules/mongodb" 2>/dev/null || true)
  echo "[apply] db audit: $AUDIT"
  CUR_DB=$(grep -oE "^MONGO_URI=mongodb://[^/]+/[^?[:space:]]+" "$STAGE_DIR/.env" 2>/dev/null | sed 's#.*/##')
  BEST_DB=$(echo "$AUDIT" | grep -oE "best-db=[^ ]+" | cut -d= -f2)
  BEST_N=$(echo "$AUDIT" | grep -oE "users=[0-9]+" | tail -1 | cut -d= -f2)
  if [ -n "$BEST_DB" ] && [ -n "$BEST_N" ] && [ "$BEST_N" -gt 0 ] && [ "$BEST_DB" != "$CUR_DB" ]; then
    echo "[apply] repointing MONGO_URI from '$CUR_DB' to '$BEST_DB'"
    grep -vE "^MONGO_URI=" "$STAGE_DIR/.env" > "$STAGE_DIR/.env.tmp"
    printf 'MONGO_URI=mongodb://127.0.0.1:27017/%s\n' "$BEST_DB" >> "$STAGE_DIR/.env.tmp"
    mv "$STAGE_DIR/.env.tmp" "$STAGE_DIR/.env"
    chmod 600 "$STAGE_DIR/.env"
  fi
fi

# ---- one-time migration: install gate + move api off 3080 -------------------
# The gate owns 3080 for the pod's lifetime; the api slots move to 3090/3091.
# This is the ONLY deploy that interrupts (the api restarts onto 3090); every
# later deploy flips the active-port file with zero downtime.
SUPERVISOR_CONF=/etc/supervisor/conf.d/baanzon.conf
if ! grep -q "baanzon-gate" "$SUPERVISOR_CONF" 2>/dev/null; then
  echo "[apply] MIGRATION: installing blue-green gate"
  cp "$STAGE_DIR/scripts/pod-gate.js" "$GATE_DIR/pod-gate.js" || exit 1
  # surgically replace the api block and append gate + second slot
  awk 'BEGIN{skip=0} /^\[program:(baanzon-api|baanzon-api-next|baanzon-gate)\]/{skip=1; next} skip && /^\[/{skip=0} !skip' \
    "$SUPERVISOR_CONF" > "$SUPERVISOR_CONF.tmp" 2>/dev/null || cp "$SUPERVISOR_CONF" "$SUPERVISOR_CONF.tmp"
  cat >> "$SUPERVISOR_CONF.tmp" <<'EOF'

[program:baanzon-gate]
command=/bin/bash -lc 'exec node /workspace/gate/pod-gate.js'
directory=/workspace
autostart=true
autorestart=true
stopasgroup=true
environment=ACTIVE_PORT_FILE="/workspace/data/active-port",GATE_PORT="3080",GATE_DEFAULT_PORT="3090"
stdout_logfile=/workspace/baanzon/logs/supervisor-gate.log
redirect_stderr=true

[program:baanzon-api]
command=/bin/bash -lc 'exec node api/server/index.js'
directory=/workspace/baanzon
autostart=true
autorestart=true
stopasgroup=true
environment=NODE_ENV="production",PORT="3090"
stdout_logfile=/workspace/baanzon/logs/supervisor-api.log
redirect_stderr=true

[program:baanzon-api-next]
command=/bin/bash -lc 'exec node api/server/index.js'
directory=/workspace/baanzon-next
autostart=true
autorestart=true
stopasgroup=true
environment=NODE_ENV="production",PORT="3091"
stdout_logfile=/workspace/baanzon-next/logs/supervisor-api.log
redirect_stderr=true
EOF
  mv "$SUPERVISOR_CONF.tmp" "$SUPERVISOR_CONF"
  printf '%s' "$BLUE_PORT" > "$ACTIVE_FILE"
  supervisorctl reread >/dev/null 2>&1 || true
  supervisorctl update >/dev/null 2>&1 || true
  # the api restarts onto 3090 here - announced one-time cut
  for i in 1 2 3 4 5 6; do
    if supervisorctl status baanzon-gate 2>/dev/null | grep -q RUNNING; then break; fi
    sleep 3; supervisorctl start baanzon-gate >/dev/null 2>&1 || true
  done
  echo "[apply] waiting for api on :$BLUE_PORT (migration cold start)"
  for i in $(seq 1 150); do
    if curl -sf "http://127.0.0.1:$BLUE_PORT/readyz" >/dev/null; then break; fi
    sleep 3
  done
  if ! curl -sf "http://127.0.0.1:$BLUE_PORT/readyz" >/dev/null; then
    echo "[apply] MIGRATION FAILED: api did not come up on :$BLUE_PORT"
    supervisorctl status || true
    exit 1
  fi
  if ! curl -sf "http://127.0.0.1:3080/readyz" >/dev/null; then
    echo "[apply] WARNING: gate not answering on 3080 yet - checking again"
    for i in 1 2 3 4 5; do
      if curl -sf "http://127.0.0.1:3080/readyz" >/dev/null; then break; fi
      sleep 3; supervisorctl start baanzon-gate >/dev/null 2>&1 || true
    done
    curl -sf "http://127.0.0.1:3080/readyz" >/dev/null || { echo "[apply] MIGRATION FAILED: gate not serving"; supervisorctl status baanzon-gate || true; exit 1; }
  fi
  echo "[apply] MIGRATION COMPLETE: gate serving :3080 -> api :$BLUE_PORT"
fi

# ---- boot the staging slot and health-gate it there ------------------------
echo "[apply] starting $STAGE_PROG on :$STAGE_PORT"
supervisorctl reread >/dev/null 2>&1 || true
supervisorctl update >/dev/null 2>&1 || true
supervisorctl start "$STAGE_PROG" >/dev/null 2>&1 || true
for i in 1 2 3 4 5 6; do
  if supervisorctl status "$STAGE_PROG" 2>/dev/null | grep -q RUNNING; then break; fi
  sleep 5; supervisorctl start "$STAGE_PROG" >/dev/null 2>&1 || true
done

echo "[apply] health-gate node http://127.0.0.1:$STAGE_PORT/readyz (active keeps serving meanwhile)"
for i in $(seq 1 150); do
  if curl -sf "http://127.0.0.1:$STAGE_PORT/readyz" >/dev/null; then
    echo "[apply] staging slot healthy after ~$((i*3))s"
    break
  fi
  sleep 3
done
if ! curl -sf "http://127.0.0.1:$STAGE_PORT/readyz" >/dev/null; then
  echo "[apply] staging slot FAILED health gate - active release untouched, no flip"
  supervisorctl stop "$STAGE_PROG" >/dev/null 2>&1 || true
  supervisorctl status "$ACTIVE_PROG" || true
  if [ -f "$STAGE_DIR/logs/supervisor-api.log" ]; then tail -40 "$STAGE_DIR/logs/supervisor-api.log" || true; fi
  exit 1
fi

# ---- flip: one file write, gate routes new connections to the new slot -----
printf '%s' "$STAGE_PORT" > "$ACTIVE_FILE"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "http://127.0.0.1:3080/readyz" >/dev/null; then break; fi
  sleep 3
done
if ! curl -sf "http://127.0.0.1:3080/readyz" >/dev/null; then
  echo "[apply] flip verification FAILED - reverting gate to :$ACTIVE_PORT"
  printf '%s' "$ACTIVE_PORT" > "$ACTIVE_FILE"
  supervisorctl stop "$STAGE_PROG" >/dev/null 2>&1 || true
  exit 1
fi

# ---- retire the previous release (kept on disk for instant rollback) -------
supervisorctl stop "$ACTIVE_PROG" >/dev/null 2>&1 || true
printf '%s' "$NEW_SHA" > /workspace/.release-sha
echo "[apply] flipped: gate :3080 -> $STAGE_PROG :$STAGE_PORT (release $NEW_SHA)"
echo "[apply] previous release kept in $ACTIVE_DIR - rollback: start $ACTIVE_PROG + echo $ACTIVE_PORT > $ACTIVE_FILE"
supervisorctl status | grep baanzon || true
exit 0
