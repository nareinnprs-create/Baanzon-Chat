import type {
  TEntitlementPlan,
  TEntitlementResource,
  TEntitlementScope,
} from 'librechat-data-provider';
import type { Document } from 'mongoose';

/**
 * A plan-limit entitlement row (blueprint §56/B18). Plain collection mirroring
 * `flag_overrides`: the row IS the lever, so no boot migration is needed - the
 * unique index below is the only structure the store carries. `UNLIMITED_LIMIT`
 * (-1) is the ship default; a non-negative `limit` caps one resource for one
 * plan, layered global-first and organization-second over the config levers.
 */
export interface IPlanEntitlement {
  _id?: unknown;
  plan: TEntitlementPlan;
  resource: TEntitlementResource;
  scope: TEntitlementScope;
  /** Required for `organization` scope, absent for `global`. */
  scopeId?: string | null;
  /** Non-negative cap, or `UNLIMITED_LIMIT` (-1). */
  limit: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IPlanEntitlementDocument extends Omit<IPlanEntitlement, '_id'>, Document {}

export interface UpsertPlanEntitlementInput {
  plan: TEntitlementPlan;
  resource: TEntitlementResource;
  scope: TEntitlementScope;
  scopeId?: string;
  limit: number;
}

export interface DeletePlanEntitlementResult {
  deletedCount: number;
}
