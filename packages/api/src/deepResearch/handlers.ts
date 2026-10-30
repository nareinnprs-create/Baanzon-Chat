import { z } from 'zod';
import { randomUUID } from 'crypto';
import { logger } from '@librechat/data-schemas';
import {
  DEEP_RESEARCH_STREAM_EVENT,
  DEEP_RESEARCH_UNAVAILABLE_CODE,
} from 'librechat-data-provider';
import type { Response } from 'express';
import type {
  DeepResearchEmittedEvent,
  DeepResearchHandlersDeps,
  DeepResearchHandlers,
} from './types';
import type { ServerRequest } from '~/types/http';
import { DeepResearchUnsupportedError } from './types';
import { resolveDeepResearchSettings } from './config';

const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

const AUTH_REQUIRED = 'Authentication required';
const INVALID_TOPIC = 'topic is required as a non-empty string';
const INVALID_RUN_PARAMS = 'topic, stepId, title and query are required as non-empty strings';
const INVALID_PLAN = 'plan requires a topic and at least one step with id, title and query';

const topicSchema = z.string().trim().min(1).max(500);

const planRequestSchema = z.object({
  topic: topicSchema,
});

const runParamsSchema = z.object({
  topic: topicSchema,
  stepId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  query: z.string().trim().min(1).max(4000),
});

const citationSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(1000),
  url: z.string().max(2048).optional(),
  snippet: z.string().max(8000).optional(),
});

const reportStepSchema = z.object({
  id: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  query: z.string().trim().min(1).max(4000),
  detail: z.string().max(100000).optional(),
  error: z.string().max(2000).optional(),
  citations: citationSchema.array().max(200).optional(),
});

const reportRequestSchema = z.object({
  plan: z.object({
    id: z.string().min(1).max(200).optional(),
    topic: topicSchema,
    steps: reportStepSchema.array().min(1).max(64),
  }),
});

function resolveUserId(req: ServerRequest): string | null {
  const user = req.user;
  if (!user) {
    return null;
  }
  const userId = user._id?.toString() ?? user.id;
  return userId || null;
}

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

/**
 * Express handlers for the Deep Research backend, mirroring the projects
 * handlers: everything is resolved through the injected runner, inputs are
 * validated before it is touched, and the config lever (`deepResearch.enabled`,
 * default true) degrades every route to 503 with the wire's unavailable code so
 * the client falls back to its in-memory executor.
 */
export function createDeepResearchHandlers(deps: DeepResearchHandlersDeps): DeepResearchHandlers {
  const { runner } = deps;

  function gate(req: ServerRequest, res: Response): { userId: string } | null {
    const userId = resolveUserId(req);
    if (!userId) {
      res.status(401).json({ error: AUTH_REQUIRED });
      return null;
    }
    const settings = resolveDeepResearchSettings(req.config?.config?.deepResearch);
    if (!settings.enabled) {
      res.status(503).json({ error: DEEP_RESEARCH_UNAVAILABLE_CODE });
      return null;
    }
    return { userId };
  }

  async function createPlan(req: ServerRequest, res: Response): Promise<Response> {
    if (!gate(req, res)) {
      return res;
    }
    const parsed = planRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: INVALID_TOPIC });
    }

    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
      const plan = await runner.createPlan({ topic: parsed.data.topic }, controller.signal);
      return res.status(200).json(plan);
    } catch (error) {
      if (isAbortError(error)) {
        return res.end();
      }
      if (error instanceof DeepResearchUnsupportedError) {
        return res.status(422).json({ error: error.message });
      }
      logger.error('[deepResearch] Error creating plan', error);
      return res.status(500).json({ error: 'Error creating plan' });
    }
  }

  async function runStep(req: ServerRequest, res: Response): Promise<Response | void> {
    if (!gate(req, res)) {
      return undefined;
    }
    const parsed = runParamsSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: INVALID_RUN_PARAMS });
    }
    const { topic } = parsed.data;
    const step = {
      id: parsed.data.stepId,
      title: parsed.data.title,
      query: parsed.data.query,
    };

    res.writeHead(200, SSE_HEADERS);
    res.flushHeaders?.();

    let seq = 0;
    let closed = false;
    const controller = new AbortController();

    const emit = (event: DeepResearchEmittedEvent) => {
      seq += 1;
      res.write(
        `event: ${DEEP_RESEARCH_STREAM_EVENT}\ndata: ${JSON.stringify({ ...event, seq })}\n\n`,
      );
    };

    const onClose = () => {
      closed = true;
      controller.abort();
    };
    res.on('close', onClose);
    res.on('error', onClose);

    emit({ kind: 'status', status: 'running', code: 'step_started', stepId: step.id });

    try {
      const result = await runner.runStep({ topic, step }, controller.signal, emit);
      if (!closed) {
        emit({
          kind: 'step',
          status: 'running',
          code: 'step_completed',
          stepId: step.id,
          detail: result.detail,
        });
      }
      res.end();
      return undefined;
    } catch (error) {
      if (!closed) {
        if (error instanceof DeepResearchUnsupportedError) {
          emit({
            kind: 'error',
            status: 'failed',
            code: 'provider_unsupported',
            stepId: step.id,
            detail: error.message,
          });
        } else if (!isAbortError(error)) {
          logger.error('[deepResearch] Error running step', error);
          emit({
            kind: 'error',
            status: 'failed',
            code: 'step_failed',
            stepId: step.id,
            detail: 'Error running research step',
          });
        }
      }
      res.end();
      return undefined;
    }
  }

  async function buildReport(req: ServerRequest, res: Response): Promise<Response> {
    if (!gate(req, res)) {
      return res;
    }
    const parsed = reportRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: INVALID_PLAN });
    }

    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
      /**
       * The report body's plan id is optional on the wire (clients that build a
       * plan in memory omit it); the runner's contract requires one, so a
       * missing id is minted here and round-trips through `planId`.
       */
      const plan = { ...parsed.data.plan, id: parsed.data.plan.id ?? randomUUID() };
      const report = await runner.buildReport(plan, controller.signal);
      return res.status(200).json(report);
    } catch (error) {
      if (isAbortError(error)) {
        return res.end();
      }
      if (error instanceof DeepResearchUnsupportedError) {
        return res.status(422).json({ error: error.message });
      }
      logger.error('[deepResearch] Error building report', error);
      return res.status(500).json({ error: 'Error building report' });
    }
  }

  return { createPlan, runStep, buildReport };
}
