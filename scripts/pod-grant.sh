#!/usr/bin/env bash
# stage=grant: grant one user a plan tier for N days, effectively unlimited
# within the window (a large pack pool draws after the daily tier cap and
# expires with the grant). Inputs via env: GRANT_USER_EMAIL, GRANT_PLAN,
# GRANT_DAYS. Prints the resulting grant, never other users' data.
set -u

: "${GRANT_USER_EMAIL:?GRANT_USER_EMAIL is required}"
GRANT_PLAN="${GRANT_PLAN:-pro}"
GRANT_DAYS="${GRANT_DAYS:-30}"

APP_DIR=/workspace/baanzon-next
if [ -f /workspace/data/active-port ] && [ "$(cat /workspace/data/active-port 2>/dev/null | tr -dc 0-9)" = "3090" ]; then
  APP_DIR=/workspace/baanzon
fi
NODE_BIN=$(command -v node || true)
[ -z "$NODE_BIN" ] && for c in /usr/local/bin/node /usr/bin/node; do
  [ -x "$c" ] && NODE_BIN="$c" && break
done
[ -n "$NODE_BIN" ] || { echo "[grant] FAILED: node not found"; exit 1; }

cd "$APP_DIR" || exit 1
GRANT_USER_EMAIL="$GRANT_USER_EMAIL" GRANT_PLAN="$GRANT_PLAN" GRANT_DAYS="$GRANT_DAYS" \
"$NODE_BIN" -e '
const mongoose = require("mongoose");
const email = (process.env.GRANT_USER_EMAIL || "").toLowerCase();
const plan = (process.env.GRANT_PLAN || "pro").toLowerCase();
const days = Math.max(1, parseInt(process.env.GRANT_DAYS || "30", 10));
(async () => {
  await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/LibreChat");
  const users = mongoose.connection.db.collection("users");
  const user = await users.findOne(
    { email },
    { projection: { _id: 1, email: 1, name: 1, subscriptionTier: 1 } },
  );
  if (!user) {
    console.log("[grant] FAILED: no user with email " + email);
    process.exit(1);
  }
  const now = new Date();
  const ends = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  await users.updateOne(
    { _id: user._id },
    {
      $set: {
        subscriptionTier: plan,
        subscriptionStatus: "active",
        packCredits: 99999,
        packExpiresAt: ends,
      },
    },
  );
  const subs = mongoose.connection.db.collection("subscriptions");
  await subs.updateOne(
    { userId: user._id, plan },
    {
      $set: {
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: ends,
        metadata: { grantedBy: "operator", grantedOn: now.toISOString() },
      },
      $setOnInsert: {
        userId: user._id,
        plan,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
  const check = await users.findOne(
    { _id: user._id },
    { projection: { subscriptionTier: 1, subscriptionStatus: 1, packCredits: 1, packExpiresAt: 1 } },
  );
  const expiresIso = check.packExpiresAt ? new Date(check.packExpiresAt).toISOString() : "none";
  console.log(
    "[grant] " +
      user.email +
      " (" + (user.name || "") + ") -> " +
      "tier=" + check.subscriptionTier +
      " status=" + check.subscriptionStatus +
      " packCredits=" + check.packCredits +
      " packExpiresAt=" + expiresIso,
  );
  console.log("[grant] grant window: " + now.toISOString() + " .. " + ends.toISOString());
  await mongoose.disconnect();
})().catch((e) => {
  console.error("[grant] FAILED:", e && e.message);
  process.exit(1);
});
'
echo "=== grant: done ==="
