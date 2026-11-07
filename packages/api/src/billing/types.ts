import type {
  TEntitlementLimitsConfig,
  TEntitlementLimitsMatrix,
  TEntitlementOverride,
  TEntitlementResource,
} from 'librechat-data-provider';
import type { UpsertPlanEntitlementInput } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { MembershipRecord, OrganizationRecord } from '../organizations/types';
import type { ServerRequest } from '~/types/http';

/**
 * Storage-shaped entitlement row; `packages/api` never carries Mongoose types in
 * its exported signatures (see the workspace-boundary policy in AGENTS.md).
 */
export type EntitlementRow = TEntitlementOverride;

/** The data-schemas plan-entitlement methods the service depends on. */
export interface EntitlementStore {
  listPlanEntitlements(organizationId?: string): Promise<EntitlementRow[]>;
  upsertPlanEntitlement(input: UpsertPlanEntitlementInput): Promise<EntitlementRow>;
}

/** The config-side limit levers the service layers under the stored rows. */
export type EntitlementLimitsConfig = TEntitlementLimitsConfig;

export interface EntitlementServiceDeps {
  store: EntitlementStore;
}

/** The entitlement resolution + write surface the handlers delegate to. */
export interface EntitlementService {
  /**
   * Resolves the effective per-plan limit matrix: unlimited defaults <- config
   * levers <- global DB entitlements <- organization DB entitlements (later
   * layers win).
   */
  resolveEntitlements(params: {
    config?: Partial<EntitlementLimitsConfig>;
    organizationId?: string;
  }): Promise<TEntitlementLimitsMatrix>;
  /** Idempotent entitlement write; the store validates plan/resource/scope shapes. */
  setEntitlement(input: UpsertPlanEntitlementInput): Promise<EntitlementRow>;
}

/** The workspace-access seam the write guard ranks the requester through. */
export interface EntitlementAccessStore {
  getOrganization(organizationId: string): Promise<OrganizationRecord | null>;
  getMembership(organizationId: string, userId: string): Promise<MembershipRecord | null>;
}

export interface EntitlementHandlersDeps {
  service: EntitlementService;
  access: EntitlementAccessStore;
}

export interface EntitlementHandlers {
  /** `GET /api/billing/entitlements`: the limit matrix resolved for the caller. */
  getEntitlements: (req: ServerRequest, res: Response) => Promise<Response>;
  /** `PUT /api/billing/entitlements/:plan/:resource`: org-admin-gated write. */
  setEntitlement: (req: ServerRequest, res: Response) => Promise<Response>;
}

/** The authenticated request context handlers resolve once per call. */
export interface EntitlementHandlerActor {
  userId: string;
  tenantId?: string;
}

/** Inputs for the pure `assertWithinLimit` enforcement helper. */
export interface AssertWithinLimitInput {
  /** Tracked resource being consumed (registry key or a caller-local label). */
  resource: TEntitlementResource | string;
  /** The resolved limit for the principal's plan; below 0 means unlimited. */
  limit: number;
  /** Usage already recorded for the principal on that resource. */
  used: number;
  /** Optional principal label carried onto the error for call-site logs. */
  principal?: string;
}
