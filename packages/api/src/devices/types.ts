import type {
  CreateDeviceInput,
  DevicePlatform,
  ListDevicesOptions,
  UpdateDeviceInput,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types';

/**
 * Storage-shaped device row. Kept Mongoose-free so `packages/api` never carries
 * `Types.ObjectId` / `Document` in an exported signature; the injected
 * data-schemas methods return values structurally compatible with this.
 */
export interface DeviceRecord {
  _id?: unknown;
  userId?: unknown;
  deviceId?: string;
  deviceName?: string;
  platform?: DevicePlatform;
  os?: string;
  browser?: string;
  appVersion?: string;
  ipAddress?: string;
  userAgent?: string;
  lastSeenAt?: Date | string;
  isActive?: boolean;
  tenantId?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

/** Wire shape returned by the devices API; ids are strings and dates are ISO-8601. */
export interface DeviceDTO {
  id: string;
  userId: string;
  deviceId?: string;
  deviceName?: string;
  platform?: DevicePlatform;
  os?: string;
  browser?: string;
  appVersion?: string;
  ipAddress?: string;
  userAgent?: string;
  lastSeenAt?: string;
  isActive: boolean;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** `POST /api/devices` body. `userId` is never accepted from the body. */
export interface DeviceCreateRequest {
  deviceId?: string;
  deviceName?: string;
  platform?: DevicePlatform;
  os?: string;
  browser?: string;
  appVersion?: string;
  ipAddress?: string;
  userAgent?: string;
  lastSeenAt?: Date;
  isActive?: boolean;
}

/** `PATCH /api/devices/:id` body. */
export interface DeviceUpdateRequest {
  deviceName?: string;
  platform?: DevicePlatform;
  os?: string;
  browser?: string;
  appVersion?: string;
  ipAddress?: string;
  userAgent?: string;
  lastSeenAt?: Date;
  isActive?: boolean;
}

/** `GET /api/devices` query filters. The owner is always the authenticated user. */
export interface DeviceListQuery {
  isActive?: boolean;
}

/** The subset of `packages/data-schemas` device methods the handlers depend on. */
export interface DeviceDataSource {
  createDevice(input: CreateDeviceInput): Promise<DeviceRecord>;
  getDevice(deviceId: string): Promise<DeviceRecord | null>;
  listDevices(options?: ListDevicesOptions): Promise<DeviceRecord[]>;
  updateDevice(deviceId: string, patch: UpdateDeviceInput): Promise<DeviceRecord | null>;
  deleteDevice(deviceId: string): Promise<boolean>;
}

export interface DevicesHandlers {
  list: (req: ServerRequest, res: Response) => Promise<Response>;
  get: (req: ServerRequest, res: Response) => Promise<Response>;
  create: (req: ServerRequest, res: Response) => Promise<Response>;
  update: (req: ServerRequest, res: Response) => Promise<Response>;
  delete: (req: ServerRequest, res: Response) => Promise<Response>;
}
