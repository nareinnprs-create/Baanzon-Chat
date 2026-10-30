export {
  createEntitlementService,
  resolvePlanLimits,
  resolveLimitsMatrix,
  assertWithinLimit,
  EntitlementLimitError,
} from './service';
export { createEntitlementHandlers } from './handlers';
export type {
  EntitlementRow,
  EntitlementStore,
  EntitlementLimitsConfig,
  EntitlementService,
  EntitlementServiceDeps,
  EntitlementAccessStore,
  EntitlementHandlers,
  EntitlementHandlersDeps,
  EntitlementHandlerActor,
  AssertWithinLimitInput,
} from './types';
