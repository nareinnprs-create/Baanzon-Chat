import { z } from 'zod';
import { logger } from '@librechat/data-schemas';
import type { IEvalRun } from '@librechat/data-schemas';
import type { TEvalRun } from 'librechat-data-provider';
import type { Response } from 'express';
import type { EvalHandlerActor, EvalHandlers, EvalHandlersDeps } from './types';
import type { ServerRequest } from '~/types/http';

const AUTH_REQUIRED = 'Authentication required';
const INVALID_EVAL_PAYLOAD = 'Invalid eval run payload';
const EVAL_RUN_NOT_FOUND = 'Eval run not found';

const assertionSchema = z.object({
  type: z.enum(['exact', 'contains', 'regex']),
  value: z.string(),
  caseSensitive: z.boolean().optional(),
});

const evalCaseSchema = z.object({
  name: z.string().trim().min(1),
  input: z.string(),
  expected: z.string(),
  assertions: z.array(assertionSchema),
});

const createRunSchema = z
  .object({
    agentId: z.string().trim().min(1).optional(),
    workflowId: z.string().trim().min(1).optional(),
    datasetName: z.string().trim().min(1),
    dataset: z.object({
      name: z.string().optional(),
      cases: z.array(evalCaseSchema),
    }),
  })
  .strict()
  .refine((data) => Boolean(data.agentId) !== Boolean(data.workflowId), {
    message: 'An eval run needs exactly one target: agentId or workflowId',
  });

function resolveActor(req: ServerRequest): EvalHandlerActor | null {
  const userId = req.user?._id?.toString() ?? req.user?.id;
  if (!userId) {
    return null;
  }
  return { userId };
}

/** Plain-object run shape for the API: `id` string, ISO date strings. */
export function serializeEvalRun(run: IEvalRun): TEvalRun {
  return {
    id: String(run._id),
    agentId: run.agentId ?? null,
    workflowId: run.workflowId ?? null,
    datasetName: run.datasetName,
    status: run.status,
    dataset: run.dataset ?? null,
    scores: run.scores ?? null,
    error: run.error ?? null,
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    createdAt: (run.createdAt ?? new Date(0)).toISOString(),
    updatedAt: (run.updatedAt ?? new Date(0)).toISOString(),
  };
}

/**
 * Express handlers for the eval service, mirroring the billing handlers: the
 * injected service does the work, the payload is validated before the store is
 * touched, and reads are available to every authenticated caller.
 */
export function createEvalHandlers(deps: EvalHandlersDeps): EvalHandlers {
  const { service } = deps;

  async function createRun(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req);
    if (!actor) {
      return res.status(401).json({ error: AUTH_REQUIRED });
    }
    const parsed = createRunSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: INVALID_EVAL_PAYLOAD });
    }
    try {
      const run = await service.startRun(parsed.data);
      return res.status(201).json(serializeEvalRun(run));
    } catch (error) {
      logger.error('[evals] Error starting eval run', error);
      return res.status(500).json({ error: 'Error starting eval run' });
    }
  }

  async function listRuns(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req);
    if (!actor) {
      return res.status(401).json({ error: AUTH_REQUIRED });
    }
    const { agentId, workflowId, limit } = (req.query ?? {}) as Record<string, unknown>;
    try {
      const runs = await service.listRuns({
        agentId: typeof agentId === 'string' && agentId ? agentId : undefined,
        workflowId: typeof workflowId === 'string' && workflowId ? workflowId : undefined,
        limit: typeof limit === 'string' && limit ? Number(limit) : undefined,
      });
      return res.status(200).json({ runs: runs.map(serializeEvalRun) });
    } catch (error) {
      logger.error('[evals] Error listing eval runs', error);
      return res.status(500).json({ error: 'Error listing eval runs' });
    }
  }

  async function getRun(req: ServerRequest, res: Response): Promise<Response> {
    const actor = resolveActor(req);
    if (!actor) {
      return res.status(401).json({ error: AUTH_REQUIRED });
    }
    const { id } = (req.params ?? {}) as { id?: string };
    try {
      const run = await service.getRun(id ?? '');
      if (!run) {
        return res.status(404).json({ error: EVAL_RUN_NOT_FOUND });
      }
      return res.status(200).json(serializeEvalRun(run));
    } catch (error) {
      logger.error('[evals] Error fetching eval run', error);
      return res.status(500).json({ error: 'Error fetching eval run' });
    }
  }

  return { createRun, listRuns, getRun };
}
