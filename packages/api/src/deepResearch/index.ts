export { resolveDeepResearchSettings, DEEP_RESEARCH_DEFAULTS } from './config';
export { createDeepResearchRunner } from './executor';
export { createDeepResearchHandlers } from './handlers';
export { DeepResearchUnsupportedError } from './types';
export type {
  DeepResearchHandlers,
  DeepResearchHandlersDeps,
  DeepResearchEmittedEvent,
  DeepResearchEventEmitter,
  DeepResearchLlmCaller,
  DeepResearchPlanInput,
  DeepResearchRunner,
  DeepResearchRunnerDeps,
  DeepResearchRunInput,
  DeepResearchSearchProvider,
  DeepResearchSearchResult,
} from './types';
