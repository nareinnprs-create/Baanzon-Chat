import type { Response } from 'express';
import type { FlagAccessStore, FlagService } from './types';
import type { ServerRequest } from '~/types/http';
import { createFlagHandlers } from './handlers';

const USER_ID = '507f1f77bcf86cd7994390aa';
const ORG_ID = '64b64b64b64b64b64b64b640';

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

const DEFAULT_MAP = {
  'workspace.projects': true,
  'deepResearch.ui': true,
  'workflow.builder': false,
};

function service(overrides: Partial<jest.Mocked<FlagService>> = {}): jest.Mocked<FlagService> {
  return {
    resolveFlags: jest.fn().mockResolvedValue(DEFAULT_MAP),
    setFlag: jest.fn().mockResolvedValue({
      key: 'deepResearch.ui',
      scope: 'organization',
      scopeId: ORG_ID,
      value: false,
    }),
    ...overrides,
  } as unknown as jest.Mocked<FlagService>;
}

function access(
  overrides: Partial<jest.Mocked<FlagAccessStore>> = {},
): jest.Mocked<FlagAccessStore> {
  return {
    getOrganization: jest.fn().mockResolvedValue({
      _id: ORG_ID,
      name: 'Org',
      slug: 'org',
      owner: '64b64b64b64b64b64b64b6ff',
      status: 'active',
      isPersonal: false,
    }),
    getMembership: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as jest.Mocked<FlagAccessStore>;
}

interface Deps {
  service: jest.Mocked<FlagService>;
  access: jest.Mocked<FlagAccessStore>;
}

function make(overrides: Partial<Deps> = {}): {
  handlers: ReturnType<typeof createFlagHandlers>;
  deps: Deps;
} {
  const deps: Deps = { service: service(), access: access(), ...overrides };
  return { handlers: createFlagHandlers({ service: deps.service, access: deps.access }), deps };
}

describe('flag handlers — GET /api/flags', () => {
  it('returns 200 with the resolved map from the service', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();

    await handlers.getFlags(serverRequest(), state.res);

    expect(state.statusCode).toBe(200);
    expect(state.body).toEqual({ flags: DEFAULT_MAP });
    expect(deps.service.resolveFlags).toHaveBeenCalledWith({
      config: {},
      organizationId: undefined,
    });
  });

  it('passes a string `organizationId` query and the request config levers', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();
    const req = serverRequest({
      query: { organizationId: ORG_ID },
      config: { config: { featureFlags: { 'workspace.projects': false } } },
    });

    await handlers.getFlags(req, state.res);

    expect(state.statusCode).toBe(200);
    expect(deps.service.resolveFlags).toHaveBeenCalledWith({
      config: expect.objectContaining({ 'workspace.projects': false }),
      organizationId: ORG_ID,
    });
  });

  it('degrades a store failure to 500 instead of leaking state', async () => {
    const { handlers } = make({
      service: service({ resolveFlags: jest.fn().mockRejectedValue(new Error('store down')) }),
    });
    const state = mockResponse();

    await handlers.getFlags(serverRequest(), state.res);

    expect(state.statusCode).toBe(500);
    expect(state.body).toEqual({ error: 'Error resolving feature flags' });
  });
});

describe('flag handlers — PUT /api/flags/:key', () => {
  function putRequest(overrides: Record<string, unknown> = {}): ServerRequest {
    return serverRequest({
      params: { key: 'deepResearch.ui' },
      body: { value: false, scope: 'organization', scopeId: ORG_ID },
      ...overrides,
    });
  }

  it('persists an override for an org-admin caller', async () => {
    const { handlers, deps } = make({
      access: access({
        getMembership: jest.fn().mockResolvedValue({
          _id: 'admin-membership',
          organizationId: ORG_ID,
          userId: USER_ID,
          role: 'admin',
          status: 'active',
        }),
      }),
    });
    const state = mockResponse();

    await handlers.setFlag(putRequest(), state.res);

    expect(state.statusCode).toBe(200);
    expect(state.body).toEqual({
      key: 'deepResearch.ui',
      scope: 'organization',
      scopeId: ORG_ID,
      value: false,
    });
    expect(deps.service.setFlag).toHaveBeenCalledWith({
      key: 'deepResearch.ui',
      scope: 'organization',
      scopeId: ORG_ID,
      value: false,
    });
  });

  it('forbids a caller who is not an organization admin or owner', async () => {
    const { handlers, deps } = make({
      access: access({
        getMembership: jest.fn().mockResolvedValue({
          _id: 'member',
          organizationId: ORG_ID,
          userId: USER_ID,
          role: 'member',
          status: 'active',
        }),
      }),
    });
    const state = mockResponse();

    await handlers.setFlag(putRequest(), state.res);

    expect(state.statusCode).toBe(403);
    expect(deps.service.setFlag).not.toHaveBeenCalled();
  });

  it('forbids an admin from writing a global override (owner rank required)', async () => {
    const { handlers, deps } = make({
      access: access({
        getMembership: jest.fn().mockResolvedValue({
          _id: 'admin',
          organizationId: ORG_ID,
          userId: USER_ID,
          role: 'admin',
          status: 'active',
        }),
      }),
    });
    const state = mockResponse();
    const req = putRequest({ body: { value: false, scope: 'global', scopeId: ORG_ID } });

    await handlers.setFlag(req, state.res);

    expect(state.statusCode).toBe(403);
    expect(deps.service.setFlag).not.toHaveBeenCalled();
  });

  it('lets the organization document owner write a global override without a scopeId', async () => {
    const { handlers, deps } = make({
      access: access({
        getOrganization: jest.fn().mockResolvedValue({
          _id: ORG_ID,
          name: 'Org',
          slug: 'org',
          owner: USER_ID,
          status: 'active',
          isPersonal: false,
        }),
      }),
    });
    const state = mockResponse();
    const req = putRequest({ body: { value: false, scope: 'global', scopeId: ORG_ID } });

    await handlers.setFlag(req, state.res);

    expect(state.statusCode).toBe(200);
    expect(deps.service.setFlag).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'global', scopeId: undefined, value: false }),
    );
  });

  it('rejects an unknown flag key with 400 before touching the store', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();
    const req = putRequest({ params: { key: 'stale.removed.flag' } });

    await handlers.setFlag(req, state.res);

    expect(state.statusCode).toBe(400);
    expect(state.body).toEqual({ error: 'Unknown feature flag' });
    expect(deps.access.getOrganization).not.toHaveBeenCalled();
    expect(deps.service.setFlag).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload with 400', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();
    const req = putRequest({ body: { value: 'off' } });

    await handlers.setFlag(req, state.res);

    expect(state.statusCode).toBe(400);
    expect(state.body).toEqual({ error: 'Invalid feature flag payload' });
    expect(deps.service.setFlag).not.toHaveBeenCalled();
  });

  it('forbids a scopeId that names no organization (non-member answers 403 too)', async () => {
    const { handlers, deps } = make({
      access: access({
        getOrganization: jest.fn().mockResolvedValue(null),
        getMembership: jest.fn().mockResolvedValue(null),
      }),
    });
    const state = mockResponse();

    await handlers.setFlag(putRequest(), state.res);

    expect(state.statusCode).toBe(403);
    expect(deps.service.setFlag).not.toHaveBeenCalled();
  });
});
