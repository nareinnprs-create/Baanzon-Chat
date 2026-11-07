import { z } from 'zod';

/** Provenance classes used when assembling model context and rendering citations. */
export const EVIDENCE_SOURCE_TYPES = [
  'model_knowledge',
  'private_document',
  'live_web',
  'user_context',
  'tool_result',
  'unverified_speculation',
] as const;

export const evidenceSourceTypeSchema = z.enum(EVIDENCE_SOURCE_TYPES);
export type EvidenceSourceType = z.infer<typeof evidenceSourceTypeSchema>;

export const evidenceSourceSchema = z
  .object({
    id: z.string().min(1),
    type: evidenceSourceTypeSchema,
    title: z.string().optional(),
    uri: z.string().optional(),
    excerpt: z.string().optional(),
    retrievedAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
    confidence: z.number().min(0).max(1).optional(),
    citation: z.string().optional(),
    permissionScope: z.string().optional(),
  })
  .strict();

export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;
