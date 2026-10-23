import type {
  TDeepResearchEvent,
  TDeepResearchPlan,
  TDeepResearchReport,
  TDeepResearchStep,
  TDeepResearchStepResult,
} from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

/**
 * One source a search provider returns; the runner turns it into a citation.
 */
export interface DeepResearchSearchResult {
  title: string;
  url?: string;
  snippet?: string;
}

/**
 * The backend search seam. A real implementation wraps an existing web-search
 * tool or provider SDK; the default wiring ships none, and the runner degrades
 * gracefully (an explanatory event instead of a search) when it is absent.
 */
export interface DeepResearchSearchProvider {
  search(query: string, signal: AbortSignal): Promise<DeepResearchSearchResult[]>;
}

/**
 * The LLM text-completion seam used to synthesize step findings. Absent means
 * the runner assembles a deterministic summary from the collected sources.
 */
export interface DeepResearchLlmCaller {
  complete(prompt: string, signal: AbortSignal): Promise<string>;
}

/** `POST /plan` input after validation. */
export interface DeepResearchPlanInput {
  topic: string;
}

/** `GET /run` input after validation: the topic plus the step being executed. */
export interface DeepResearchRunInput {
  topic: string;
  step: Pick<TDeepResearchStep, 'id' | 'title' | 'query'>;
}

export type DeepResearchEventEmitter = (event: DeepResearchEmittedEvent) => void;

/**
 * The payload shape the runner emits: everything but `seq`, which the
 * transport stamps with the stream's monotonically increasing counter.
 */
export type DeepResearchEmittedEvent = Omit<TDeepResearchEvent, 'seq'>;

/** The executor the handlers delegate to. */
export interface DeepResearchRunner {
  createPlan(input: DeepResearchPlanInput, signal: AbortSignal): Promise<TDeepResearchPlan>;
  runStep(
    input: DeepResearchRunInput,
    signal: AbortSignal,
    emit: DeepResearchEventEmitter,
  ): Promise<TDeepResearchStepResult>;
  buildReport(plan: TDeepResearchPlan, signal: AbortSignal): Promise<TDeepResearchReport>;
}

export interface DeepResearchRunnerDeps {
  searchProvider?: DeepResearchSearchProvider;
  llm?: DeepResearchLlmCaller;
}

export interface DeepResearchHandlers {
  /** `POST /plan`: builds the initial, editable plan for a topic. */
  createPlan: (req: ServerRequest, res: Response) => Promise<Response>;
  /** `GET /run`: streams one step's execution over SSE. */
  runStep: (req: ServerRequest, res: Response) => Promise<Response | void>;
  /** `POST /report`: compiles the finished plan into a report. */
  buildReport: (req: ServerRequest, res: Response) => Promise<Response>;
}

export interface DeepResearchHandlersDeps {
  runner: DeepResearchRunner;
}

/**
 * Raised by an injected provider that cannot serve a run at all (miswired, no
 * credentials, unsupported adapter shape). The handlers map it to 422 instead
 * of an opaque 500 so the client can tell "this backend cannot research" apart
 * from a transient failure. Existing providers that merely have nothing to
 * search degrade gracefully inside the runner instead of raising this.
 */
export class DeepResearchUnsupportedError extends Error {
  constructor(message = 'Deep Research provider is not supported or not configured') {
    super(message);
    this.name = 'DeepResearchUnsupportedError';
  }
}
