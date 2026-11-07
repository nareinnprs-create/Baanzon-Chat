import type { Document, Types } from 'mongoose';

/** How a tool is provided: built in, an MCP server, or a user-defined action. */
export type ToolType = 'native' | 'mcp' | 'action' | 'custom';

/**
 * A tool definition (blueprint §45 `tools`).
 *
 * The row stores the declaration, not an execution: what the tool is called,
 * how it is invoked and whether it is available. Run history lives in its own
 * collection, grants live in `tool_permissions`, and revision snapshots live in
 * `tool_versions`.
 */
export interface ITool {
  _id?: Types.ObjectId;
  /** Unique handle within the tenant. */
  name: string;
  description?: string;
  type: ToolType;
  /** Invocation contract (JSON schema or provider payload); opaque to this package. */
  definition?: Record<string, unknown>;
  enabled: boolean;
  /** The user who registered the tool. */
  createdBy: Types.ObjectId;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IToolDocument extends Omit<ITool, '_id'>, Document {}

export interface CreateToolInput {
  name: string;
  type: ToolType;
  createdBy: string;
  description?: string;
  definition?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateToolInput {
  description?: string;
  definition?: Record<string, unknown>;
  enabled?: boolean;
}

export interface ListToolsOptions {
  type?: ToolType;
  enabledOnly?: boolean;
}
