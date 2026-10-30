import type { Document, Types } from 'mongoose';

/** The operating-system family a device reports. */
export type DevicePlatform = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'web' | 'other';

/**
 * A device a user has signed in from (blueprint §45 `devices`).
 *
 * The row tracks the last-known client fingerprint and heartbeat, not the
 * session: revoking a login is a session concern, this is the device registry.
 */
export interface IDevice {
  _id?: Types.ObjectId;
  userId: Types.ObjectId;
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
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IDeviceDocument extends Omit<IDevice, '_id'>, Document {}

export interface CreateDeviceInput {
  userId: string;
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
  tenantId?: string;
}

export interface UpdateDeviceInput {
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

export interface ListDevicesOptions {
  userId?: string;
  isActive?: boolean;
  tenantId?: string;
}
