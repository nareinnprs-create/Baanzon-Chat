/**
 * Backfills the Meilisearch `messages` and `convos` indexes from MongoDB.
 *
 * The mongoMeili plugin indexes documents on save, but deployments that had
 * `SEARCH` off (or existed before the plugin) carry unindexed history. This
 * script runs the same `syncWithMeili` reconciliation the server performs at
 * boot, without restarting anything.
 *
 * Usage (on the pod, from the repo root):
 *   SEARCH=true MEILI_HOST=http://meilisearch:7700 MEILI_MASTER_KEY=... \
 *     MONGO_URI=mongodb://... node scripts/backfill-meili.js
 *
 * Idempotent: documents already indexed (schema version matched) are skipped,
 * so it is safe to re-run until the log reports completion.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { createModels } = require('@librechat/data-schemas');

if (!process.env.MONGO_URI) {
  console.error('[backfill-meili] MONGO_URI is required');
  process.exit(1);
}
if (!process.env.MEILI_HOST || !process.env.MEILI_MASTER_KEY) {
  console.error('[backfill-meili] MEILI_HOST and MEILI_MASTER_KEY are required');
  process.exit(1);
}
if (process.env.SEARCH?.toLowerCase() !== 'true') {
  console.error('[backfill-meili] SEARCH=true is required (the plugin only attaches when it is set)');
  process.exit(1);
}

createModels(mongoose);

async function main() {
  const Message = mongoose.models.Message;
  const Conversation = mongoose.models.Conversation;
  for (const [name, Model] of [['messages', Message], ['convos', Conversation]]) {
    if (typeof Model.syncWithMeili !== 'function') {
      throw new Error(`${name} index plugin not registered — check MEILI_* env vars`);
    }
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('[backfill-meili] Connected. Syncing messages…');
  await Message.syncWithMeili();
  console.log('[backfill-meili] Messages done. Syncing conversations…');
  await Conversation.syncWithMeili();
  console.log('[backfill-meili] Conversations done.');
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('[backfill-meili] Failed:', error);
  process.exitCode = 1;
  mongoose.disconnect().finally(() => process.exit(1));
});
