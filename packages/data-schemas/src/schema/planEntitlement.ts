import { Schema } from 'mongoose';
import {
  ENTITLEMENT_PLAN_KEYS,
  ENTITLEMENT_RESOURCE_KEYS,
  ENTITLEMENT_SCOPES,
} from 'librechat-data-provider';
import type { IPlanEntitlementDocument } from '~/types/planEntitlement';

const planEntitlementSchema: Schema<IPlanEntitlementDocument> =
  new Schema<IPlanEntitlementDocument>(
    {
      plan: {
        type: String,
        required: true,
        enum: ENTITLEMENT_PLAN_KEYS,
      },
      resource: {
        type: String,
        required: true,
        enum: ENTITLEMENT_RESOURCE_KEYS,
      },
      scope: {
        type: String,
        required: true,
        enum: ENTITLEMENT_SCOPES,
      },
      /** `organization` scope rows carry the org id; `global` rows omit it entirely. */
      scopeId: {
        type: String,
        default: null,
      },
      /** Non-negative cap, or -1 (unlimited) to park a row without lifting the cap. */
      limit: {
        type: Number,
        required: true,
        min: -1,
      },
    },
    { timestamps: true },
  );

planEntitlementSchema.index({ plan: 1, resource: 1, scope: 1, scopeId: 1 }, { unique: true });

export default planEntitlementSchema;
