import {
  DEEP_RESEARCH_STREAM_EVENT,
  DEEP_RESEARCH_UNAVAILABLE_CODE,
  dataService,
} from 'librechat-data-provider';
import type {
  TDeepResearchEvent,
  TDeepResearchPlan,
  TDeepResearchStep,
} from 'librechat-data-provider';
import type { DeepResearchExecutor, ResearchStepResult, StepProgressCallback } from './api';
import type { ResearchPlan, ResearchReport, ResearchStep } from './types';
import { createInMemoryExecutor } from './api';

/**
 * A `DeepResearchExecutor` that runs against the backend `/api/deep-research`
 * endpoints (POST /plan, GET /run over SSE, POST /report). When the backend is
 * not serving — the `deepResearch.enabled` lever is off, the route answers the
 * wire's unavailable code, or the server itself is unreachable — the flow falls
 * back to the in-memory executor from `./api`, so the feature always has a
 * working executor no matter what the deployment carries.
 */

const UNAVAILABLE_STATUS_CODES = new Set([404, 501, 503]);

function unavailableStatus(error: unknown): number | null {
  const status = (
    error as { response?: { status?: unknown; data?: { error?: unknown } | undefined } } | undefined
  )?.response;
  if (!status) {
    return null;
  }
  if (
    typeof status.data?.error === 'string' &&
    status.data.error === DEEP_RESEARCH_UNAVAILABLE_CODE
  ) {
    return 503;
  }
  if (typeof status.status === 'number' && UNAVAILABLE_STATUS_CODES.has(status.status)) {
    return status.status;
  }
  return null;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error && error.message) {
    return error;
  }
  return new Error('Deep research request failed');
}

function toViewPlan(plan: TDeepResearchPlan): ResearchPlan {
  return {
    id: plan.id,
    topic: plan.topic,
    steps: plan.steps.map(
      (step): ResearchStep => ({
        id: step.id,
        title: step.title,
        query: step.query,
        status: 'pending',
        progress: 0,
      }),
    ),
  };
}

/** The view-plan step dropped down to the wire shape the report endpoint takes. */
function toWireStep(step: ResearchStep): TDeepResearchStep {
  return { id: step.id, title: step.title, query: step.query };
}

function abortError(): Error {
  const error = new Error('Deep research run aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * Runs one step against `GET /run` and parses its SSE stream. The request is a
 * plain `fetch` (not `EventSource`) because the transport must carry the
 * JWT Bearer header — `EventSource` cannot set headers and the route rejects
 * anonymous streams.
 */
function runStepOverStream(
  topic: string,
  step: ResearchStep,
  signal: AbortSignal,
  token: string | undefined,
  onProgress?: StepProgressCallback,
): Promise<ResearchStepResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (!settled) {
        settled = true;
        reject(abortError());
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const finish = (settle: (value: ResearchStepResult) => void, value: ResearchStepResult) => {
      settled = true;
      cleanup();
      settle(value);
    };
    const fail = (message: string) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(message));
      }
    };

    const handleEventBlock = (block: string, settle: (value: ResearchStepResult) => void) => {
      let name = '';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) {
          name = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
          data += line.slice('data:'.length).trim();
        }
      }
      if (name !== DEEP_RESEARCH_STREAM_EVENT) {
        return;
      }
      let payload: TDeepResearchEvent;
      try {
        payload = JSON.parse(data) as TDeepResearchEvent;
      } catch {
        return;
      }
      if (payload.kind === 'progress') {
        onProgress?.(payload.progress ?? 0, payload.detail);
        return;
      }
      if (payload.kind === 'step') {
        finish(settle, { detail: payload.detail });
        return;
      }
      if (payload.kind === 'error') {
        fail(payload.detail ?? payload.code);
      }
    };

    void (async () => {
      try {
        const url = dataService.deepResearchStepRunUrl({
          topic,
          stepId: step.id,
          title: step.title,
          query: step.query,
        });
        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          signal,
        });
        if (!response.ok || !response.body) {
          fail(`Deep research stream failed (${response.status})`);
          return;
        }
        const settle = (value: ResearchStepResult) => finish(resolve, value);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value: chunk, done: finished } = await reader.read();
          if (settled) {
            return;
          }
          if (finished) {
            break;
          }
          buffer += decoder.decode(chunk, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1 && !settled) {
            handleEventBlock(buffer.slice(0, boundary), settle);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');
          }
        }
        if (!settled) {
          fail('Deep research stream failed');
        }
      } catch (caught) {
        if (caught instanceof Error && caught.name === 'AbortError') {
          if (!settled) {
            settled = true;
            cleanup();
            reject(abortError());
          }
          return;
        }
        fail(caught instanceof Error && caught.message ? caught.message : 'Deep research stream failed');
      }
    })();
  });
}

export type BackendDeepResearchExecutorOptions = {
  /** The executor used when the backend cannot serve the flow. */
  fallback?: DeepResearchExecutor;
  /** Supplies the current auth token for the run stream's Bearer header. */
  getToken?: () => string | undefined;
};

export function createBackendDeepResearchExecutor(
  options: BackendDeepResearchExecutorOptions = {},
): DeepResearchExecutor {
  const fallback = options.fallback ?? createInMemoryExecutor();
  const { getToken } = options;
  /** Flipped off the first time the backend answers as unavailable; sticky for the flow. */
  let backendAvailable = true;
  /** The plan topic, remembered so the run stream URL can carry it. */
  let topic = '';

  return {
    async createPlan(nextTopic: string, signal: AbortSignal): Promise<ResearchPlan> {
      topic = nextTopic;
      if (!backendAvailable) {
        return fallback.createPlan(nextTopic, signal);
      }
      try {
        const plan = await dataService.createDeepResearchPlan({ topic: nextTopic });
        return toViewPlan(plan);
      } catch (error) {
        if (unavailableStatus(error) != null) {
          backendAvailable = false;
          return fallback.createPlan(nextTopic, signal);
        }
        throw normalizeError(error);
      }
    },

    async runStep(
      step: ResearchStep,
      signal: AbortSignal,
      onProgress?: StepProgressCallback,
    ): Promise<ResearchStepResult> {
      if (!backendAvailable) {
        return fallback.runStep(step, signal, onProgress);
      }
      return runStepOverStream(topic, step, signal, getToken?.(), onProgress);
    },

    async buildReport(plan: ResearchPlan, signal: AbortSignal): Promise<ResearchReport> {
      if (!backendAvailable) {
        return fallback.buildReport(plan, signal);
      }
      try {
        const report = await dataService.buildDeepResearchReport({
          plan: { id: plan.id, topic: plan.topic, steps: plan.steps.map(toWireStep) },
        });
        return report;
      } catch (error) {
        if (unavailableStatus(error) != null) {
          backendAvailable = false;
          return fallback.buildReport(plan, signal);
        }
        throw normalizeError(error);
      }
    },
  };
}
