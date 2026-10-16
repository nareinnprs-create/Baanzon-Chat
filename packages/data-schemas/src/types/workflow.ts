import type { Document, Types } from 'mongoose';

/**
 * A named automation definition (blueprint §45 `workflows`).
 *
 * The row holds the step graph and whether the workflow is enabled; each
 * execution is its own `workflow_run`. The definition is stored opaquely so the
 * graph shape can evolve without a schema migration.
 */
export interface IWorkflow {
  _id?: Types.ObjectId;
  name: string;
  /** URL-safe unique handle within the tenant. */
  slug: string;
  description?: string;
  /** Ordered step graph; opaque to this package. */
  definition?: Record<string, unknown>;
  enabled: boolean;
  /** The user who created the workflow. */
  createdBy: Types.ObjectId;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IWorkflowDocument extends Omit<IWorkflow, '_id'>, Document {}

export interface CreateWorkflowInput {
  name: string;
  createdBy: string;
  /** Derived from `name` when omitted. */
  slug?: string;
  description?: string;
  definition?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  definition?: Record<string, unknown>;
  enabled?: boolean;
}

export interface ListWorkflowsOptions {
  enabledOnly?: boolean;
}
