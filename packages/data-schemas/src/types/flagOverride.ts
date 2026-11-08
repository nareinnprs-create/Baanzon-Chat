import type { Document } from 'mongoose';
import type { TFeatureFlagKey, TFeatureFlagScope } from 'librechat-data-provider';

/**
 * A runtime feature-flag override row (blueprint B23/W15). Plain collection:
 * the row IS the lever, so no boot migration is needed — the unique index up
 * below is the only structure the store carries.
 */
export interface IFlagOverride {
  _id?: unknown;
  key: TFeatureFlagKey | string;
  scope: TFeatureFlagScope;
  /** Required for `organization` scope, absent for `global`. */
  scopeId?: string | null;
  value: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IFlagOverrideDocument extends Omit<IFlagOverride, '_id'>, Document {}

export interface UpsertFlagOverrideInput {
  key: TFeatureFlagKey | string;
  scope: TFeatureFlagScope;
  scopeId?: string;
  value: boolean;
}

export interface DeleteFlagOverrideResult {
  deletedCount: number;
}
