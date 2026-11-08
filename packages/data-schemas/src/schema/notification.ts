import { Schema } from 'mongoose';
import type { INotificationDocument } from '~/types/notification';

const notificationSchema: Schema<INotificationDocument> = new Schema<INotificationDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['system', 'agent_run', 'mention', 'share', 'schedule', 'knowledge'],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    body: {
      type: String,
      maxlength: 4000,
    },
    link: {
      type: String,
    },
    read: {
      type: Boolean,
      default: false,
      required: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
    data: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

/** The unread inbox for a user, newest first. */
notificationSchema.index({ userId: 1, read: 1, createdAt: -1, _id: -1 });

export default notificationSchema;
