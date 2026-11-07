import type { Response } from 'express';
import type { EntitlementAccessStore, EntitlementService } from './types';
import type { ServerRequest } from '~/types/http';
import { createEntitlementHandlers } from './handlers';

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

const DEFAULT_MATRIX = {
  free: {
    tokens: 1000,
    storage: -1,
    voice: -1,
    media: -1,
    search: -1,
    agentCompute: -1,
    workflowExecutions: -1,
  },
  basic: {
    tokens: -1,
    storage: -1,
    voice: -1,
    media: -1,
    search: -1,
    agentCompute: -1,
    workflowExecutions: -1,
  },
  pro: {
    tokens: -1,
    storage: -1,
    voice: -1,
    media: -1,
    search: -1,
    agentCompute: -1,
    workflowExecutions: -1,
  },
  enterprise: {
    tokens: -1,
    storage: -1,
    voice: -1,
    media: -1,
    search: -1,
    agentCompute: -1,
    workflowExecutions: -1,
  },
};

function service(
  overrides: Partial<jest.Mocked<EntitlementService>> = {},
): jest.Mocked<EntitlementService> {
  return {
    resolveEntitlements: jest.fn().mockResolvedValue(DEFAULT_MATRIX),
    setEntitlement: jest.fn().mockResolvedValue({
      plan: 'pro',
      resource: 'workflowExecutions',
      scope: 'organization',
      scopeId: ORG_ID,
      limit: 25,
    }),
    ...overrides,
  } as unknown as jest.Mocked<EntitlementService>;
}

function access(
  overrides: Partial<jest.Mocked<EntitlementAccessStore>> = {},
): jest.Mocked<EntitlementAccessStore> {
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
  } as unknown as jest.Mocked<EntitlementAccessStore>;
}

interface Deps {
  service: jest.Mocked<EntitlementService>;
  access: jest.Mocked<EntitlementAccessStore>;
}

function make(overrides: Partial<Deps> = {}): {
  handlers: ReturnType<typeof createEntitlementHandlers>;
  deps: Deps;
} {
  const deps: Deps = { service: service(), access: access(), ...overrides };
  return {
    handlers: createEntitlementHandlers({ service: deps.service, access: deps.access }),
    deps,
  };
}

describe('entitlement handlers — GET /api/billing/entitlements', () => {
  it('returns 200 with the resolved matrix from the service', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();

    await handlers.getEntitlements(serverRequest(), state.res);

    expect(state.statusCode).toBe(200);
    expect(state.body).toEqual({ entitlements: DEFAULT_MATRIX });
    expect(deps.service.resolveEntitlements).toHaveBeenCalledWith({
      config: {},
      organizationId: undefined,
    });
  });

  it('passes a string `organizationId` query and the request config levers', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();
    const req = serverRequest({
      query: { organizationId: ORG_ID },
      config: { config: { billing: { limits: { pro: { tokens: 999 } } } } },
    });

    await handlers.getEntitlements(req, state.res);

    expect(state.statusCode).toBe(200);
    expect(deps.service.resolveEntitlements).toHaveBeenCalledWith({
      config: expect.objectContaining({ pro: { tokens: 999 } }),
      organizationId: ORG_ID,
    });
  });

  it('degrades a store failure to 500 instead of leaking state', async () => {
    const { handlers } = make({
      service: service({
        resolveEntitlements: jest.fn().mockRejectedValue(new Error('store down')),
      }),
    });
    const state = mockResponse();

    await handlers.getEntitlements(serverRequest(), state.res);

    expect(state.statusCode).toBe(500);
    expect(state.body).toEqual({ error: 'Error resolving entitlements' });
  });
});

describe('entitlement handlers — PUT /api/billing/entitlements/:plan/:resource', () => {
  function putRequest(overrides: Record<string, unknown> = {}): ServerRequest {
    return serverRequest({
      params: { plan: 'pro', resource: 'workflowExecutions' },
      body: { limit: 25, scope: 'organization', scopeId: ORG_ID },
      ...overrides,
    });
  }

  it('persists an entitlement for an org-admin caller', async () => {
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

    await handlers.setEntitlement(putRequest(), state.res);

    expect(state.statusCode).toBe(200);
    expect(state.body).toEqual({
      plan: 'pro',
      resource: 'workflowExecutions',
      scope: 'organization',
      scopeId: ORG_ID,
      limit: 25,
    });
    expect(deps.service.setEntitlement).toHaveBeenCalledWith({
      plan: 'pro',
      resource: 'workflowExecutions',
      scope: 'organization',
      scopeId: ORG_ID,
      limit: 25,
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

    await handlers.setEntitlement(putRequest(), state.res);

    expect(state.statusCode).toBe(403);
    expect(deps.service.setEntitlement).not.toHaveBeenCalled();
  });

  it('forbids an admin from writing a global entitlement (owner rank required)', async () => {
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
    const req = putRequest({ body: { limit: 25, scope: 'global', scopeId: ORG_ID } });

    await handlers.setEntitlement(req, state.res);

    expect(state.statusCode).toBe(403);
    expect(deps.service.setEntitlement).not.toHaveBeenCalled();
  });

  it('lets the organization document owner write a global entitlement without a scopeId', async () => {
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
    const req = putRequest({ body: { limit: 500, scope: 'global', scopeId: ORG_ID } });

    await handlers.setEntitlement(req, state.res);

    expect(state.statusCode).toBe(200);
    expect(deps.service.setEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'global', scopeId: undefined, limit: 500 }),
    );
  });

  it('rejects an unknown plan with 400 before touching the store', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();
    const req = putRequest({ params: { plan: 'ultra', resource: 'tokens' } });

    await handlers.setEntitlement(req, state.res);

    expect(state.statusCode).toBe(400);
    expect(state.body).toEqual({ error: 'Unknown entitlement plan' });
    expect(deps.access.getOrganization).not.toHaveBeenCalled();
    expect(deps.service.setEntitlement).not.toHaveBeenCalled();
  });

  it('rejects an unknown resource with 400 before touching the store', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();
    const req = putRequest({ params: { plan: 'pro', resource: 'quantum' } });

    await handlers.setEntitlement(req, state.res);

    expect(state.statusCode).toBe(400);
    expect(state.body).toEqual({ error: 'Unknown entitlement resource' });
    expect(deps.access.getOrganization).not.toHaveBeenCalled();
    expect(deps.service.setEntitlement).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload with 400', async () => {
    const { handlers, deps } = make();
    const state = mockResponse();
    const req = putRequest({ body: { limit: 'unlimited' } });

    await handlers.setEntitlement(req, state.res);

    expect(state.statusCode).toBe(400);
    expect(state.body).toEqual({ error: 'Invalid entitlement payload' });
    expect(deps.service.setEntitlement).not.toHaveBeenCalled();
  });

  it('forbids a scopeId that names no organization (non-member answers 403 too)', async () => {
    const { handlers, deps } = make({
      access: access({
        getOrganization: jest.fn().mockResolvedValue(null),
        getMembership: jest.fn().mockResolvedValue(null),
      }),
    });
    const state = mockResponse();

    await handlers.setEntitlement(putRequest(), state.res);

    expect(state.statusCode).toBe(403);
    expect(deps.service.setEntitlement).not.toHaveBeenCalled();
  });
});
