import axios from 'axios';
import { EModelEndpoint } from 'librechat-data-provider';
import type { TEndpoint } from 'librechat-data-provider';
import type { Response } from 'express';
import type { GetAppConfigOptions } from '~/app/service';
import type { ServerRequest } from '~/types/http';
import {
  DEFAULT_MODEL_LIST_TTL_MS,
  modelListCache,
  modelListCacheKey,
} from '~/endpoints/config/modelCache';
import { validateEndpointURL } from '~/auth';
import { isUserProvided } from '~/utils';

/**
 * Admin-managed custom providers: read the configured `endpoints.custom`
 * block back through the sanitized config views and probe an upstream
 * `{baseURL}/models` live so an admin can confirm credentials work inline.
 */
export interface AdminProvidersDeps {
  getAppConfig: (options: GetAppConfigOptions) => Promise<{
    endpoints?: { [EModelEndpoint.custom]?: TEndpoint[] | unknown };
  }>;
  fetchImpl?: (
    url: string,
    init: { headers: Record<string, string>; signal: AbortSignal },
  ) => Promise<{
    status: number;
    json: () => Promise<unknown>;
  }>;
  /** Overrides `modelListCache` singleton (tests). */
  cache?: {
    get: (key: string) => Promise<string[] | undefined>;
    set: (key: string, value: string[], ttlMs?: number) => Promise<void>;
  };
}

/** Handlers shape — explicit for the isolated-declarations dts pass. */
export interface AdminProvidersHandlers {
  listProviders: (req: ServerRequest, res: Response) => Promise<Response | void>;
  testProvider: (req: ServerRequest, res: Response) => Promise<Response | void>;
}

const PROBE_TIMEOUT_MS = 10_000;
/** Model IDs returned in the OK payload, for the inline confirmation. */
const MAX_PREVIEW_MODELS = 8;

export interface SanitizedCustomProvider {
  name: string;
  baseURL?: string;
  title?: string;
  /** `true` when the endpoint's stored key is the USER_PROVIDED sentinel
   *  (per-user BYO) rather than a deployment secret. */
  apiKeyUserProvided: boolean;
  /** Masked preview recorded at config write time, e.g. `sk-…94f2`. */
  apiKeyPreview?: string;
  provider?: string;
  iconURL?: string;
  modelDisplayLabel?: string;
  /** Auth header the endpoint uses, when it is not the default `Authorization`. */
  headerName?: string;
  staticModels: string[];
  modelsFetch: boolean;
}

function extractHeaderName(endpoint: TEndpoint): string | undefined {
  const headers = endpoint.headers;
  if (!headers) {
    return undefined;
  }
  const hasAuthorizationHeader = Object.keys(headers).some(
    (key) => key.toLowerCase() === 'authorization',
  );
  if (hasAuthorizationHeader) {
    return undefined;
  }
  const first = Object.keys(headers).find(
    (key) => key.toLowerCase() !== 'accept' && key.toLowerCase() !== 'content-type',
  );
  return first;
}

/** Maps the configured custom block into the sanitized admin UI list. */
export function sanitizeCustomProviders(
  customEndpoints: unknown,
): SanitizedCustomProvider[] {
  if (!Array.isArray(customEndpoints)) {
    return [];
  }
  return (customEndpoints as TEndpoint[])
    .filter(
      (endpoint) =>
        endpoint?.baseURL &&
        endpoint?.name &&
        endpoint?.models &&
        (!!endpoint.models.fetch || Array.isArray(endpoint.models.default)),
    )
    .map((endpoint) => {
      const catalog = endpoint.models ?? {};
      const apiKey = endpoint.apiKey ?? '';
      return {
        name: endpoint.name,
        baseURL: endpoint.baseURL,
        title: endpoint.modelDisplayLabel,
        apiKeyUserProvided: isUserProvided(apiKey),
        apiKeyPreview:
          (typeof endpoint.apiKeyPreview === 'string' && endpoint.apiKeyPreview) ||
          (typeof apiKey === 'string' && !isUserProvided(apiKey) && apiKey.length > 8
            ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`
            : undefined),
        provider: endpoint.provider,
        iconURL: endpoint.iconURL,
        modelDisplayLabel: endpoint.modelDisplayLabel,
        headerName: extractHeaderName(endpoint),
        staticModels: (catalog.default ?? [])
          .map((model) => (typeof model === 'string' ? model : model?.name))
          .filter((name): name is string => !!name)
          .slice(0, MAX_PREVIEW_MODELS),
        modelsFetch: !!catalog.fetch,
      };
    });
}

export function createAdminProvidersHandlers(deps: AdminProvidersDeps): AdminProvidersHandlers {
  const cache = deps.cache ?? modelListCache;
  const fetchImpl: AdminProvidersDeps['fetchImpl'] =
    deps.fetchImpl ??
    ((url, init) => axios.get(url, init) as unknown as ReturnType<NonNullable<AdminProvidersDeps['fetchImpl']>>);

  async function listProviders(req: ServerRequest, res: Response) {
    const appConfig = await deps.getAppConfig({
      role: req.user?.role ?? '',
      tenantId: req.user?.tenantId,
      baseOnly: true,
    } as GetAppConfigOptions);
    return res.json({
      providers: sanitizeCustomProviders(appConfig?.endpoints?.[EModelEndpoint.custom]),
    });
  }

  async function testProvider(req: ServerRequest, res: Response) {
    const body = (req.body ?? {}) as {
      baseURL?: string;
      apiKey?: string;
      headerName?: string;
    };
    const baseURL = body.baseURL;
    if (!baseURL) {
      return res.json({ status: 'error', error: 'baseURL is required.' });
    }
    try {
      await validateEndpointURL(baseURL, 'admin-provider-test');
    } catch (error) {
      return res.json({
        status: 'error',
        error: error instanceof Error ? error.message : 'Invalid base URL.',
      });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const bodyRecord = body as { skipCache?: boolean };
    if (!bodyRecord.skipCache) {
      const cached = await cache.get(modelListCacheKey({ baseURL: baseURL, apiKey: body.apiKey ?? '' }));
      if (cached != null && cached.length > 0) {
        clearTimeout(timeout);
        return res.json({
          status: 'ok',
          cached: true,
          count: cached.length,
          models: cached.slice(0, MAX_PREVIEW_MODELS),
        });
      }
    }
    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (body.apiKey) {
        if (body.headerName) {
          headers[body.headerName] = body.apiKey;
        } else {
          headers.authorization = `Bearer ${body.apiKey}`;
        }
      }
      let response: { status: number; json: () => Promise<unknown> };
      try {
        response = await (fetchImpl as NonNullable<AdminProvidersDeps['fetchImpl']>)(`${baseURL.replace(/\/$/, '')}/models`, {
          headers,
          signal: controller.signal,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.json({ status: 'error', error: message });
      }
      if (response.status === 401 || response.status === 403) {
        return res.json({
          status: 'unauthorized',
          code: response.status,
          error: `Upstream returned ${response.status} for the provided key.`,
        });
      }
      if (response.status >= 400) {
        return res.json({
          status: 'error',
          code: response.status,
          error: `Upstream returned ${response.status}.`,
        });
      }
      const payload = (await response.json()) as { data?: unknown };
      const models = Array.isArray(payload?.data)
        ? (payload.data as Array<{ id?: string }>)
            .map((model) => model.id)
            .filter((id): id is string => !!id)
        : [];
      const key = modelListCacheKey({ baseURL: baseURL, apiKey: body.apiKey ?? '' });
      await cache.set(key, models, DEFAULT_MODEL_LIST_TTL_MS);
      return res.json({ status: 'ok', count: models.length, models: models.slice(0, MAX_PREVIEW_MODELS) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.json({ status: 'error', error: message });
    } finally {
      clearTimeout(timeout);
    }
  }

  return { listProviders: listProviders, testProvider: testProvider };
}
