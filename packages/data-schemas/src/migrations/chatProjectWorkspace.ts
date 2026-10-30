import type { Connection } from 'mongoose';
import type { Migration, MigrationContext } from './ledger';
import { buildIndexWithRetry } from '~/utils/retry';

/**
 * Project -> workspace link (blueprint §57). The `workspaceId` field on
 * `chatprojects` is optional and no backfill runs: a project that predates
 * workspaces has no workspace, and there is no way to infer one. This migration
 * therefore only builds the index the new workspace-scoped list reads, so a
 * deployment running with `MONGO_AUTO_INDEX` disabled still gets it.
 *
 * The spec is shared with `schema/chatProject.ts` — the two must stay byte-equal
 * in keys, name and options or `syncIndexes` will drop and rebuild on every boot.
 */
export const CHAT_PROJECT_WORKSPACE_INDEX = {
  collection: 'chatprojects',
  keys: {
    workspaceId: 1,
    user: 1,
    lastConversationAt: -1,
    _id: -1,
  } as Record<string, 1 | -1>,
  options: {
    name: 'workspaceId_1_user_1_lastConversationAt_-1__id_-1',
    partialFilterExpression: { workspaceId: { $exists: true } },
  },
} as const;

/**
 * Creates the workspace-scoped chat project index. Idempotent: `createIndex` of
 * an existing spec is a no-op, and a partial index over documents that all lack
 * the field builds instantly.
 */
export async function createChatProjectWorkspaceIndex(
  connection: Connection,
): Promise<{ name: string }> {
  const collection = connection.db!.collection(CHAT_PROJECT_WORKSPACE_INDEX.collection);
  const name = await buildIndexWithRetry(
    () => collection.createIndex(CHAT_PROJECT_WORKSPACE_INDEX.keys, CHAT_PROJECT_WORKSPACE_INDEX.options),
    `createIndex(${CHAT_PROJECT_WORKSPACE_INDEX.collection}.${CHAT_PROJECT_WORKSPACE_INDEX.options.name})`,
  );
  return { name };
}

/**
 * The same change as a P7.2 ledger entry, for runners that compose their own
 * list. `up` takes its storage handle from the context the runner injects — the
 * structural connection type is enough, since building an index needs only
 * `createIndex`.
 */
export const chatProjectWorkspaceMigration: Migration = {
  id: '002-chat-project-workspace',
  name: 'chat project workspace link',
  engine: 'mongo',
  async up(context: MigrationContext): Promise<void> {
    const db = context.connection?.db;
    if (db == null) {
      throw new Error('chatProjectWorkspace: an injected connection is required');
    }
    const collection = db.collection(CHAT_PROJECT_WORKSPACE_INDEX.collection);
    await buildIndexWithRetry(
      () => collection.createIndex(CHAT_PROJECT_WORKSPACE_INDEX.keys, CHAT_PROJECT_WORKSPACE_INDEX.options),
      `createIndex(${CHAT_PROJECT_WORKSPACE_INDEX.collection}.${CHAT_PROJECT_WORKSPACE_INDEX.options.name})`,
    );
  },
};