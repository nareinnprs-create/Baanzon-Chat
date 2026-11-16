#!/bin/bash
# Restore drill: proves the nightly archives are restorable without touching
# prod data. Restores the newest mongo-*.gz into the scratch db `drill_restore`
# (nsFrom LibreChat.* -> nsTo drill_restore.*), prints document counts, drops
# the scratch db. Run on the pod: bash scripts/dr-drill-mongo.sh
set -e
ARCHIVE=$(ls -t /workspace/backups/mongo-*.gz 2>/dev/null | head -1)
[ -n "$ARCHIVE" ] || { echo "no archives in /workspace/backups"; exit 1; }
SLOT=$([ "$(cat /workspace/data/active-port 2>/dev/null)" = "3090" ] && echo /workspace/baanzon || echo /workspace/baanzon-next)
MONGO_URI=$(grep -m1 '^MONGO_URI=' "$SLOT/.env" | sed 's/^MONGO_URI=//; s/^"//; s/"$//')
[ -n "$MONGO_URI" ] || { echo "no MONGO_URI"; exit 1; }
[ -f "$SLOT/node_modules/mongodb/package.json" ] || { echo "mongodb driver not found in $SLOT/node_modules"; exit 1; }
echo "drill: restoring $(basename "$ARCHIVE") -> drill_restore.*"
mongorestore --uri "$MONGO_URI" --nsFrom='LibreChat.*' --nsTo='drill_restore.*' --archive="$ARCHIVE" --gzip --quiet
MONGO_URI_DRILL="$MONGO_URI" NODE_PATH="$SLOT/node_modules" node -e '
const { MongoClient } = require("mongodb");
(async () => {
  const c = new MongoClient(process.env.MONGO_URI_DRILL);
  await c.connect();
  const db = c.db("drill_restore");
  const names = (await db.listCollections().toArray()).map((x) => x.name);
  console.log("restored collections: " + names.length);
  for (const col of ["users", "messages", "conversations"]) {
    if (names.includes(col)) console.log("  " + col + ": " + (await db.collection(col).countDocuments({})) + " docs");
  }
  if (!names.includes("users")) { console.log("DRILL FAILED: no users collection"); process.exit(1); }
  console.log("DRILL PASS");
  await db.dropDatabase();
  console.log("scratch db dropped");
  await c.close();
})().catch((e) => { console.error("drill error: " + e.message); process.exit(1); });
'
