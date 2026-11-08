import { Schema } from 'mongoose';
import type { IDeviceDocument } from '~/types/device';

const deviceSchema: Schema<IDeviceDocument> = new Schema<IDeviceDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      trim: true,
      index: true,
    },
    deviceName: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    platform: {
      type: String,
      enum: ['windows', 'macos', 'linux', 'android', 'ios', 'web', 'other'],
    },
    os: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    browser: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    appVersion: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    ipAddress: {
      type: String,
      trim: true,
      maxlength: 64,
    },
    userAgent: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    lastSeenAt: {
      type: Date,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

deviceSchema.index({ userId: 1, isActive: 1 });
deviceSchema.index({ userId: 1, lastSeenAt: -1 });

export default deviceSchema;
