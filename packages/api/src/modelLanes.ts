import type { ModelLane } from 'librechat-data-provider';

const CHAT_LANES = new Set<ModelLane>(['fast', 'balanced', 'reasoning', 'vision', 'coding']);
const PIPELINE_LANES = new Set<ModelLane>(['local', 'embedding', 'reranker']);

export class UnsupportedModelLaneError extends Error {
  readonly lane: string;

  constructor(lane: string) {
    super(`Model lane "${lane}" is a pipeline lane and cannot be used for chat requests`);
    this.name = 'UnsupportedModelLaneError';
    this.lane = lane;
  }
}

/** Rejects pipeline-only lanes before they can reach a chat provider. */
export function assertChatModelLane(lane?: string): asserts lane is ModelLane | undefined {
  if (!lane) {
    return;
  }

  if (PIPELINE_LANES.has(lane as ModelLane)) {
    throw new UnsupportedModelLaneError(lane);
  }

  if (!CHAT_LANES.has(lane as ModelLane)) {
    throw new Error(`Unknown model lane: ${lane}`);
  }
}

/** Vision is opt-in: a text model must never receive an image by accident. */
export function assertVisionModel(
  model: string | undefined,
  configuredModels: readonly string[] = [],
): void {
  if (!model || !configuredModels.includes(model)) {
    throw new Error(
      'Vision lane requires a configured multimodal provider model; add its exact ID to modelLanes.visionModels',
    );
  }
}
