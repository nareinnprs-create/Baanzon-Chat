/**
 * Shared types for the Deep Research client flow.
 *
 * The flow is deliberately backend-agnostic: a `DeepResearchExecutor`
 * (`./api`) produces plans, step results and reports, while these types are the
 * only vocabulary the view and the state machine share with it.
 */

/** Lifecycle of one plan step. Only `running`, `paused` and `pending` are mutable. */
export type StepStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'skipped';

/** A single editable research step. */
export type ResearchStep = {
  id: string;
  /** User-facing title; blank titles are rejected by plan validation. */
  title: string;
  /** The question or instruction handed to the executor. */
  query: string;
  status: StepStatus;
  /** Normalised progress in the range 0..1. */
  progress: number;
  /** Free-form status line reported while the step runs. */
  detail?: string;
  /** Failure text when `status` is `failed`. */
  error?: string;
};

/** The editable list of steps and the topic they research. */
export type ResearchPlan = {
  id: string;
  topic: string;
  steps: ResearchStep[];
};

/**
 * Lifecycle of the whole flow:
 * `idle -> planning -> plan_ready -> running -> (paused <-> running) -> completed | failed | cancelled`.
 */
export type ResearchStatus =
  | 'idle'
  | 'planning'
  | 'plan_ready'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** A source attached to a report section or listed under the report. */
export type ResearchCitation = {
  id: string;
  title: string;
  url?: string;
  snippet?: string;
};

/** One report section, rendered in order. */
export type ResearchSection = {
  id: string;
  heading: string;
  body: string;
  citations: ResearchCitation[];
};

/** The finished research report. */
export type ResearchReport = {
  planId: string;
  title: string;
  summary: string;
  sections: ResearchSection[];
  citations: ResearchCitation[];
  generatedAt: string;
};

/** Broad category of a logged transition, so the view can style or filter it. */
export type ResearchEventKind = 'status' | 'step' | 'progress' | 'error' | 'report';

/**
 * One entry in the flow's append-only event log.
 *
 * Events carry a stable `code` rather than a localized string so the state
 * machine stays pure and the view owns all copy. `seq` is a monotonically
 * increasing counter; no wall-clock timestamp is recorded, which keeps every
 * transition deterministic and trivially testable.
 */
export type ResearchEvent = {
  id: string;
  seq: number;
  kind: ResearchEventKind;
  /** The flow status immediately after the transition. */
  status: ResearchStatus;
  code: string;
  stepId?: string;
  detail?: string;
};
