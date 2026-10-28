import type { Response } from 'express';
import type {
  CreateEvalRunInput,
  IEvalRun,
  ListEvalRunsParams,
  UpdateEvalRunResultInput,
} from '@librechat/data-schemas';
import type { ServerRequest } from '~/types/http';

/** One DI-injected transport invocation the eval runner calls per case. */
export type EvalTargetOutput = {
  output: string;
};

/**
 * The transports the runner invokes. The wiring (route file) supplies these -
 * the eval module never reaches for agent internals itself. Until a real
 * agent/workflow transport is cleanly injectable, `api/server/routes/evals.js`
 * wires `createNoTransportEvalInvokers()`, which fails runs with `no transport`.
 */
export interface EvalTargetInvokers {
  invokeAgent(params: { agentId: string; input: string }): Promise<EvalTargetOutput>;
  invokeWorkflow(params: { workflowId: string; input: string }): Promise<EvalTargetOutput>;
}

/** The data-schemas eval-run methods the service depends on. */
export interface EvalRunStore {
  createEvalRun(input: CreateEvalRunInput): Promise<IEvalRun>;
  updateEvalRunResult(input: UpdateEvalRunResultInput): Promise<IEvalRun | null>;
  getEvalRunById(id: string): Promise<IEvalRun | null>;
  listEvalRuns(params?: ListEvalRunsParams): Promise<IEvalRun[]>;
}

export interface EvalServiceDeps {
  store: EvalRunStore;
  /** Optional until a transport exists; a missing invoker fails the run. */
  invokers?: EvalTargetInvokers | null;
}

export interface EvalService {
  /** Creates the run, drives it through the lifecycle, stores scores. */
  startRun(input: CreateEvalRunInput): Promise<IEvalRun>;
  listRuns(params?: ListEvalRunsParams): Promise<IEvalRun[]>;
  getRun(id: string): Promise<IEvalRun | null>;
}

export interface EvalHandlersDeps {
  service: EvalService;
}

export interface EvalHandlers {
  /** `POST /api/evals/runs`: validate, create, run, return the finished run. */
  createRun: (req: ServerRequest, res: Response) => Promise<Response>;
  /** `GET /api/evals/runs`: capped list, optionally per agent/workflow. */
  listRuns: (req: ServerRequest, res: Response) => Promise<Response>;
  /** `GET /api/evals/runs/:id`: one run or 404. */
  getRun: (req: ServerRequest, res: Response) => Promise<Response>;
}

/** The authenticated request context handlers resolve once per call. */
export interface EvalHandlerActor {
  userId: string;
}
