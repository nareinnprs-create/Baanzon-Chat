import type { Response } from 'express';
import type { IEvalRun } from '@librechat/data-schemas';
import type { EvalService } from './types';
import type { ServerRequest } from '~/types/http';
import { createEvalHandlers, serializeEvalRun } from './handlers';

const USER_ID = '507f1f77bcf86cd7994390aa';
const RUN_ID = '64b64b64b64b64b64b64b640';

function makeRun(overrides: Partial<IEvalRun> = {}): IEvalRun {
  return {
    _id: RUN_ID as never,
    agentId: '64b64b64b64b64b64b64b641',
    workflowId: null,
    datasetName: 'greeting-set',
    status: 'passed',
    dataset: { cases: [] },
    scores: [{ name: 'hi', passed: true, failures: [] }],
    error: null,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    finishedAt: new Date('2026-01-01T00:00:01Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:01Z'),
    ...overrides,
  };
}

interface MockResponse {
  res: Response;
  statusCode: number;
  body?: Record<string, unknown>;
}

function mockResponse(): MockResponse {
  const state: MockResponse = {
    res: undefined as unknown as Response,
    statusCode: 200,
    body: undefined,
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

const VALID_BODY = {
  agentId: '64b64b64b64b64b64b64b641',
  datasetName: 'greeting-set',
  dataset: {
    cases: [
      {
        name: 'hi',
        input: 'hi',
        expected: 'Hello',
        assertions: [{ type: 'exact', value: 'Hello' }],
      },
    ],
  },
};

function service(overrides: Partial<jest.Mocked<EvalService>> = {}): jest.Mocked<EvalService> {
  return {
    startRun: jest.fn().mockResolvedValue(makeRun()),
    listRuns: jest.fn().mockResolvedValue([makeRun()]),
    getRun: jest.fn().mockResolvedValue(makeRun()),
    ...overrides,
  } as unknown as jest.Mocked<EvalService>;
}

function make(overrides: Partial<{ service: jest.Mocked<EvalService> }> = {}) {
  const deps = { service: service(overrides.service) };
  return { handlers: createEvalHandlers({ service: deps.service }), deps };
}

describe('serializeEvalRun', () => {
  it('maps the stored run to the plain API shape', () => {
    const run = serializeEvalRun(makeRun());
    expect(run.id).toBe(RUN_ID);
    expect(run.status).toBe('passed');
    expect(run.startedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(run.dataset).toEqual({ cases: [] });
    expect(run.error).toBeNull();
  });
});

describe('eval handlers — POST /api/evals/runs', () => {
  it('returns 201 with the finished run', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();

    await handlers.createRun(serverRequest({ body: VALID_BODY }), state.res);

    expect(state.statusCode).toBe(201);
    expect(state.body).toMatchObject({ id: RUN_ID, status: 'passed' });
    expect(deps.service.startRun).toHaveBeenCalledWith(VALID_BODY);
  });

  it('rejects an invalid payload with 400 before the service is touched', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();

    await handlers.createRun(serverRequest({ body: { datasetName: '' } }), state.res);

    expect(state.statusCode).toBe(400);
    expect(state.body).toEqual({ error: 'Invalid eval run payload' });
    expect(deps.service.startRun).not.toHaveBeenCalled();
  });

  it('rejects a payload with both targets or an unknown assertion type', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();
    const both = serverRequest({
      body: { ...VALID_BODY, workflowId: '64b64b64b64b64b64b64b650' },
    });

    await handlers.createRun(both, state.res);

    expect(state.statusCode).toBe(400);
    expect(deps.service.startRun).not.toHaveBeenCalled();

    const badAssertion = serverRequest({
      body: {
        ...VALID_BODY,
        dataset: {
          cases: [
            {
              name: 'hi',
              input: 'hi',
              expected: 'x',
              assertions: [{ type: 'semantic', value: 'x' }],
            },
          ],
        },
      },
    });
    const badAssertionState = mockResponse();
    await handlers.createRun(badAssertion, badAssertionState.res);
    expect(badAssertionState.statusCode).toBe(400);
    expect(deps.service.startRun).not.toHaveBeenCalled();
  });

  it('degrades a store failure to 500 instead of leaking state', async () => {
    const { handlers } = make({
      service: service({ startRun: jest.fn().mockRejectedValue(new Error('store down')) }),
    });
    const state = mockResponse();

    await handlers.createRun(serverRequest({ body: VALID_BODY }), state.res);

    expect(state.statusCode).toBe(500);
    expect(state.body).toEqual({ error: 'Error starting eval run' });
  });
});

describe('eval handlers — GET /api/evals/runs', () => {
  it('lists runs and forwards agent/workflow/limit filters', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();

    await handlers.listRuns(serverRequest({ query: { agentId: 'a1', limit: '5' } }), state.res);

    expect(state.statusCode).toBe(200);
    expect(state.body).toEqual({ runs: [serializeEvalRun(makeRun())] });
    expect(deps.service.listRuns).toHaveBeenCalledWith({
      agentId: 'a1',
      workflowId: undefined,
      limit: 5,
    });
  });

  it('degrades a store failure to 500', async () => {
    const { handlers } = make({
      service: service({ listRuns: jest.fn().mockRejectedValue(new Error('store down')) }),
    });
    const state = mockResponse();

    await handlers.listRuns(serverRequest(), state.res);

    expect(state.statusCode).toBe(500);
    expect(state.body).toEqual({ error: 'Error listing eval runs' });
  });
});

describe('eval handlers — GET /api/evals/runs/:id', () => {
  it('returns the run when the id names one', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();

    await handlers.getRun(serverRequest({ params: { id: RUN_ID } }), state.res);

    expect(state.statusCode).toBe(200);
    expect(state.body).toMatchObject({ id: RUN_ID });
    expect(deps.service.getRun).toHaveBeenCalledWith(RUN_ID);
  });

  it('answers 404 when the id names nothing', async () => {
    const { handlers } = make({
      service: service({ getRun: jest.fn().mockResolvedValue(null) }),
    });
    const state = mockResponse();

    await handlers.getRun(serverRequest({ params: { id: RUN_ID } }), state.res);

    expect(state.statusCode).toBe(404);
    expect(state.body).toEqual({ error: 'Eval run not found' });
  });
});

describe('eval handlers — auth', () => {
  it('answers 401 for every route when no user is resolved', async () => {
    const { handlers, deps } = make();
    const anon = { user: undefined };

    const created = mockResponse();
    await handlers.createRun(serverRequest({ ...anon, body: VALID_BODY }), created.res);
    const listed = mockResponse();
    await handlers.listRuns(serverRequest(anon), listed.res);
    const fetched = mockResponse();
    await handlers.getRun(serverRequest({ ...anon, params: { id: RUN_ID } }), fetched.res);

    expect(created.statusCode).toBe(401);
    expect(listed.statusCode).toBe(401);
    expect(fetched.statusCode).toBe(401);
    expect(deps.service.startRun).not.toHaveBeenCalled();
    expect(deps.service.listRuns).not.toHaveBeenCalled();
    expect(deps.service.getRun).not.toHaveBeenCalled();
  });
});
