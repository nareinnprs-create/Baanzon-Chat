import type { Model } from 'mongoose';
import type {
  IDevice,
  IDeviceDocument,
  CreateDeviceInput,
  UpdateDeviceInput,
  ListDevicesOptions,
} from '~/types/device';
import { isValidObjectIdString } from '~/utils/objectId';

export interface DeviceMethods {
  createDevice(input: CreateDeviceInput): Promise<IDevice>;
  getDevice(deviceId: string): Promise<IDevice | null>;
  /** A user's devices, most recently seen first. */
  listDevices(options?: ListDevicesOptions): Promise<IDevice[]>;
  /** Records a heartbeat or renames a device. */
  updateDevice(deviceId: string, patch: UpdateDeviceInput): Promise<IDevice | null>;
  deleteDevice(deviceId: string): Promise<boolean>;
}

export function createDeviceMethods(mongoose: typeof import('mongoose')): DeviceMethods {
  const Device = (): Model<IDeviceDocument> => mongoose.models.Device as Model<IDeviceDocument>;

  async function createDevice(input: CreateDeviceInput): Promise<IDevice> {
    if (!isValidObjectIdString(input.userId)) {
      throw new Error('A valid userId is required');
    }

    const created = await Device().create({
      userId: input.userId,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      platform: input.platform,
      os: input.os,
      browser: input.browser,
      appVersion: input.appVersion,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      lastSeenAt: input.lastSeenAt,
      isActive: input.isActive ?? true,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    });
    return created.toObject() as IDevice;
  }

  async function getDevice(deviceId: string): Promise<IDevice | null> {
    if (!isValidObjectIdString(deviceId)) {
      return null;
    }
    return await Device().findById(deviceId).lean<IDevice>();
  }

  async function listDevices(options?: ListDevicesOptions): Promise<IDevice[]> {
    const filter: Record<string, unknown> = {};
    if (options?.userId) {
      if (!isValidObjectIdString(options.userId)) {
        return [];
      }
      filter.userId = options.userId;
    }
    if (options?.isActive !== undefined) {
      filter.isActive = options.isActive;
    }
    if (options?.tenantId) {
      filter.tenantId = options.tenantId;
    }
    return await Device().find(filter).sort({ lastSeenAt: -1, _id: -1 }).lean<IDevice[]>();
  }

  async function updateDevice(deviceId: string, patch: UpdateDeviceInput): Promise<IDevice | null> {
    if (!isValidObjectIdString(deviceId)) {
      return null;
    }

    const update: Record<string, unknown> = {};
    if (patch.deviceName !== undefined) {
      update.deviceName = patch.deviceName;
    }
    if (patch.platform !== undefined) {
      update.platform = patch.platform;
    }
    if (patch.os !== undefined) {
      update.os = patch.os;
    }
    if (patch.browser !== undefined) {
      update.browser = patch.browser;
    }
    if (patch.appVersion !== undefined) {
      update.appVersion = patch.appVersion;
    }
    if (patch.ipAddress !== undefined) {
      update.ipAddress = patch.ipAddress;
    }
    if (patch.userAgent !== undefined) {
      update.userAgent = patch.userAgent;
    }
    if (patch.lastSeenAt !== undefined) {
      update.lastSeenAt = patch.lastSeenAt;
    }
    if (patch.isActive !== undefined) {
      update.isActive = patch.isActive;
    }

    return await Device()
      .findByIdAndUpdate(deviceId, { $set: update }, { new: true, runValidators: true })
      .lean<IDevice>();
  }

  async function deleteDevice(deviceId: string): Promise<boolean> {
    if (!isValidObjectIdString(deviceId)) {
      return false;
    }
    const deleted = await Device().findOneAndDelete({ _id: deviceId });
    return !!deleted;
  }

  return { createDevice, getDevice, listDevices, updateDevice, deleteDevice };
}
