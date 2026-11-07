import { FEATURE_FLAG_KEYS, FEATURE_FLAG_SCOPES } from 'librechat-data-provider';
import type { FilterQuery, Model } from 'mongoose';
import type {
  DeleteFlagOverrideResult,
  IFlagOverride,
  IFlagOverrideDocument,
  UpsertFlagOverrideInput,
} from '~/types/flagOverride';
import { isValidObjectIdString } from '~/utils/objectId';

export interface FlagOverrideMethods {
  /** Reads every `global` override, plus the `organization` ones named by the id. */
  listFlagOverrides(organizationId?: string): Promise<IFlagOverride[]>;
  /** Idempotent one-row writer — the only sanctioned path for override writes. */
  upsertFlagOverride(input: UpsertFlagOverrideInput): Promise<IFlagOverride>;
  deleteFlagOverride(input: UpsertFlagOverrideInput): Promise<DeleteFlagOverrideResult>;
}

export function createFlagOverrideMethods(
  mongoose: typeof import('mongoose'),
): FlagOverrideMethods {
  const FlagOverride = (): Model<IFlagOverrideDocument> =>
    mongoose.models.FlagOverride as Model<IFlagOverrideDocument>;

  const knownKeys = new Set<string>(FEATURE_FLAG_KEYS as readonly string[]);
  const knownScopes = new Set<string>(FEATURE_FLAG_SCOPES as readonly string[]);

  function validateInput(input: UpsertFlagOverrideInput): void {
    if (!knownKeys.has(input.key)) {
      throw new Error(`Unknown feature flag: ${input.key}`);
    }
    if (!knownScopes.has(input.scope)) {
      throw new Error(`Unknown feature flag scope: ${input.scope}`);
    }
    if (input.scope === 'global') {
      if (input.scopeId) {
        throw new Error('A global flag override must not carry a scopeId');
      }
      return;
    }
    if (!input.scopeId || !isValidObjectIdString(input.scopeId)) {
      throw new Error('An organization flag override requires a valid scopeId');
    }
  }

  async function upsertFlagOverride(input: UpsertFlagOverrideInput): Promise<IFlagOverride> {
    validateInput(input);

    const { key, scope, value } = input;
    const scopeId = scope === 'global' ? null : input.scopeId;
    const filter: FilterQuery<IFlagOverrideDocument> = { key, scope, scopeId };
    const doc = await FlagOverride().findOneAndUpdate(
      filter,
      { $set: { value } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return doc.toObject() as IFlagOverride;
  }

  async function listFlagOverrides(organizationId?: string): Promise<IFlagOverride[]> {
    const filter: FilterQuery<IFlagOverrideDocument> = organizationId
      ? {
          $or: [{ scope: 'global' }, { scope: 'organization', scopeId: organizationId }],
        }
      : { scope: 'global' };
    return await FlagOverride().find(filter).lean<IFlagOverride[]>();
  }

  async function deleteFlagOverride(input: UpsertFlagOverrideInput): Promise<DeleteFlagOverrideResult> {
    validateInput(input);

    const { key, scope } = input;
    const scopeId = scope === 'global' ? null : input.scopeId;
    const result = await FlagOverride().deleteOne({ key, scope, scopeId });
    return { deletedCount: result.deletedCount ?? 0 };
  }

  return {
    listFlagOverrides,
    upsertFlagOverride,
    deleteFlagOverride,
  };
}
