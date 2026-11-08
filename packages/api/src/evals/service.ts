import type { CreateEvalRunInput, IEvalRun } from '@librechat/data-schemas';
import type { EvalCaseResult } from './scoring';
import { scoreCaseResults } from './scoring';
import type { EvalService, EvalServiceDeps, EvalTargetInvokers } from './types';

/**
 * The wiring-provided stub invoker (A7.5): no clean agent/workflow transport is
 * injectable yet - `executeAgentRun` and the trigger actor are transport-coupled
 * (envelopes, enrollment, live connections), so routes/evals.js wires this and
 * every scored run fails with a `no transport` error until a real invoker lands.
 */
export function createNoTransportEvalInvokers(
  reason = 'no transport: no agent/workflow invoker is wired for evals',
): EvalTargetInvokers {
  const fail = async () => {
    throw new Error(reason);
  };
  return {
    invokeAgent: fail,
    invokeWorkflow: fail,
  };
}

/**
 * The eval-run lifecycle driver. Store and transports arrive injected; the
 * service owns only orchestration: create (`queued`) -> `running` -> score ->
 * terminal `passed`/`failed` with the scores JSON persisted.
 */
export function createEvalService(deps: EvalServiceDeps): EvalService {
  const { store } = deps;

  async function startRun(input: CreateEvalRunInput): Promise<IEvalRun> {
    const created = await store.createEvalRun(input);
    const runId = String(created._id);
    const dataset = created.dataset;
    const cases = dataset?.cases ?? [];

    if (cases.length === 0) {
      const failed = await store.updateEvalRunResult({
        runId,
        status: 'failed',
        error: 'Empty dataset: the run has no cases to evaluate',
      });
      return failed ?? created;
    }

    const kind = created.agentId != null ? 'agent' : 'workflow';
    const invokers = deps.invokers;
    if (
      !invokers ||
      (kind === 'agent' && !invokers.invokeAgent) ||
      (kind === 'workflow' && !invokers.invokeWorkflow)
    ) {
      const failed = await store.updateEvalRunResult({
        runId,
        status: 'failed',
        error: `no transport: no ${kind} invoker is wired for evals`,
      });
      return failed ?? created;
    }

    await store.updateEvalRunResult({ runId, status: 'running' });

    const invoke = (input: string): Promise<{ output: string }> =>
      kind === 'agent'
        ? invokers.invokeAgent({ agentId: created.agentId as string, input })
        : invokers.invokeWorkflow({ workflowId: created.workflowId as string, input });

    const results: EvalCaseResult[] = [];
    for (const evalCase of cases) {
      try {
        const { output } = await invoke(evalCase.input);
        results.push({ evalCase, output });
      } catch (error) {
        results.push({
          evalCase,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const verdict = scoreCaseResults(results);
    const finished = await store.updateEvalRunResult({
      runId,
      status: verdict.status,
      scores: verdict.scores,
      error: verdict.status === 'failed' ? 'One or more eval cases failed' : undefined,
    });
    return finished ?? created;
  }

  async function listRuns(params?: Parameters<typeof store.listEvalRuns>[0]) {
    return await store.listEvalRuns(params);
  }

  async function getRun(id: string) {
    return await store.getEvalRunById(id);
  }

  return { startRun, listRuns, getRun };
}
