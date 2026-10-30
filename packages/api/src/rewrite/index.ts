import { logger } from '@librechat/data-schemas';
import { EModelEndpoint } from 'librechat-data-provider';
import { HumanMessage, initializeModel, Providers, SystemMessage } from '@librechat/agents';
import type { AppConfig } from '@librechat/data-schemas';
import type { ClientOptions } from '@librechat/agents';
import type { EndpointDbMethods, ServerRequest } from '~/types';
import { getProviderConfig } from '~/endpoints/config/providers';
import { omitTitleOptions } from '~/agents/client';

export type RewriteMode = 'prompt' | 'recap';

export const REWRITE_MAX_TEXT_LENGTH = 32000;
export const REWRITE_MAX_INSTRUCTION_LENGTH = 2000;
export const REWRITE_MAX_ID_LENGTH = 200;
/** Matches the title-generation budget. */
export const REWRITE_DEFAULT_TIMEOUT_MS = 45000;

export interface RewriteInputValues {
  text: string;
  mode: RewriteMode;
  instruction?: string;
  endpoint?: string;
  model?: string;
}

export interface RewriteResponsePayload {
  text: string;
}

export interface RewriteHttpResponse {
  status: number;
  body: RewriteResponsePayload | { message: string };
}

export type ValidateRewriteInputResult =
  | { ok: true; value: RewriteInputValues }
  | { ok: false; error: string };

/** The slice of `db.getConvosByCursor` the latest-endpoint fallback needs. */
export type GetRecentConversations = (
  userId: string,
  options: { limit: number },
) => Promise<{ conversations: Array<{ endpoint?: string; model?: string }> }>;

export function isRewriteMode(value: unknown): value is RewriteMode {
  return value === 'prompt' || value === 'recap';
}

/**
 * Builds the system instruction for a rewrite request. Pure — exercised by spec.
 */
export function buildRewriteInstruction(mode: RewriteMode, instruction?: string): string {
  const base =
    mode === 'prompt'
      ? "You rewrite the user's text into a single clearer, more effective prompt. " +
        'Keep the language the text is written in, preserve the original intent, and never ' +
        'answer the prompt or add information to it. Return only the rewritten prompt with ' +
        'no preamble, commentary, or quotes around it.'
      : "You summarize the user's transcript into a compact recap. Start with a one or two " +
        'sentence TL;DR, then a short list of action items as bullets ("- "), each with its ' +
        'owner when the transcript names one. Keep the language the transcript is written ' +
        'in and stay faithful to it. Return only the recap.';
  if (typeof instruction !== 'string' || instruction.trim().length === 0) {
    return base;
  }
  return `${base}\n\nAdditional instruction from the user: ${instruction.trim()}`;
}

function sanitizeIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  /** Control characters and padding out, hard cap in — identifiers go into
   *  provider config lookups and logs, never into model prompts. */
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned.length > 0 ? cleaned.slice(0, REWRITE_MAX_ID_LENGTH) : undefined;
}

/**
 * Validates and normalizes a rewrite request body. Pure — exercised by spec.
 */
export function validateRewriteInput(body: unknown): ValidateRewriteInputResult {
  if (body == null || typeof body !== 'object') {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  const { text, mode, instruction, endpoint, model } = body as Record<string, unknown>;
  if (!isRewriteMode(mode)) {
    return { ok: false, error: "mode must be 'prompt' or 'recap'" };
  }
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, error: 'text is required' };
  }
  if (text.length > REWRITE_MAX_TEXT_LENGTH) {
    return {
      ok: false,
      error: `text must be at most ${REWRITE_MAX_TEXT_LENGTH} characters`,
    };
  }
  if (
    instruction != null &&
    (typeof instruction !== 'string' || instruction.length > REWRITE_MAX_INSTRUCTION_LENGTH)
  ) {
    return {
      ok: false,
      error: `instruction must be a string of at most ${REWRITE_MAX_INSTRUCTION_LENGTH} characters`,
    };
  }
  return {
    ok: true,
    value: {
      text,
      mode,
      ...(typeof instruction === 'string' && instruction.trim().length > 0 ? { instruction } : {}),
      ...(sanitizeIdentifier(endpoint) != null && { endpoint: sanitizeIdentifier(endpoint) }),
      ...(sanitizeIdentifier(model) != null && { model: sanitizeIdentifier(model) }),
    },
  };
}

/**
 * Picks the user's most recently used concrete endpoint+model from recent
 * conversations. `agents` conversations are skipped — their model lives on
 * the agent record, not the conversation — so the fallback lands on the most
 * recent conversation this route can actually run against.
 */
export async function resolveLatestEndpointModel(
  getRecentConversations: GetRecentConversations,
  userId: string,
): Promise<{ endpoint: string; model: string } | null> {
  const { conversations } = await getRecentConversations(userId, { limit: 10 });
  for (const convo of conversations) {
    if (
      typeof convo?.endpoint === 'string' &&
      convo.endpoint.length > 0 &&
      convo.endpoint !== EModelEndpoint.agents &&
      typeof convo.model === 'string' &&
      convo.model.length > 0
    ) {
      return { endpoint: convo.endpoint, model: convo.model };
    }
  }
  return null;
}

function extractRewriteText(response: unknown): string {
  const content = (response as { content?: unknown })?.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'string'
          ? part
          : typeof (part as { text?: unknown })?.text === 'string'
            ? (part as { text: string }).text
            : '',
      )
      .join('')
      .trim();
  }
  return '';
}

/**
 * Builds a minimal one-shot model for an arbitrary endpoint+model, following
 * the title/activity-label resolution path: provider config → initialize →
 * sanitized client options → `initializeModel`.
 */
async function buildRewriteModel(params: {
  req: ServerRequest;
  endpoint: string;
  model?: string;
  db: EndpointDbMethods;
}): Promise<{ run: { invoke: (input: unknown, config?: unknown) => Promise<unknown> } }> {
  const { req, endpoint, model, db } = params;
  const appConfig = req.config as AppConfig | undefined;
  const providerConfig = getProviderConfig({ provider: endpoint, appConfig });
  const options = await providerConfig.getOptions({
    req,
    endpoint,
    model_parameters: model != null ? { model } : {},
    db,
  });

  let provider = (options.provider ?? providerConfig.overrideProvider) as Providers;
  const llmConfig = options.llmConfig as Record<string, unknown> | undefined;
  if (endpoint === EModelEndpoint.azureOpenAI && llmConfig?.azureOpenAIApiInstanceName == null) {
    provider = Providers.OPENAI;
  } else if (endpoint === EModelEndpoint.azureOpenAI && provider !== Providers.AZURE) {
    provider = Providers.AZURE;
  }

  /** Sanitized copy, same as the title path: drop generation caps and
   *  thinking/streaming options that can fail a one-shot on a substitute
   *  model, but keep the `clientOptions` carrier (defaultHeaders, SSRF-safe
   *  fetch) by the SAME reference. */
  const rawOptions = { ...(llmConfig ?? {}) } as Record<string, unknown> & {
    maxTokens?: number;
    modelKwargs?: Record<string, unknown>;
    clientOptions?: Record<string, unknown>;
  };
  delete rawOptions.maxTokens;
  if (rawOptions.modelKwargs != null) {
    const modelKwargs = { ...rawOptions.modelKwargs };
    delete modelKwargs.max_completion_tokens;
    delete modelKwargs.max_output_tokens;
    rawOptions.modelKwargs = modelKwargs;
  }
  const clientOptionsCarrier = rawOptions.clientOptions;
  const clientOptions = Object.fromEntries(
    Object.entries(rawOptions).filter(([key]) => !omitTitleOptions.has(key)),
  ) as ClientOptions & {
    clientOptions?: Record<string, unknown>;
    configuration?: unknown;
  };
  if (clientOptionsCarrier != null) {
    clientOptions.clientOptions = clientOptionsCarrier;
  }
  if (options.configOptions != null) {
    clientOptions.configuration = options.configOptions;
  }
  clientOptions.streaming = false;

  const model_ = initializeModel({ provider, clientOptions });
  return { run: model_ as { invoke: (input: unknown, config?: unknown) => Promise<unknown> } };
}

/**
 * Handles a POST /api/rewrite request end to end and never throws: the
 * return value carries the HTTP status. Only mode, endpoint name, and
 * durations are logged — never user text.
 */
export async function runRewrite(params: {
  req: ServerRequest;
  db: EndpointDbMethods & { getRecentConversations: GetRecentConversations };
}): Promise<RewriteHttpResponse> {
  const startedAt = Date.now();
  const validation = validateRewriteInput(params.req.body);
  if (!validation.ok) {
    return { status: 400, body: { message: validation.error } };
  }
  const { text, mode, instruction } = validation.value;

  const userId = params.req.user?.id;
  if (userId == null) {
    return { status: 401, body: { message: 'Authentication required' } };
  }

  let endpoint = validation.value.endpoint;
  let model = validation.value.model;
  if (endpoint == null || model == null) {
    try {
      const latest = await resolveLatestEndpointModel(params.db.getRecentConversations, userId);
      endpoint = endpoint ?? latest?.endpoint;
      model = model ?? latest?.model;
    } catch (error) {
      logger.warn("[rewrite] Failed to resolve the user's latest endpoint", error);
    }
  }
  if (endpoint == null || model == null) {
    return {
      status: 400,
      body: {
        message: 'No endpoint/model available. Send endpoint and model or use the app first.',
      },
    };
  }

  /** Resolution/credential failures are a client or config problem (unknown
   *  endpoint name, missing/expired keys); upstream completion failures are 502. */
  let run: { invoke: (input: unknown, config?: unknown) => Promise<unknown> };
  try {
    run = (await buildRewriteModel({ req: params.req, endpoint, model, db: params.db })).run;
  } catch (error) {
    logger.error(
      `[rewrite] Failed to resolve endpoint=${endpoint}:`,
      (error as Error)?.message ?? error,
    );
    return { status: 400, body: { message: `Endpoint "${endpoint}" is not available` } };
  }

  try {
    const timeoutMs =
      parseInt(process.env.REWRITE_TIMEOUT_MS ?? '', 10) || REWRITE_DEFAULT_TIMEOUT_MS;
    const response = await run.invoke(
      [new SystemMessage(buildRewriteInstruction(mode, instruction)), new HumanMessage(text)],
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    const output = extractRewriteText(response);
    if (output.length === 0) {
      logger.warn(`[rewrite] Empty completion for mode=${mode} endpoint=${endpoint}`);
      return { status: 502, body: { message: 'The model returned an empty response' } };
    }
    logger.info(
      `[rewrite] mode=${mode} endpoint=${endpoint} completed in ${Date.now() - startedAt}ms`,
    );
    return { status: 200, body: { text: output } };
  } catch (error) {
    logger.error(
      `[rewrite] Completion failed for mode=${mode} endpoint=${endpoint}:`,
      (error as Error)?.message ?? error,
    );
    return { status: 502, body: { message: 'The rewrite request failed upstream' } };
  }
}
