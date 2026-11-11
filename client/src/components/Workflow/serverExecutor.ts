import type {
  WorkflowExecutor,
  WorkflowRunCallbacks,
  WorkflowRunHandle,
} from './api';
import type {
  StepResult,
  WorkflowStartInput,
  WorkflowStepResultStatus,
} from './types';

/**
 * Server-backed executor: persists the workflow (`POST /api/workflows`),
 * triggers a detached run (`POST /:id/runs`) and polls the run record
 * (`GET /runs/:runId`), replaying the polled snapshots into the same callbacks
 * the in-memory executor emits. Server-side pause/resume has no endpoint yet,
 * so `pause`/`resume` are honest no-ops and `cancel` both stops the polling
 * and asks the server to cancel the run.
 */

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

async function jfetch<T>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    signal,
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

interface WorkflowRecord {
  workflow?: { _id?: string; id?: string };
}

interface RunRecord {
  run: {
    runId: string;
    status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    steps?: Record<
      string,
      {
        status?: 'succeeded' | 'failed' | 'skipped';
        error?: string;
        attempts?: number;
        startedAt?: string;
        finishedAt?: string;
        durationMs?: number;
        output?: unknown;
        branch?: 'then' | 'else';
      }
    >;
    error?: string;
  };
}

export function createServerExecutor(pollIntervalMs = 1000): WorkflowExecutor {
  return {
    startRun(workflow: WorkflowStartInput, callbacks: WorkflowRunCallbacks): WorkflowRunHandle {
      const controller = new AbortController();
      let serverRunId = '';
      const seen = new Set<string>();

      const emit = (
        stepId: string,
        raw: NonNullable<RunRecord['run']['steps']>[string],
      ): void => {
        if (seen.has(stepId)) {
          return;
        }
        seen.add(stepId);
        const result: StepResult = {
          stepId,
          status: (raw.status ?? 'succeeded') as WorkflowStepResultStatus,
          output: raw.output,
          branch: raw.branch,
          error: raw.error,
          attempts: raw.attempts ?? 1,
          startedAt: raw.startedAt ?? new Date().toISOString(),
          finishedAt: raw.finishedAt ?? new Date().toISOString(),
          durationMs: raw.durationMs ?? 0,
        };
        if (result.status === 'failed') {
          callbacks.onStepFailed?.(result);
        } else if (result.status === 'skipped') {
          callbacks.onStepSkipped?.(result);
        } else {
          callbacks.onStepSucceeded?.(result);
        }
      };

      void (async () => {
        try {
          // Persist the definition. Creation is keyed by slug; a repeated name
          // collides, so fall back to listing and matching by slug.
          let workflowId: string | undefined;
          try {
            const created = await jfetch<WorkflowRecord>(`${base()}`, {
              method: 'POST',
              body: JSON.stringify({
                name: workflow.name ?? workflow.id,
                slug: workflow.id,
                definition: workflow.definition,
                enabled: true,
              }),
              signal: controller.signal,
            });
            workflowId = created.workflow?._id ?? created.workflow?.id;
          } catch {
            const list = await jfetch<{ workflows: Array<{ _id?: string; id?: string; slug?: string }> }>(
              `${base()}`,
              { signal: controller.signal },
            );
            workflowId = list.workflows?.find((w) => w.slug === workflow.id)?._id ?? list.workflows?.[0]?._id;
          }
          if (workflowId == null) {
            throw new Error('Could not resolve the workflow id on the server');
          }

          const started = await jfetch<{ runId: string }>(
            `${base()}/${encodeURIComponent(workflowId)}/runs`,
            { method: 'POST', body: JSON.stringify({}) },
            controller.signal,
          );
          serverRunId = started.runId;

          while (!controller.signal.aborted) {
            await sleep(pollIntervalMs, controller.signal);
            const { run } = await jfetch<RunRecord>(
              `${base()}/runs/${encodeURIComponent(serverRunId)}`,
              { signal: controller.signal },
            );
            for (const [stepId, raw] of Object.entries(run.steps ?? {})) {
              emit(stepId, raw);
            }
            if (run.status === 'succeeded') {
              callbacks.onRunCompleted?.();
              return;
            }
            if (run.status === 'failed') {
              callbacks.onRunFailed?.(run.error ?? 'Workflow run failed');
              return;
            }
            if (run.status === 'cancelled') {
              callbacks.onRunCancelled?.();
              return;
            }
          }
          callbacks.onRunCancelled?.('Polling stopped');
        } catch (error) {
          if (!controller.signal.aborted) {
            callbacks.onRunFailed?.(error instanceof Error ? error.message : String(error));
          }
        }
      })();

      return {
        pause(): void {
          // No server-side pause endpoint yet: the run continues server-side.
        },
        resume(): void {},
        cancel(reason?: string): void {
          controller.abort();
          if (serverRunId !== '') {
            void jfetch(
              `${base()}/runs/${encodeURIComponent(serverRunId)}/cancel`,
              { method: 'POST', body: JSON.stringify({ reason: reason ?? 'Cancelled by user' }) },
            ).catch(() => undefined);
          }
        },
      };
    },
  };
}

function base(): string {
  return '/api/workflows';
}
