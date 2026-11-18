import type { Document } from 'mongoose';

/** A completed, entitlement-granting purchase on any payment rail. */
export interface IBillingPayment {
  source: 'play' | 'dodo';
  userId?: string;
  email?: string;
  /** Rail-specific external id: Google `orderId` or Dodo `payment_id`. */
  externalId: string;
  productId: string;
  kind: 'subscription' | 'pack';
  tier?: string;
  pack?: string;
  amount: number;
  currency?: string;
  status?: 'paid' | 'canceled' | 'revoked';
  acknowledgedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  tenantId?: string;
}

export interface IBillingPaymentDocument extends Omit<IBillingPayment, '_id'>, Document {
  _id: import('mongoose').Types.ObjectId;
}
