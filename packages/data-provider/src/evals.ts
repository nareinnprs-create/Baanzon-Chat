/**
 * Eval-run contracts (blueprint §60, B22). The dataset travels as JSON on the
 * run, and scoring is per-case assertion callbacks (`exact` / `contains` /
 * `regex`) resolved against the invoked output. Kept here - not in
 * `@librechat/data-schemas` - so the client carries no data-schemas dependency.
 */

/** The assertion kinds the pure scorer understands. A new kind is a code change here. */
export const EVAL_ASSERTION_TYPES = ['exact', 'contains', 'regex'] as const;

export type TEvalAssertionType = (typeof EVAL_ASSERTION_TYPES)[number];

/**
 * One per-case assertion. `caseSensitive` defaults to `true`; `false` relaxes
 * `exact`/`contains` to a case-insensitive compare and adds the `i` flag to
 * `regex`. An invalid `regex` source fails its case instead of throwing.
 */
export type TEvalAssertion = {
  type: TEvalAssertionType;
  value: string;
  caseSensitive?: boolean;
};

/** One dataset case: a single input plus the assertions its output must satisfy. */
export type TEvalCase = {
  name: string;
  input: string;
  expected: string;
  assertions: TEvalAssertion[];
};

/** The dataset stored as JSON on the run. An empty `cases` array fails the run. */
export type TEvalDataset = {
  name?: string;
  cases: TEvalCase[];
};

/** Run lifecycle: `queued` (created) -> `running` -> `passed` | `failed`. */
export const EVAL_RUN_STATUSES = ['queued', 'running', 'passed', 'failed'] as const;

export type TEvalRunStatus = (typeof EVAL_RUN_STATUSES)[number];

/** Per-case scoring result stored in the run's `scores` JSON array. */
export type TEvalCaseScore = {
  name: string;
  passed: boolean;
  /** Human-readable failure reasons; empty when the case passed. */
  failures: string[];
};

/** A stored eval run, as the API returns it (plain object, ISO date strings). */
export type TEvalRun = {
  id: string;
  agentId: string | null;
  workflowId: string | null;
  datasetName: string;
  status: TEvalRunStatus;
  dataset: TEvalDataset | null;
  scores: TEvalCaseScore[] | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** `POST /api/evals/runs` body - create and immediately start one run. */
export type TCreateEvalRunRequest = {
  agentId?: string;
  workflowId?: string;
  datasetName: string;
  dataset: TEvalDataset;
};

/** `GET /api/evals/runs` response. */
export type TEvalRunListResponse = {
  runs: TEvalRun[];
};

/** `GET /api/evals/runs` query params. Exactly one of agentId/workflowId in practice. */
export type TEvalRunListParams = {
  agentId?: string;
  workflowId?: string;
  limit?: number;
};
