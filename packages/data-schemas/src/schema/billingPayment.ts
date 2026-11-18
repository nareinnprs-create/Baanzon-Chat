import { Schema, model } from 'mongoose';
import type { IBillingPaymentDocument } from '~/types/billingPayment';

/**
 * One row per completed purchase, whichever rail collected the money:
 * `source: 'play'` rows are written by the Play Billing verify endpoint,
 * giving the app a single local record of entitlement-granting payments
 * (Dodo's live API list covers the web rail).
 */
const billingPaymentSchema: Schema<IBillingPaymentDocument> = new Schema<IBillingPaymentDocument>(
  {
    source: {
      type: String,
      enum: ['play', 'dodo'],
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 200,
    },
    /** Rail-specific external id: Google `orderId` or Dodo `payment_id`. */
    externalId: {
      type: String,
      required: true,
      index: true,
    },
    /** The purchased sku/tier as the client knows it (Play product id or pack key). */
    productId: {
      type: String,
      required: true,
    },
    kind: {
      type: String,
      enum: ['subscription', 'pack'],
      required: true,
    },
    tier: {
      type: String,
      maxlength: 40,
    },
    pack: {
      type: String,
      maxlength: 40,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    status: {
      type: String,
      enum: ['paid', 'canceled', 'revoked'],
      default: 'paid',
    },
    acknowledgedAt: Date,
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

billingPaymentSchema.index({ createdAt: -1 });
billingPaymentSchema.index({ source: 1, externalId: 1 }, { unique: true });

export default model<IBillingPaymentDocument>('BillingPayment', billingPaymentSchema);
