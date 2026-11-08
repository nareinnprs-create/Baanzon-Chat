import type { Document, Types } from 'mongoose';

/** Which kind of principal a tool grant addresses. */
export type ToolPrincipalType = 'user' | 'role' | 'group';

/**
 * A grant of one tool to one principal (blueprint §45 `tool_permissions`).
 *
 * Grants are their own rows rather than a flag on the tool so a principal can
 * be granted or revoked independently of the tool's own definition, and so the
 * effective grant set for a principal is a single indexed read.
 */
export interface IToolPermission {
  _id?: Types.ObjectId;
  toolId: Types.ObjectId;
  principalType: ToolPrincipalType;
  /** The principal's id as the caller knows it (user, role or group id). */
  principalId: string;
  /** Whether the principal may invoke the tool. */
  granted: boolean;
  createdBy: Types.ObjectId;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IToolPermissionDocument extends Omit<IToolPermission, '_id'>, Document {}

export interface GrantToolPermissionInput {
  toolId: string;
  principalType: ToolPrincipalType;
  principalId: string;
  createdBy: string;
  granted?: boolean;
}

export interface ToolPermissionRef {
  toolId: string;
  principalType: ToolPrincipalType;
  principalId: string;
}
