import type {
  CreateUsageRecordInput,
  ListUsageRecordsOptions,
  UpdateUsageRecordInput,
  UsageRecordScope,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types';

/**
 * Storage-shaped usage record row. Kept Mongoose-free so `packages/api` never
 * carries `Types.ObjectId` / `Document` in an exported signature; the injected
 * data-schemas methods return values structurally compatible with this.
 */
export interface UsageRecordRow {
  _id?: unknown;
  scope: UsageRecordScope;
  userId?: unknown;
  organizationId?: unknown;
  workspaceId?: unknown;
  key: string;
  value: number;
  unit?: string;
  recordedAt: Date | string;
  metadata?: Record<string, unknown>;
  tenantId?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

/** Wire shape returned by the usage records API; ids are strings and dates are ISO-8601. */
export interface UsageRecordDTO {
  id: string;
  scope: UsageRecordScope;
  userId?: string;
  organizationId?: string;
  workspaceId?: string;
  key: string;
  value: number;
  unit?: string;
  recordedAt: string;
  metadata?: Record<string, unknown>;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * `POST /api/usage-records` body. Only the `user` scope is accepted, and `userId`
 * is never accepted from the body.
 */
export interface UsageRecordCreateRequest {
  scope?: UsageRecordScope;
  key: string;
  value: number;
  unit?: string;
  recordedAt?: Date;
  metadata?: Record<string, unknown>;
}

/** `PATCH /api/usage-records/:id` body. */
export interface UsageRecordUpdateRequest {
  value?: number;
  unit?: string;
  metadata?: Record<string, unknown>;
}

/** `GET /api/usage-records` query filters. The owner is always the authenticated user. */
export interface UsageRecordListQuery {
  scope?: UsageRecordScope;
  key?: string;
  from?: Date;
  to?: Date;
}

/** The subset of `packages/data-schemas` usage record methods the handlers depend on. */
export interface UsageRecordDataSource {
  createUsageRecord(input: CreateUsageRecordInput): Promise<UsageRecordRow>;
  getUsageRecord(recordId: string): Promise<UsageRecordRow | null>;
  listUsageRecords(options?: ListUsageRecordsOptions): Promise<UsageRecordRow[]>;
  updateUsageRecord(
    recordId: string,
    patch: UpdateUsageRecordInput,
  ): Promise<UsageRecordRow | null>;
  deleteUsageRecord(recordId: string): Promise<boolean>;
}

export interface UsageRecordsHandlers {
  list: (req: ServerRequest, res: Response) => Promise<Response>;
  get: (req: ServerRequest, res: Response) => Promise<Response>;
  create: (req: ServerRequest, res: Response) => Promise<Response>;
  update: (req: ServerRequest, res: Response) => Promise<Response>;
  delete: (req: ServerRequest, res: Response) => Promise<Response>;
}
