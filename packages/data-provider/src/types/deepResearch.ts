/**
 * Wire contract for the Deep Research backend (packages/api/src/deepResearch):
 * the SSE run stream, the plan and report payloads, and the shared levers.
 * These are the single source of truth; the client feature maps them onto its
 * view types and the backend takes and returns them verbatim.
 */

/** Lifecycle of the flow as reported on the wire (see the client's view types). */
export type TDeepResearchStatus =
  | 'planning'
  | 'plan_ready'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Broad category of a streamed transition. */
export type TDeepResearchEventKind = 'status' | 'step' | 'progress' | 'error';

/**
 * One streamed event. `code` is a stable identifier (`ready`, `step_completed`,
 * `step_failed`, `search_unsupported`, …) the client translates into copy;
 * `progress` is a normalised 0..1 value and is present on `progress` events.
 */
export type TDeepResearchEvent = {
  seq: number;
  kind: TDeepResearchEventKind;
  /** The flow status at the moment the event was emitted. */
  status: TDeepResearchStatus;
  code: string;
  stepId?: string;
  detail?: string;
  progress?: number;
};

/** A source attached to a report section or listed under the report. */
export type TDeepResearchCitation = {
  id: string;
  title: string;
  url?: string;
  snippet?: string;
};

/** `POST /api/deep-research/report` step input; `citations` ride along when the run produced them. */
export type TDeepResearchStep = {
  id: string;
  title: string;
  query: string;
  detail?: string;
  error?: string;
  citations?: TDeepResearchCitation[];
};

export type TDeepResearchPlanInput = {
  id?: string;
  topic: string;
  steps: TDeepResearchStep[];
};

export type TDeepResearchSection = {
  id: string;
  heading: string;
  body: string;
  citations: TDeepResearchCitation[];
};

export type TDeepResearchReport = {
  planId: string;
  title: string;
  summary: string;
  sections: TDeepResearchSection[];
  citations: TDeepResearchCitation[];
  generatedAt: string;
};

export type TDeepResearchPlan = {
  id: string;
  topic: string;
  steps: TDeepResearchStep[];
};

/** What a completed step reports back; merged into the plan step by the client. */
export type TDeepResearchStepResult = {
  detail?: string;
  citations?: TDeepResearchCitation[];
};

/** `POST /api/deep-research/plan` body. */
export type TDeepResearchPlanRequest = {
  topic: string;
};

/** `GET /api/deep-research/run` query parameters (one step's execution over SSE). */
export type TDeepResearchStepRunParams = {
  topic: string;
  stepId: string;
  title: string;
  query: string;
};

/** `POST /api/deep-research/report` body. */
export type TDeepResearchReportRequest = {
  plan: TDeepResearchPlanInput;
};

/**
 * Error/response body code sent when the backend has the feature switched off
 * or is otherwise not serving Deep Research; the client falls back to its
 * in-memory executor when it sees it.
 */
export const DEEP_RESEARCH_UNAVAILABLE_CODE = 'deep_research_unavailable';

/** SSE event name carrying every step-run transition; each payload is a `TDeepResearchEvent`. */
export const DEEP_RESEARCH_STREAM_EVENT = 'research';

/** Server-resolved feature lever (`deepResearch.enabled` plus future levers). */
export type TDeepResearchSettings = {
  enabled: boolean;
};
