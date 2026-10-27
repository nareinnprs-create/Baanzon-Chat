import type { Response } from 'express';
import type { TrustService } from './types';
import type { ServerRequest } from '~/types/http';
import { createTrustHandlers } from './handlers';

const USER_ID = '507f1f77bcf86cd7994390aa';

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

const VERDICT = { score: 90, state: 'verified', sourcesCount: 1 };

function service(overrides: Partial<jest.Mocked<TrustService>> = {}): jest.Mocked<TrustService> {
  return {
    evaluate: jest.fn().mockResolvedValue(VERDICT),
    ...overrides,
  } as unknown as jest.Mocked<TrustService>;
}

function make(overrides: Partial<{ service: TrustService }> = {}): {
  handlers: ReturnType<typeof createTrustHandlers>;
  deps: { service: jest.Mocked<TrustService> };
} {
  const deps = { service: service(overrides.service as Partial<jest.Mocked<TrustService>>) };
  return { handlers: createTrustHandlers({ service: deps.service }), deps };
}

describe('trust handlers — GET /api/trust/:entityType/:id', () => {
  it('returns 200 with the resolved verdict from the service', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();
    const req = serverRequest({
      params: { entityType: 'message', id: 'ab12cd34' },
      query: { credibility: '100', ageDays: '30', positive: '3', negative: '1' },
    });

    await handlers.getTrust(req, state.res);

    expect(state.statusCode).toBe(200);
    expect(state.body).toEqual({
      entityType: 'message',
      id: 'ab12cd34',
      trust: VERDICT,
    });
    expect(deps.service.evaluate).toHaveBeenCalledWith({
      input: {
        sources: [{ credibility: 100, ageDays: 30 }],
        feedback: { positive: 3, negative: 1 },
      },
      config: {},
    });
  });

  it('pairs evidence lists by index and tolerates a shorter ageDays list', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();
    const req = serverRequest({
      params: { entityType: 'artifact', id: 'artifact-1' },
      query: { credibility: '80,60', ageDays: '5' },
    });

    await handlers.getTrust(req, state.res);

    expect(state.statusCode).toBe(200);
    expect(deps.service.evaluate).toHaveBeenCalledWith({
      input: {
        sources: [
          { credibility: 80, ageDays: 5 },
          { credibility: 60, ageDays: undefined },
        ],
        feedback: undefined,
      },
      config: {},
    });
  });

  it('omits the feedback signal entirely when no feedback query exists', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();
    await handlers.getTrust(
      serverRequest({ params: { entityType: 'agent', id: 'a1' }, query: { credibility: '50' } }),
      state.res,
    );

    expect(deps.service.evaluate).toHaveBeenCalledWith({
      input: { sources: [{ credibility: 50, ageDays: undefined }], feedback: undefined },
      config: {},
    });
  });

  it('sends malformed evidence values as 0s into the service, never past it', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();
    const req = serverRequest({
      params: { entityType: 'message', id: 'x' },
      query: { credibility: '100,abc', negative: 'nan' },
    });

    await handlers.getTrust(req, state.res);

    expect(state.statusCode).toBe(200);
    expect(deps.service.evaluate).toHaveBeenCalledWith({
      input: {
        sources: [
          { credibility: 100, ageDays: undefined },
          { credibility: 0, ageDays: undefined },
        ],
        feedback: { positive: 0, negative: 0 },
      },
      config: {},
    });
  });

  it('carries the request config levers into the service call', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();
    const req = serverRequest({
      params: { entityType: 'message', id: 'x' },
      query: { credibility: '60' },
      config: { config: { trustEngine: { sourceWeight: 1, recencyHalfLifeDays: 14 } } },
    });

    await handlers.getTrust(req, state.res);

    expect(deps.service.evaluate).toHaveBeenCalledWith({
      input: { sources: [{ credibility: 60, ageDays: undefined }], feedback: undefined },
      config: { sourceWeight: 1, recencyHalfLifeDays: 14 },
    });
  });

  it('rejects an unregistered entityType with 400 before the service runs', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();

    await handlers.getTrust(serverRequest({ params: { entityType: 'convo', id: 'x' } }), state.res);

    expect(state.statusCode).toBe(400);
    expect(state.body).toEqual({ error: 'Unknown trust entity type' });
    expect(deps.service.evaluate).not.toHaveBeenCalled();
  });

  it('rejects a missing or oversized id with 400 before the service runs', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();

    await handlers.getTrust(serverRequest({ params: { entityType: 'message' } }), state.res);
    expect(state.statusCode).toBe(400);
    expect(state.body).toEqual({ error: 'Invalid trust entity id' });

    await handlers.getTrust(
      serverRequest({ params: { entityType: 'message', id: 'x'.repeat(513) } }),
      state.res,
    );
    expect(state.statusCode).toBe(400);
    expect(deps.service.evaluate).not.toHaveBeenCalled();
  });

  it('answers 401 when called without a user (defense in depth; the route carries JWT auth)', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();

    await handlers.getTrust(
      serverRequest({ user: undefined, params: { entityType: 'message', id: 'x' } }),
      state.res,
    );

    expect(state.statusCode).toBe(401);
    expect(state.body).toEqual({ error: 'Authentication required' });
    expect(deps.service.evaluate).not.toHaveBeenCalled();
  });

  it('degrades a service failure to 500 instead of leaking state', async () => {
    const { handlers } = make({
      service: service({ evaluate: jest.fn().mockRejectedValue(new Error('engine down')) }),
    });
    const state = mockResponse();

    await handlers.getTrust(
      serverRequest({ params: { entityType: 'message', id: 'x' }, query: { credibility: '1' } }),
      state.res,
    );

    expect(state.statusCode).toBe(500);
    expect(state.body).toEqual({ error: 'Error evaluating trust' });
  });
});
