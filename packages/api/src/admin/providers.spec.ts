import type { TAdminProviderTestRequest } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { createAdminProvidersHandlers, sanitizeCustomProviders } from './providers';

jest.mock('~/utils', () => ({
  isUserProvided: (value: string) => /^\s*USER_PROVIDED\s*$/i.test(value),
}));
jest.mock('~/auth', () => ({ validateEndpointURL: jest.fn().mockResolvedValue(undefined) }));

function mockRes(): { json: jest.Mock; statusCode: number } {
  const res: Response & { json: jest.Mock } = {
    status: undefined,
    send: undefined,
  } as unknown as Response & { json: jest.Mock };
  (res as unknown as Record<string, unknown>).status = jest.fn((code: number) => {
    (res as unknown as Record<string, number>).statusCode = code;
    return res;
  });
  (res as unknown as Record<string, unknown>).statusCode = 200;
  res.json = jest.fn((payload) => payload);
  return res as unknown as { json: jest.Mock; statusCode: number };
}

function req(body: unknown = {}, user = true): ServerRequest {
  return {
    user: user ? { id: 'u1', role: 'ADMIN' } : undefined,
    body,
  } as unknown as ServerRequest;
}

function probe(patch: Partial<TAdminProviderTestRequest> = {}): TAdminProviderTestRequest {
  return { baseURL: 'https://proxy.example.com/v1', apiKey: 'probe-key', ...patch };
}

describe('sanitizeCustomProviders', () => {
  it('maps configured custom endpoints into the sanitized admin view', () => {
    const providers = sanitizeCustomProviders([
      {
        name: 'Proxy',
        baseURL: 'https://proxy.example.com/v1',
        apiKey: 'sk-secret',
        apiKeyPreview: 'sk-…xxxx',
        models: { default: [{ name: 'm1' }, { name: 'm2' }], fetch: false },
        headers: { 'X-Key': 'inline' },
      },
      {
        name: 'Byo',
        baseURL: 'https://byo.example.com/v1',
        apiKey: 'USER_PROVIDED',
        models: { fetch: true },
      },
    ]);
    expect(providers).toHaveLength(2);
    expect(providers[0]).toMatchObject({
      name: 'Proxy',
      staticModels: ['m1', 'm2'],
      modelsFetch: false,
      headerName: 'X-Key',
      apiKeyUserProvided: false,
      apiKeyPreview: 'sk-…xxxx',
    });
    expect(providers[1]).toMatchObject({
      name: 'Byo',
      apiKeyUserProvided: true,
      modelsFetch: true,
    });
    /** Secrets never cross into the sanitized view. */
    expect(JSON.stringify(providers)).not.toContain('sk-secret');
  });

  it('drops incomplete entries and non-array payloads', () => {
    expect(sanitizeCustomProviders([{ name: 'x' }])).toHaveLength(0);
    expect(sanitizeCustomProviders(undefined)).toEqual([]);
    expect(sanitizeCustomProviders('nope')).toEqual([]);
  });
});

describe('admin providers handlers', () => {
  const appConfig = {
    endpoints: {
      custom: [
        {
          name: 'Proxy',
          baseURL: 'https://proxy.example.com/v1',
          apiKey: 'sk-secret',
          apiKeyPreview: 'sk-…xxxx',
          models: { default: [{ name: 'm1' }], fetch: false },
        },
      ],
    },
  };

  it('lists the sanitized provider catalog without secrets', async () => {
    const handlers = createAdminProvidersHandlers({
      getAppConfig: jest.fn().mockResolvedValue(appConfig),
    });
    const res = mockRes();
    await handlers.listProviders(req(), res as unknown as Response);
    expect(res.json).toHaveBeenCalledWith({
      providers: [expect.objectContaining({ name: 'Proxy', apiKeyPreview: 'sk-…xxxx' })],
    });
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('sk-secret');
  });

  it('rejects probes with missing baseURL or apiKey', async () => {
    const handlers = createAdminProvidersHandlers({
      getAppConfig: jest.fn().mockResolvedValue({}),
    });
    const res = mockRes();
    await handlers.testProvider(req(probe({ baseURL: undefined })), res as unknown as Response);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });

  it('probes an upstream manifest and reports OK with the model catalog', async () => {
    const cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const handlers = createAdminProvidersHandlers({
      getAppConfig: jest.fn().mockResolvedValue(appConfig),
      cache,
      fetchImpl: jest
        .fn()
        .mockResolvedValue({ status: 200, json: async () => ({ data: [{ id: 'a' }, { id: 'b' }] }) }),
    });
    const res = mockRes();
    await handlers.testProvider(req(probe()), res as unknown as Response);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', count: 2, models: ['a', 'b'] }),
    );
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), ['a', 'b'], expect.any(Number));
  });

  it('reports 401 as unauthorized and 4xx as error', async () => {
    const handlers = createAdminProvidersHandlers({
      getAppConfig: jest.fn().mockResolvedValue(appConfig),
      fetchImpl: jest
        .fn()
        .mockResolvedValueOnce({ status: 401, json: async () => ({}) })
        .mockResolvedValueOnce({ status: 500, json: async () => ({}) }),
    });
    const res = mockRes();
    await handlers.testProvider(req(probe({ apiKey: 'bad' })), res as unknown as Response);
    expect(res.json).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: 'unauthorized', code: 401 }),
    );
    await handlers.testProvider(req(probe({ apiKey: 'bad' })), res as unknown as Response);
    expect(res.json).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: 'error', code: 500 }),
    );
  });

  it('serves repeated probes from the cache within the TTL window', async () => {
    const cache = {
      get: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue(['cached-model']),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const fetchImpl = jest
      .fn()
      .mockResolvedValue({ status: 200, json: async () => ({ data: [{ id: 'live' }] }) });
    const handlers = createAdminProvidersHandlers({
      getAppConfig: jest.fn().mockResolvedValue(appConfig),
      cache,
      fetchImpl,
    });
    const res = mockRes();
    await handlers.testProvider(req(probe()), res as unknown as Response);
    expect(res.json).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'ok', count: 1 }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await handlers.testProvider(req(probe()), res as unknown as Response);
    expect(res.json).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'ok', cached: true, models: ['cached-model'] }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('bypasses the cache when skipCache is requested', async () => {
    const cache = {
      get: jest.fn().mockResolvedValue(['cached-model']),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const handlers = createAdminProvidersHandlers({
      getAppConfig: jest.fn().mockResolvedValue(appConfig),
      cache,
      fetchImpl: jest
        .fn()
        .mockResolvedValue({ status: 200, json: async () => ({ data: [{ id: 'live' }] }) }),
    });
    const res = mockRes();
    await handlers.testProvider(
      req(probe({ skipCache: true })),
      res as unknown as Response,
    );
    expect(cache.get).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ models: ['live'] }),
    );
  });
});
