import { chatProjectWorkspaceMigration, runMigrations } from '@librechat/data-schemas';
import type {
  Migration,
  MigrationConnection,
  MigrationRunResult,
} from '@librechat/data-schemas';

/**
 * Boot-time Mongo migrations, applied once per deployment through the ledger
 * runner. `chatProjectWorkspaceMigration` builds the workspace-scoped project
 * index, which a deployment running with `MONGO_AUTO_INDEX=false` would
 * otherwise never receive.
 */
export const BOOT_MIGRATIONS: Migration[] = [chatProjectWorkspaceMigration];

export async function runBootMigrations(
  connection: MigrationConnection,
): Promise<MigrationRunResult> {
  return runMigrations({ connection, migrations: BOOT_MIGRATIONS });
}
