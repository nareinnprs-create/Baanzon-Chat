import { Model } from 'mongoose';
import type { IBillingPaymentDocument } from '~/types/billingPayment';
import billingPaymentSchema from '~/schema/billingPayment';

export function createBillingPaymentModel(
  mongoose: typeof import('mongoose'),
): Model<IBillingPaymentDocument> {
  return (
    mongoose.models.BillingPayment ||
    mongoose.model<IBillingPaymentDocument>(
      'BillingPayment',
      billingPaymentSchema,
      'billingpayments',
    )
  );
}
