import type { Response } from 'express';
import type { SearchStore } from './types';
import type { ServerRequest } from '~/types/http';
import { createSearchHandlers } from './handlers';

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

function store(overrides: Partial<jest.Mocked<SearchStore>> = {}): jest.Mocked<SearchStore> {
  return {
    searchConversationsByTitle: jest.fn().mockResolvedValue([
      {
        conversationId: 'convo-1',
        title: 'Project kickoff',
        updatedAt: new Date('2026-10-02T10:00:00.000Z'),
      },
    ]),
    searchChatProjectsByTitle: jest.fn().mockResolvedValue([
      {
        id: '507f1f77bcf86cd7994390bb',
        name: 'Project kickoff workspace',
        lastConversationAt: new Date('2026-10-05T10:00:00.000Z'),
      },
    ]),
    ...overrides,
  } as unknown as jest.Mocked<SearchStore>;
}

function make(overrides: Partial<{ store: SearchStore }> = {}): {
  handlers: ReturnType<typeof createSearchHandlers>;
  deps: { store: jest.Mocked<SearchStore> };
} {
  const deps = { store: store(overrides.store as Partial<jest.Mocked<SearchStore>>) };
  return { handlers: createSearchHandlers({ store: deps.store }), deps };
}

describe('search handlers — GET /api/search/all', () => {
  it('returns 200 with hits from both entities, freshest activity first', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();

    await handlers.searchAll(serverRequest({ query: { q: 'kickoff' } }), state.res);

    expect(state.statusCode).toBe(200);
    expect(state.body).toEqual({
      results: [
        {
          type: 'project',
          id: '507f1f77bcf86cd7994390bb',
          title: 'Project kickoff workspace',
          updatedAt: '2026-10-05T10:00:00.000Z',
          href: '/projects/507f1f77bcf86cd7994390bb',
        },
        {
          type: 'conversation',
          id: 'convo-1',
          title: 'Project kickoff',
          updatedAt: '2026-10-02T10:00:00.000Z',
          href: '/c/convo-1',
        },
      ],
    });
    const query = 'kickoff';
    expect(deps.store.searchConversationsByTitle).toHaveBeenCalledWith(USER_ID, query, 10);
    expect(deps.store.searchChatProjectsByTitle).toHaveBeenCalledWith(USER_ID, query, 10);
  });

  it('answers empty results without touching the store for an empty query', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();

    await handlers.searchAll(serverRequest({ query: { q: '   ' } }), state.res);

    expect(state.statusCode).toBe(200);
    expect(state.body).toEqual({ results: [] });
    expect(deps.store.searchConversationsByTitle).not.toHaveBeenCalled();
    expect(deps.store.searchChatProjectsByTitle).not.toHaveBeenCalled();
  });

  it('rejects a query longer than the wire cap with 400', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();

    await handlers.searchAll(serverRequest({ query: { q: 'x'.repeat(121) } }), state.res);

    expect(state.statusCode).toBe(400);
    expect(state.body).toEqual({ error: 'Search query too long' });
    expect(deps.store.searchConversationsByTitle).not.toHaveBeenCalled();
    expect(deps.store.searchChatProjectsByTitle).not.toHaveBeenCalled();
  });

  it('accepts a query at exactly the wire cap', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();

    await handlers.searchAll(serverRequest({ query: { q: 'x'.repeat(120) } }), state.res);

    expect(state.statusCode).toBe(200);
    expect(deps.store.searchConversationsByTitle).toHaveBeenCalled();
  });

  it('clamps an oversized `limit` to the protocol cap for both entities', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();

    await handlers.searchAll(serverRequest({ query: { q: 'kickoff', limit: '500' } }), state.res);

    expect(state.statusCode).toBe(200);
    expect(deps.store.searchConversationsByTitle).toHaveBeenCalledWith(USER_ID, 'kickoff', 20);
    expect(deps.store.searchChatProjectsByTitle).toHaveBeenCalledWith(USER_ID, 'kickoff', 20);
  });

  it('falls back to the config-lever default when `limit` is not a positive number', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();
    const req = serverRequest({
      query: { q: 'kickoff', limit: 'abc' },
      config: { config: { crossEntitySearch: { limit: 7 } } },
    });

    await handlers.searchAll(req, state.res);

    expect(state.statusCode).toBe(200);
    expect(deps.store.searchConversationsByTitle).toHaveBeenCalledWith(USER_ID, 'kickoff', 7);
    expect(deps.store.searchChatProjectsByTitle).toHaveBeenCalledWith(USER_ID, 'kickoff', 7);
  });

  it('answers empty results when both entities return nothing', async () => {
    const { handlers } = make({
      store: store({
        searchConversationsByTitle: jest.fn().mockResolvedValue([]),
        searchChatProjectsByTitle: jest.fn().mockResolvedValue([]),
      }),
    });
    const state = mockResponse();

    await handlers.searchAll(serverRequest({ query: { q: 'zzzz' } }), state.res);

    expect(state.statusCode).toBe(200);
    expect(state.body).toEqual({ results: [] });
  });

  it('degrades a store failure to 500 instead of leaking state', async () => {
    const { handlers } = make({
      store: store({
        searchConversationsByTitle: jest.fn().mockRejectedValue(new Error('store down')),
      }),
    });
    const state = mockResponse();

    await handlers.searchAll(serverRequest({ query: { q: 'kickoff' } }), state.res);

    expect(state.statusCode).toBe(500);
    expect(state.body).toEqual({ error: 'Error searching' });
  });

  it('answers 401 when called without a user (defense in depth; the route carries JWT auth)', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();

    await handlers.searchAll(
      serverRequest({ user: undefined, query: { q: 'kickoff' } }),
      state.res,
    );

    expect(state.statusCode).toBe(401);
    expect(deps.store.searchConversationsByTitle).not.toHaveBeenCalled();
  });
});
