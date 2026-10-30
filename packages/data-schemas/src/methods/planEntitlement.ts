import {
  ENTITLEMENT_PLAN_KEYS,
  ENTITLEMENT_RESOURCE_KEYS,
  ENTITLEMENT_SCOPES,
  UNLIMITED_LIMIT,
} from 'librechat-data-provider';
import type { FilterQuery, Model } from 'mongoose';
import type {
  DeletePlanEntitlementResult,
  IPlanEntitlement,
  IPlanEntitlementDocument,
  UpsertPlanEntitlementInput,
} from '~/types/planEntitlement';
import { isValidObjectIdString } from '~/utils/objectId';

export interface PlanEntitlementMethods {
  /** Reads every `global` entitlement, plus the `organization` ones named by the id. */
  listPlanEntitlements(organizationId?: string): Promise<IPlanEntitlement[]>;
  /** Idempotent one-row writer - the only sanctioned path for entitlement writes. */
  upsertPlanEntitlement(input: UpsertPlanEntitlementInput): Promise<IPlanEntitlement>;
  deletePlanEntitlement(input: UpsertPlanEntitlementInput): Promise<DeletePlanEntitlementResult>;
}

export function createPlanEntitlementMethods(
  mongoose: typeof import('mongoose'),
): PlanEntitlementMethods {
  const PlanEntitlement = (): Model<IPlanEntitlementDocument> =>
    mongoose.models.PlanEntitlement as Model<IPlanEntitlementDocument>;

  const knownPlans = new Set<string>(ENTITLEMENT_PLAN_KEYS as readonly string[]);
  const knownResources = new Set<string>(ENTITLEMENT_RESOURCE_KEYS as readonly string[]);
  const knownScopes = new Set<string>(ENTITLEMENT_SCOPES as readonly string[]);

  function validateInput(input: UpsertPlanEntitlementInput): void {
    if (!knownPlans.has(input.plan)) {
      throw new Error(`Unknown entitlement plan: ${input.plan}`);
    }
    if (!knownResources.has(input.resource)) {
      throw new Error(`Unknown entitlement resource: ${input.resource}`);
    }
    if (!knownScopes.has(input.scope)) {
      throw new Error('Unknown entitlement scope');
    }
    if (!Number.isFinite(input.limit) || input.limit < UNLIMITED_LIMIT) {
      throw new Error('An entitlement limit must be a finite number at or above -1');
    }
    if (input.scope === 'global') {
      if (input.scopeId) {
        throw new Error('A global entitlement must not carry a scopeId');
      }
      return;
    }
    if (!input.scopeId || !isValidObjectIdString(input.scopeId)) {
      throw new Error('An organization entitlement requires a valid scopeId');
    }
  }

  async function upsertPlanEntitlement(
    input: UpsertPlanEntitlementInput,
  ): Promise<IPlanEntitlement> {
    validateInput(input);

    const { plan, resource, scope, limit } = input;
    const scopeId = scope === 'global' ? null : input.scopeId;
    const filter: FilterQuery<IPlanEntitlementDocument> = { plan, resource, scope, scopeId };
    const doc = await PlanEntitlement().findOneAndUpdate(
      filter,
      { $set: { limit } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return doc.toObject() as IPlanEntitlement;
  }

  async function listPlanEntitlements(organizationId?: string): Promise<IPlanEntitlement[]> {
    const filter: FilterQuery<IPlanEntitlementDocument> = organizationId
      ? {
          $or: [{ scope: 'global' }, { scope: 'organization', scopeId: organizationId }],
        }
      : { scope: 'global' };
    return await PlanEntitlement().find(filter).lean<IPlanEntitlement[]>();
  }

  async function deletePlanEntitlement(
    input: UpsertPlanEntitlementInput,
  ): Promise<DeletePlanEntitlementResult> {
    validateInput(input);

    const { plan, resource, scope } = input;
    const scopeId = scope === 'global' ? null : input.scopeId;
    const result = await PlanEntitlement().deleteOne({ plan, resource, scope, scopeId });
    return { deletedCount: result.deletedCount ?? 0 };
  }

  return {
    listPlanEntitlements,
    upsertPlanEntitlement,
    deletePlanEntitlement,
  };
}
