import type { TFeatureFlagMap, TFeatureFlagOverride } from 'librechat-data-provider';
import type { UpsertFlagOverrideInput } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { MembershipRecord, OrganizationRecord } from '../organizations/types';
import type { ServerRequest } from '~/types/http';

/**
 * Storage-shaped override row; `packages/api` never carries Mongoose types in
 * its exported signatures (see the workspace-boundary policy in AGENTS.md).
 */
export type FlagOverrideRow = TFeatureFlagOverride;

/** The data-schemas flag-override methods the service depends on. */
export interface FlagOverrideStore {
  listFlagOverrides(organizationId?: string): Promise<FlagOverrideRow[]>;
  upsertFlagOverride(input: UpsertFlagOverrideInput): Promise<FlagOverrideRow>;
}

export interface FlagServiceDeps {
  store: FlagOverrideStore;
}

/** The flag resolution + write surface the handlers delegate to. */
export interface FlagService {
  /**
   * Resolves the effective flag map: defaults <- config levers <- global DB
   * overrides <- organization DB overrides (later layers win).
   */
  resolveFlags(params: {
    config?: Partial<TFeatureFlagMap>;
    organizationId?: string;
  }): Promise<TFeatureFlagMap>;
  /** Idempotent override write; the store validates key/scope/scopeId shapes. */
  setFlag(input: UpsertFlagOverrideInput): Promise<FlagOverrideRow>;
}

/** The workspace-access seam the write guard ranks the requester through. */
export interface FlagAccessStore {
  getOrganization(organizationId: string): Promise<OrganizationRecord | null>;
  getMembership(organizationId: string, userId: string): Promise<MembershipRecord | null>;
}

export interface FlagHandlersDeps {
  service: FlagService;
  access: FlagAccessStore;
}

export interface FlagHandlers {
  /** `GET /api/flags`: the map resolved for the requesting caller. */
  getFlags: (req: ServerRequest, res: Response) => Promise<Response>;
  /** `PUT /api/flags/:key`: admin-or-owner-gated override write. */
  setFlag: (req: ServerRequest, res: Response) => Promise<Response>;
}

/** The authenticated request context handlers resolve once per call. */
export interface FlagHandlerActor {
  userId: string;
  tenantId?: string;
}
