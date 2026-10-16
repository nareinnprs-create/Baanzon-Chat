import type { Model } from 'mongoose';
import type {
  IUsageRecord,
  IUsageRecordDocument,
  CreateUsageRecordInput,
  UpdateUsageRecordInput,
  ListUsageRecordsOptions,
} from '~/types/usageRecord';
import { isValidObjectIdString } from '~/utils/objectId';

export interface UsageRecordMethods {
  createUsageRecord(input: CreateUsageRecordInput): Promise<IUsageRecord>;
  getUsageRecord(recordId: string): Promise<IUsageRecord | null>;
  /** Metered reads, newest first, optionally windowed by time. */
  listUsageRecords(options?: ListUsageRecordsOptions): Promise<IUsageRecord[]>;
  updateUsageRecord(recordId: string, patch: UpdateUsageRecordInput): Promise<IUsageRecord | null>;
  deleteUsageRecord(recordId: string): Promise<boolean>;
}

export function createUsageRecordMethods(mongoose: typeof import('mongoose')): UsageRecordMethods {
  const UsageRecord = (): Model<IUsageRecordDocument> =>
    mongoose.models.UsageRecord as Model<IUsageRecordDocument>;

  async function createUsageRecord(input: CreateUsageRecordInput): Promise<IUsageRecord> {
    if (input.userId && !isValidObjectIdString(input.userId)) {
      throw new Error('A valid userId is required');
    }
    if (input.organizationId && !isValidObjectIdString(input.organizationId)) {
      throw new Error('A valid organizationId is required');
    }
    if (input.workspaceId && !isValidObjectIdString(input.workspaceId)) {
      throw new Error('A valid workspaceId is required');
    }

    const created = await UsageRecord().create({
      scope: input.scope,
      userId: input.userId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      key: input.key,
      value: input.value,
      unit: input.unit,
      recordedAt: input.recordedAt ?? new Date(),
      metadata: input.metadata,
    });
    return created.toObject() as IUsageRecord;
  }

  async function getUsageRecord(recordId: string): Promise<IUsageRecord | null> {
    if (!isValidObjectIdString(recordId)) {
      return null;
    }
    return await UsageRecord().findById(recordId).lean<IUsageRecord>();
  }

  async function listUsageRecords(options?: ListUsageRecordsOptions): Promise<IUsageRecord[]> {
    const filter: Record<string, unknown> = {};
    if (options?.scope !== undefined) {
      filter.scope = options.scope;
    }
    if (options?.userId) {
      if (!isValidObjectIdString(options.userId)) {
        return [];
      }
      filter.userId = options.userId;
    }
    if (options?.organizationId) {
      if (!isValidObjectIdString(options.organizationId)) {
        return [];
      }
      filter.organizationId = options.organizationId;
    }
    if (options?.workspaceId) {
      if (!isValidObjectIdString(options.workspaceId)) {
        return [];
      }
      filter.workspaceId = options.workspaceId;
    }
    if (options?.key !== undefined) {
      filter.key = options.key;
    }
    if (options?.from || options?.to) {
      const range: Record<string, Date> = {};
      if (options.from) {
        range.$gte = options.from;
      }
      if (options.to) {
        range.$lte = options.to;
      }
      filter.recordedAt = range;
    }
    return await UsageRecord()
      .find(filter)
      .sort({ recordedAt: -1, _id: -1 })
      .lean<IUsageRecord[]>();
  }

  async function updateUsageRecord(
    recordId: string,
    patch: UpdateUsageRecordInput,
  ): Promise<IUsageRecord | null> {
    if (!isValidObjectIdString(recordId)) {
      return null;
    }

    const update: Record<string, unknown> = {};
    if (patch.value !== undefined) {
      update.value = patch.value;
    }
    if (patch.unit !== undefined) {
      update.unit = patch.unit;
    }
    if (patch.metadata !== undefined) {
      update.metadata = patch.metadata;
    }

    return await UsageRecord()
      .findByIdAndUpdate(recordId, { $set: update }, { new: true, runValidators: true })
      .lean<IUsageRecord>();
  }

  async function deleteUsageRecord(recordId: string): Promise<boolean> {
    if (!isValidObjectIdString(recordId)) {
      return false;
    }
    const deleted = await UsageRecord().findOneAndDelete({ _id: recordId });
    return !!deleted;
  }

  return {
    createUsageRecord,
    getUsageRecord,
    listUsageRecords,
    updateUsageRecord,
    deleteUsageRecord,
  };
}
