import type {
  TDeepResearchEvent,
  TDeepResearchPlan,
  TDeepResearchReport,
} from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { DeepResearchRunner } from './types';
import { createDeepResearchHandlers } from './handlers';
import { DeepResearchUnsupportedError } from './types';

const USER_ID = '507f1f77bcf86cd7994390aa';
const TOPIC = 'fusion energy';

interface MockResponse {
  res: Response;
  statusCode: number;
  isCommitted: boolean;
  body?: Record<string, unknown>;
  writes: string[];
  ended: boolean;
  /** Registered `close` listener from the SSE handler. */
  close?: () => void;
}

function mockResponse(): MockResponse {
  const state: MockResponse = {
    res: undefined as unknown as Response,
    statusCode: 200,
    isCommitted: false,
    body: undefined,
    writes: [],
    ended: false,
    close: undefined,
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(value: Record<string, unknown>) {
      state.body = value;
      return res;
    },
    writeHead(code: number) {
      state.statusCode = code;
      state.isCommitted = true;
    },
    flushHeaders() {
      state.isCommitted = true;
    },
    write(chunk: string) {
      state.writes.push(chunk);
    },
    end() {
      state.ended = true;
    },
    on(event: string, listener: () => void) {
      if (event === 'close') {
        state.close = listener;
      }
      return res;
    },
  };
  state.res = res as unknown as Response;
  return state;
}

function serverRequest(overrides: Record<string, unknown> = {}): ServerRequest {
  return {
    user: { id: USER_ID },
    query: {},
    params: {},
    body: {},
    config: { config: {} },
    ...overrides,
  } as unknown as ServerRequest;
}

function runner(overrides: Partial<DeepResearchRunner> = {}): jest.Mocked<DeepResearchRunner> {
  return {
    createPlan: jest.fn(),
    runStep: jest.fn(),
    buildReport: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<DeepResearchRunner>;
}

function plan(overrides: Partial<TDeepResearchPlan> = {}): TDeepResearchPlan {
  return {
    id: 'plan-1',
    topic: TOPIC,
    steps: [
      { id: 'step-1', title: 'Background', query: 'background query' },
      { id: 'step-2', title: 'Evidence', query: 'evidence query' },
    ],
    ...overrides,
  };
}

function report(overrides: Partial<TDeepResearchReport> = {}): TDeepResearchReport {
  return {
    planId: 'plan-1',
    title: 'Research report: fusion energy',
    summary: 'Completed 2 steps on fusion energy.',
    sections: [],
    citations: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function parseEvents(writes: string[]): TDeepResearchEvent[] {
  return writes
    .flatMap((chunk) => chunk.split('\n\n'))
    .map((frame) => frame.split('\n').find((line) => line.startsWith('data: ')))
    .filter((line): line is string => typeof line === 'string')
    .map((line) => JSON.parse(line.slice('data: '.length)) as TDeepResearchEvent);
}

function runQuery(): Record<string, string> {
  return {
    topic: TOPIC,
    stepId: 'step-1',
    title: 'Background',
    query: 'background query',
  };
}

function singleStepPlanBody(): Record<string, unknown> {
  return {
    plan: {
      topic: TOPIC,
      steps: [{ id: 'step-1', title: 'Background', query: 'background query' }],
    },
  };
}

describe('createDeepResearchHandlers', () => {
  describe('plan', () => {
    it('creates a plan for the caller from a topic body, trimming it', async () => {
      const mock = runner();
      mock.createPlan.mockResolvedValue(plan());
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.createPlan(
        serverRequest({ body: { topic: '  fusion energy  ' } }),
        response.res,
      );

      expect(mock.createPlan).toHaveBeenCalledWith({ topic: TOPIC }, expect.anything());
      expect(response.statusCode).toBe(200);
      expect(response.body).toMatchObject({
        id: 'plan-1',
        topic: TOPIC,
        steps: [
          { id: 'step-1', title: 'Background', query: 'background query' },
          { id: 'step-2', title: 'Evidence', query: 'evidence query' },
        ],
      });
    });

    it('refuses a missing topic with 400 before touching the runner', async () => {
      const mock = runner();
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.createPlan(serverRequest({ body: {} }), response.res);

      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual({ error: 'topic is required as a non-empty string' });
      expect(mock.createPlan).not.toHaveBeenCalled();
    });

    it('refuses a blank topic with 400', async () => {
      const mock = runner();
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.createPlan(serverRequest({ body: { topic: '   ' } }), response.res);

      expect(response.statusCode).toBe(400);
      expect(mock.createPlan).not.toHaveBeenCalled();
    });

    it('refuses a topic beyond the length cap with 400', async () => {
      const mock = runner();
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.createPlan(serverRequest({ body: { topic: 'x'.repeat(600) } }), response.res);

      expect(response.statusCode).toBe(400);
      expect(mock.createPlan).not.toHaveBeenCalled();
    });

    it('surfaces a runner failure as a 500', async () => {
      const mock = runner();
      mock.createPlan.mockRejectedValue(new Error('boom'));
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.createPlan(serverRequest({ body: { topic: TOPIC } }), response.res);

      expect(response.statusCode).toBe(500);
      expect(response.body).toEqual({ error: 'Error creating plan' });
    });

    it('answers 401 without calling the runner when the request has no user', async () => {
      const mock = runner();
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.createPlan(
        serverRequest({ user: undefined, body: { topic: TOPIC } }),
        response.res,
      );

      expect(response.statusCode).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
      expect(mock.createPlan).not.toHaveBeenCalled();
    });
  });

  describe('run (SSE)', () => {
    it('streams the step: start event, runner emit, completion, end — with streamed seq', async () => {
      const mock = runner();
      mock.runStep.mockImplementation(async (_input, _signal, emit) => {
        emit({
          kind: 'progress',
          status: 'running',
          code: 'sources_read',
          stepId: 'step-1',
          detail: 'Read 3 sources',
          progress: 0.6,
        });
        return { detail: 'Findings summary', citations: [] };
      });
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.runStep(serverRequest({ query: runQuery() }), response.res);

      expect(mock.runStep).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: TOPIC,
          step: { id: 'step-1', title: 'Background', query: 'background query' },
        }),
        expect.anything(),
        expect.any(Function),
      );
      expect(response.isCommitted).toBe(true);
      expect(response.ended).toBe(true);
      const events = parseEvents(response.writes);
      expect(events.map((event) => event.code)).toEqual([
        'step_started',
        'sources_read',
        'step_completed',
      ]);
      /* seq is stamped in stream order, not by the runner */
      expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
      expect(events[2]).toMatchObject({
        kind: 'step',
        stepId: 'step-1',
        detail: 'Findings summary',
      });
    });

    it('refuses incomplete or non-string run parameters with 400 before streaming', async () => {
      const mock = runner();
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.runStep(
        serverRequest({ query: { ...runQuery(), topic: undefined } }),
        response.res,
      );

      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual({
        error: 'topic, stepId, title and query are required as non-empty strings',
      });
      expect(mock.runStep).not.toHaveBeenCalled();
    });

    it('refuses an array query value with 400 instead of coercing it', async () => {
      const mock = runner();
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.runStep(
        serverRequest({ query: { ...runQuery(), stepId: ['step-1'] } }),
        response.res,
      );

      expect(response.statusCode).toBe(400);
      expect(mock.runStep).not.toHaveBeenCalled();
    });

    it('reports a mid-stream runner failure as a failed event on the open stream', async () => {
      const mock = runner();
      mock.runStep.mockRejectedValue(new Error('search exploded'));
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.runStep(serverRequest({ query: runQuery() }), response.res);

      const events = parseEvents(response.writes);
      expect(events[0].code).toBe('step_started');
      expect(events[events.length - 1]).toMatchObject({
        kind: 'error',
        status: 'failed',
        code: 'step_failed',
        stepId: 'step-1',
      });
      expect(response.ended).toBe(true);
    });

    it('ends quietly when the stream is closed client-side mid-run', async () => {
      const mock = runner();
      mock.runStep.mockImplementation(
        (_input, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(abortError()));
          }),
      );
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      const promise = handlers.runStep(serverRequest({ query: runQuery() }), response.res);
      response.close?.();
      await promise;

      /* Only the initial step_started event, no synthetic failure afterwards. */
      expect(parseEvents(response.writes)).toHaveLength(1);
      expect(response.ended).toBe(true);
    });

    it('answers 401 before opening the stream when the request has no user', async () => {
      const mock = runner();
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.runStep(serverRequest({ user: undefined, query: runQuery() }), response.res);

      expect(response.statusCode).toBe(401);
      expect(response.isCommitted).toBe(false);
      expect(mock.runStep).not.toHaveBeenCalled();
    });
  });

  describe('report', () => {
    it('builds a report from a valid plan body, preserving steps and citations', async () => {
      const mock = runner();
      mock.buildReport.mockResolvedValue(report());
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.buildReport(
        serverRequest({
          body: {
            plan: {
              topic: TOPIC,
              steps: [
                {
                  id: 'step-1',
                  title: 'Background',
                  query: 'background query',
                  detail: 'Finding',
                  citations: [{ id: 'citation-1', title: 'A source', url: 'https://example.com' }],
                },
              ],
            },
          },
        }),
        response.res,
      );

      expect(mock.buildReport).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: TOPIC,
          steps: [
            expect.objectContaining({
              id: 'step-1',
              detail: 'Finding',
              citations: [{ id: 'citation-1', title: 'A source', url: 'https://example.com' }],
            }),
          ],
        }),
        expect.anything(),
      );
      expect(response.statusCode).toBe(200);
      expect(response.body).toMatchObject({
        planId: 'plan-1',
        title: 'Research report: fusion energy',
      });
    });

    it('refuses a plan with no steps with 400', async () => {
      const mock = runner();
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.buildReport(
        serverRequest({ body: { plan: { topic: TOPIC, steps: [] } } }),
        response.res,
      );

      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual({
        error: 'plan requires a topic and at least one step with id, title and query',
      });
      expect(mock.buildReport).not.toHaveBeenCalled();
    });

    it('refuses a missing plan with 400', async () => {
      const mock = runner();
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.buildReport(serverRequest({ body: {} }), response.res);

      expect(response.statusCode).toBe(400);
      expect(mock.buildReport).not.toHaveBeenCalled();
    });

    it('refuses a step without a title with 400', async () => {
      const mock = runner();
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.buildReport(
        serverRequest({
          body: { plan: { topic: TOPIC, steps: [{ id: 'step-1', title: '', query: 'q' }] } },
        }),
        response.res,
      );

      expect(response.statusCode).toBe(400);
      expect(mock.buildReport).not.toHaveBeenCalled();
    });

    it('surfaces a report failure as a 500', async () => {
      const mock = runner();
      mock.buildReport.mockRejectedValue(new Error('boom'));
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.buildReport(serverRequest({ body: singleStepPlanBody() }), response.res);

      expect(response.statusCode).toBe(500);
      expect(response.body).toEqual({ error: 'Error building report' });
    });

    it('answers 401 without building when the request has no user', async () => {
      const mock = runner();
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.buildReport(
        serverRequest({ user: undefined, body: singleStepPlanBody() }),
        response.res,
      );

      expect(response.statusCode).toBe(401);
      expect(mock.buildReport).not.toHaveBeenCalled();
    });
  });

  describe('config lever', () => {
    function disabledRequest(overrides: Record<string, unknown> = {}): ServerRequest {
      return serverRequest({
        config: { config: { deepResearch: { enabled: false } } },
        ...overrides,
      });
    }

    it('answers 503 with the unavailable code on every route when the lever is off', async () => {
      const mock = runner();
      const handlers = createDeepResearchHandlers({ runner: mock });
      const planResponse = mockResponse();
      const runResponse = mockResponse();
      const reportResponse = mockResponse();

      await handlers.createPlan(disabledRequest({ body: { topic: TOPIC } }), planResponse.res);
      await handlers.runStep(disabledRequest({ query: runQuery() }), runResponse.res);
      await handlers.buildReport(
        disabledRequest({ body: singleStepPlanBody() }),
        reportResponse.res,
      );

      expect(planResponse.statusCode).toBe(503);
      expect(runResponse.statusCode).toBe(503);
      expect(reportResponse.statusCode).toBe(503);
      expect(planResponse.body).toEqual({ error: 'deep_research_unavailable' });
      expect(runResponse.isCommitted).toBe(false);
      expect(reportResponse.body).toEqual({ error: 'deep_research_unavailable' });
      expect(mock.createPlan).not.toHaveBeenCalled();
      expect(mock.runStep).not.toHaveBeenCalled();
      expect(mock.buildReport).not.toHaveBeenCalled();
    });

    it('serves every route when the config block is absent entirely', async () => {
      const mock = runner();
      mock.createPlan.mockResolvedValue(plan());
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.createPlan(
        serverRequest({ config: undefined, body: { topic: TOPIC } }),
        response.res,
      );

      expect(response.statusCode).toBe(200);
    });
  });

  describe('unsupported provider', () => {
    it('maps a thrown DeepResearchUnsupportedError to 422 instead of 500', async () => {
      const mock = runner();
      mock.createPlan.mockRejectedValue(new DeepResearchUnsupportedError());
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.createPlan(serverRequest({ body: { topic: TOPIC } }), response.res);

      expect(response.statusCode).toBe(422);
    });

    it('maps a thrown DeepResearchUnsupportedError to 422 on a report request', async () => {
      const mock = runner();
      mock.buildReport.mockRejectedValue(new DeepResearchUnsupportedError('No LLM'));
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.buildReport(serverRequest({ body: singleStepPlanBody() }), response.res);

      expect(response.statusCode).toBe(422);
      expect(response.body).toEqual({ error: 'No LLM' });
    });

    it('carries a provider-unsupported failure as an error event on an open stream', async () => {
      const mock = runner();
      mock.runStep.mockRejectedValue(new DeepResearchUnsupportedError('No search provider'));
      const handlers = createDeepResearchHandlers({ runner: mock });
      const response = mockResponse();

      await handlers.runStep(serverRequest({ query: runQuery() }), response.res);

      const events = parseEvents(response.writes);
      expect(events[events.length - 1]).toMatchObject({
        kind: 'error',
        code: 'provider_unsupported',
        detail: 'No search provider',
      });
      expect(response.ended).toBe(true);
    });
  });
});

function abortError(): Error {
  const error = new Error('Deep research run aborted');
  error.name = 'AbortError';
  return error;
}
