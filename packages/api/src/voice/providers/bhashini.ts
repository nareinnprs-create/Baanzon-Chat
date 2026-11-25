/**
 * Bhashini (ULCA) adapters for ASR and TTS.
 *
 * The only stack we found that covers exactly the 22 scheduled languages: MMS
 * has no TTS checkpoint for nine of them (ne, sa, kok, ks, sd, doi, mni, brx,
 * sat) and Cloudflare's Nova-3 proxy forces Indic audio into Hindi script.
 *
 * Every Bhashini request is a pair: a pipeline-config call returns the
 * inference endpoint, its key and the serviceId per task; the inference call
 * sends the audio or text to that endpoint. The config is cached per
 * language+task set because it changes only when the platform redeploys.
 *
 * Credentials come from the operator (`BHASHINI_USER_ID`,
 * `BHASHINI_ULCA_API_KEY`, `BHASHINI_PIPELINE_ID`); nothing here reads env.
 */

const ULCA_BASE = 'https://meity-auth.ulcacontrib.org';
const PIPELINE_PATH = '/ulca/apis/v0/model/getModelsPipeline';

export type BhashiniTask = 'asr' | 'tts';

export interface BhashiniCredentials {
  userId: string;
  ulcaApiKey: string;
  pipelineId: string;
}

export interface BhashiniPipeline {
  callbackUrl: string;
  authName: string;
  authValue: string;
  serviceIds: Partial<Record<BhashiniTask, string>>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Response parser, exported for specs. */
export function parsePipelineResponse(payload: unknown): BhashiniPipeline | null {
  const body = payload as {
    pipelineInferenceAPIEndPoint?: {
      callbackUrl?: unknown;
      inferenceApiKey?: { name?: unknown; value?: unknown };
    };
    pipelineResponseConfig?: Array<{ taskType?: unknown; config?: Array<{ serviceId?: unknown }> }>;
  };
  const endpoint = body?.pipelineInferenceAPIEndPoint;
  const callbackUrl = typeof endpoint?.callbackUrl === 'string' ? endpoint.callbackUrl : '';
  const authName =
    typeof endpoint?.inferenceApiKey?.name === 'string' ? endpoint.inferenceApiKey.name : '';
  const authValue =
    typeof endpoint?.inferenceApiKey?.value === 'string' ? endpoint.inferenceApiKey.value : '';
  if (!callbackUrl || !authValue) {
    return null;
  }
  const serviceIds: Partial<Record<BhashiniTask, string>> = {};
  for (const entry of body?.pipelineResponseConfig ?? []) {
    const task = entry?.taskType;
    const serviceId = entry?.config?.[0]?.serviceId;
    if ((task === 'asr' || task === 'tts') && typeof serviceId === 'string') {
      serviceIds[task] = serviceId;
    }
  }
  return { callbackUrl, authName: authName || 'Authorization', authValue, serviceIds };
}

/** Resolves the inference endpoint and service ids for one language. */
export async function resolveBhashiniPipeline(opts: {
  credentials: BhashiniCredentials;
  tasks: BhashiniTask[];
  language: string;
  fetchImpl?: FetchLike;
}): Promise<BhashiniPipeline | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  const body = {
    pipelineTasks: opts.tasks.map((taskType) => ({
      taskType,
      config: { language: { sourceLanguage: opts.language } },
    })),
    pipelineRequestConfig: { pipelineId: opts.credentials.pipelineId },
  };
  try {
    const response = await doFetch(`${ULCA_BASE}${PIPELINE_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        userID: opts.credentials.userId,
        ulcaApiKey: opts.credentials.ulcaApiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      return null;
    }
    return parsePipelineResponse(await response.json());
  } catch {
    return null;
  }
}

/** Transcript from an inference response, exported for specs. */
export function parseAsrResponse(payload: unknown): string | null {
  const body = payload as {
    pipelineResponse?: Array<{ taskType?: unknown; output?: Array<{ source?: unknown }> }>;
  };
  for (const entry of body?.pipelineResponse ?? []) {
    if (entry?.taskType !== 'asr') {
      continue;
    }
    const source = entry.output?.[0]?.source;
    if (typeof source === 'string') {
      return source.trim();
    }
  }
  return null;
}

/** WAV bytes from an inference response, exported for specs. */
export function parseTtsResponse(payload: unknown): Buffer | null {
  const body = payload as {
    pipelineResponse?: Array<{ taskType?: unknown; audio?: Array<{ audioContent?: unknown }> }>;
  };
  for (const entry of body?.pipelineResponse ?? []) {
    if (entry?.taskType !== 'tts') {
      continue;
    }
    const encoded = entry.audio?.[0]?.audioContent;
    if (typeof encoded === 'string' && encoded.length > 0) {
      return Buffer.from(encoded, 'base64');
    }
  }
  return null;
}

/** Speech in: WAV bytes -> transcript in the requested language. */
export async function bhashiniAsr(opts: {
  pipeline: BhashiniPipeline;
  audio: Buffer;
  language: string;
  sampleRate?: number;
  fetchImpl?: FetchLike;
}): Promise<string | null> {
  const serviceId = opts.pipeline.serviceIds.asr;
  if (!serviceId) {
    return null;
  }
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const response = await doFetch(opts.pipeline.callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [opts.pipeline.authName]: opts.pipeline.authValue,
      },
      body: JSON.stringify({
        pipelineTasks: [
          {
            taskType: 'asr',
            config: {
              language: { sourceLanguage: opts.language },
              serviceId,
              audioFormat: 'wav',
              samplingRate: opts.sampleRate ?? 16000,
            },
          },
        ],
        inputData: { audio: [{ audioContent: opts.audio.toString('base64') }] },
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) {
      return null;
    }
    return parseAsrResponse(await response.json());
  } catch {
    return null;
  }
}

/** Speech out: text -> WAV bytes in the requested language. */
export async function bhashiniTts(opts: {
  pipeline: BhashiniPipeline;
  text: string;
  language: string;
  gender?: 'female' | 'male';
  sampleRate?: number;
  fetchImpl?: FetchLike;
}): Promise<Buffer | null> {
  const serviceId = opts.pipeline.serviceIds.tts;
  if (!serviceId) {
    return null;
  }
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const response = await doFetch(opts.pipeline.callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [opts.pipeline.authName]: opts.pipeline.authValue,
      },
      body: JSON.stringify({
        pipelineTasks: [
          {
            taskType: 'tts',
            config: {
              language: { sourceLanguage: opts.language },
              serviceId,
              gender: opts.gender ?? 'female',
              samplingRate: opts.sampleRate ?? 22050,
            },
          },
        ],
        inputData: { input: [{ source: opts.text }] },
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) {
      return null;
    }
    return parseTtsResponse(await response.json());
  } catch {
    return null;
  }
}
