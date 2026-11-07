import { z } from 'zod';

/** User-facing capability lanes. Provider/model identifiers stay implementation details. */
export const MODEL_LANES = [
  'fast',
  'balanced',
  'reasoning',
  'vision',
  'coding',
  'local',
  'embedding',
  'reranker',
] as const;

export const modelLaneSchema = z.enum(MODEL_LANES);
export type ModelLane = z.infer<typeof modelLaneSchema>;

export const modelLaneConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(true),
    defaultLane: modelLaneSchema.optional().default('balanced'),
    fallbackLane: modelLaneSchema.optional().default('fast'),
    /** Exact provider model IDs verified by the deployment as multimodal. */
    visionModels: z.array(z.string().min(1)).optional().default([]),
  })
  .strict();

export type ModelLaneConfig = z.infer<typeof modelLaneConfigSchema>;
