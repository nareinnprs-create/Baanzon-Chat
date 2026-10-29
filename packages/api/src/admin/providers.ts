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
  fetchImpl?: (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
    status: number;
    json: () => Promise<unknown>;
  }>;
  /** Overrides `modelListCache` singleton (tests). */
  cache?: {
    get: (key: string) => Promise<string[] | undefined>;
    set: (key: string, value: string[], ttlMs?: number) => Promise<void>;
  };
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
      const rawHeaders = endpoint.headers ?? {};
      return {
        name: endpoint.name,
        baseURL: endpoint.baseURL,
        title: endpoint.modelDisplayLabel,
        apiKeyUserProvided: isUserProvided(apiKey),
        apiKeyPreview: endpoint.apiKeyPreview,
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

export function createAdminProvidersHandlers(deps: AdminProvidersDeps) {
  const fetchImpl = deps.fetchImpl ?? ((url: string, init: Parameters<typeof fetch>[1]) =>
    fetch(url, init) as unknown as Promise<{ status: number; json: () => Promise<unknown> }>);
  const cache = deps.cache ?? modelListCache;

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

  /**
   * POST /providers/test — live `GET {baseURL}/models` probe. Uses the same
   * SSRF validation as chat-time endpoint resolution, treats user-supplied
   * base URLs as the relaxed (allowedAddresses-aware) profile, and caches the
   * successful manifest for the shared 2-minute TTL so repeated probes within
   * the window reuse one upstream round-trip.
   */
  async function testProvider(req: ServerRequest, res: Response) {
    const { baseURL, apiKey, headerName, skipCache } = (req.body ?? {}) as {
      baseURL?: string;
      apiKey?: string;
      headerName?: string;
      skipCache?: boolean;
    };

    if (!baseURL || !apiKey) {
      return res.status(400).json({ status: 'error', error: 'baseURL and apiKey are required' });
    }

    try {
      await validateEndpointURL(baseURL, EModelEndpoint.custom, undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(400).json({ status: 'error', error: message });
    }

    const key = modelListCacheKey({ baseURL, apiKey });
    if (!skipCache) {
      const cached = await cache.get(key);
      if (cached) {
        return res.json({ status: 'ok', count: cached.length, models: cached.slice(0, MAX_PREVIEW_MODELS), cached: true });
      }
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (headerName) {
      headers[headerName] = `Bearer ${apiKey}`;
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const url = new URL(`${baseURL.replace(/\/+$/, '')}/models`);
      const response = await fetchImpl(url.toString(), {
        headers,
        signal: controller.signal,
      });
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
      await cache.set(key, models, DEFAULT_MODEL_LIST_TTL_MS);
      return res.json({ status: 'ok', count: models.length, models: models.slice(0, MAX_PREVIEW_MODELS) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.json({ status: 'error', error: message });
    } finally {
      clearTimeout(timeout);
    }
  }

  return { listProviders, testProvider };
}
