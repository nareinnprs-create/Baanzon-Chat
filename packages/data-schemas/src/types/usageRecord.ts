import type { Document, Types } from 'mongoose';

/** The ownership level a metered record is attributed to. */
export type UsageRecordScope = 'user' | 'organization' | 'workspace';

/**
 * A metered usage observation (blueprint §45 `usage_records`).
 *
 * Each row is one measurement of a named counter at a point in time, attributed
 * to a user, organization or workspace. Aggregation happens at read time.
 */
export interface IUsageRecord {
  _id?: Types.ObjectId;
  scope: UsageRecordScope;
  userId?: Types.ObjectId;
  organizationId?: Types.ObjectId;
  workspaceId?: Types.ObjectId;
  key: string;
  value: number;
  unit?: string;
  recordedAt: Date;
  metadata?: Record<string, unknown>;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IUsageRecordDocument extends Omit<IUsageRecord, '_id'>, Document {}

export interface CreateUsageRecordInput {
  scope: UsageRecordScope;
  userId?: string;
  organizationId?: string;
  workspaceId?: string;
  key: string;
  value: number;
  unit?: string;
  recordedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface UpdateUsageRecordInput {
  value?: number;
  unit?: string;
  metadata?: Record<string, unknown>;
}

export interface ListUsageRecordsOptions {
  scope?: UsageRecordScope;
  userId?: string;
  organizationId?: string;
  workspaceId?: string;
  key?: string;
  from?: Date;
  to?: Date;
}
