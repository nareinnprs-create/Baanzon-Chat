import { forwardRef, useImperativeHandle } from 'react';
import { ListChecks } from 'lucide-react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Alert, Button, EmptyState, Progress } from '@librechat/client';
import type {
  WorkflowRunState as WorkflowRunLifecycle,
  WorkflowStartInput,
  WorkflowStep,
  WorkflowStepDisplayStatus,
} from './types';
import type { WorkflowRunControls } from './run';
import type { WorkflowRunState } from './state';
import type { WorkflowExecutor } from './api';
import {
  dispatchWorkflowAtom,
  workflowActiveRunAtom,
  workflowRunHistoryAtom,
  workflowRunsAtom,
  workflowStepsAtom,
} from './atoms';
import { WORKFLOW_LABELS as L, formatLabel } from './labels';
import { useWorkflowRun } from './run';
import { cn } from '~/utils';

/**
 * Starts and controls a run through an injected {@link WorkflowExecutor},
 * reports each step's status, overall progress and the run history, and
 * announces lifecycle changes through an `aria-live` region. The executor is a
 * prop, so the panel never reaches for a transport or a data-provider endpoint.
 */

export interface WorkflowRunPanelProps {
  executor: WorkflowExecutor;
  className?: string;
  /** Renders the panel's own start button. `false` when the editor owns it. */
  showStart?: boolean;
}

/** Imperative controls used by a host that renders the start button elsewhere. */
export interface WorkflowRunPanelHandle {
  start(workflow?: WorkflowStartInput): boolean;
}

const RUN_STATE_LABELS: Record<WorkflowRunLifecycle, string> = {
  queued: L.runStatusQueued,
  running: L.runStatusRunning,
  paused: L.runStatusPaused,
  completed: L.runStatusCompleted,
  failed: L.runStatusFailed,
  cancelled: L.runStatusCancelled,
};

const STEP_STATUS_LABELS: Record<WorkflowStepDisplayStatus, string> = {
  pending: L.runStatusPending,
  running: L.runStatusRunning,
  paused: L.runStatusPaused,
  completed: L.runStatusCompleted,
  failed: L.runStatusFailed,
  skipped: L.runStatusSkipped,
};

function statusClass(status: WorkflowStepDisplayStatus): string {
  if (status === 'completed') {
    return 'text-status-success';
  }
  if (status === 'failed') {
    return 'text-status-error';
  }
  if (status === 'running' || status === 'paused') {
    return 'text-text-primary';
  }
  return 'text-text-secondary';
}

function settledCount(run: WorkflowRunState, steps: WorkflowStep[]): number {
  return steps.filter(
    (step) => run.stepStatus[step.id] === 'completed' || run.stepStatus[step.id] === 'skipped',
  ).length;
}

function currentStepIndex(run: WorkflowRunState, steps: WorkflowStep[]): number {
  return steps.findIndex((step) => step.id === run.activeStepId);
}

function announcementFor(run: WorkflowRunState, steps: WorkflowStep[]): string {
  const total = steps.length;
  const settled = settledCount(run, steps);
  if (run.state === 'queued') {
    return L.announceQueued;
  }
  if (run.state === 'running') {
    const index = currentStepIndex(run, steps);
    const current = index >= 0 ? index + 1 : settled;
    const name = index >= 0 ? steps[index].name || steps[index].id : '';
    return formatLabel(L.announceRunning, { current, total, name });
  }
  if (run.state === 'paused') {
    const index = currentStepIndex(run, steps);
    const current = index >= 0 ? index + 1 : settled;
    return formatLabel(L.announcePaused, { current, total });
  }
  if (run.state === 'completed') {
    return formatLabel(L.announceCompleted, { completed: settled, total });
  }
  if (run.state === 'failed') {
    return formatLabel(L.announceFailed, { error: run.error ?? '' });
  }
  return L.announceCancelled;
}

const WorkflowRunPanel = forwardRef<WorkflowRunPanelHandle, WorkflowRunPanelProps>(
  function WorkflowRunPanel({ executor, className, showStart = true }, ref) {
    const controls: WorkflowRunControls = useWorkflowRun(executor);
    const steps = useAtomValue(workflowStepsAtom);
    const runs = useAtomValue(workflowRunsAtom);
    const history = useAtomValue(workflowRunHistoryAtom);
    const activeRun = useAtomValue(workflowActiveRunAtom);
    const dispatch = useSetAtom(dispatchWorkflowAtom);

    useImperativeHandle(ref, () => ({ start: controls.start }), [controls.start]);

    const isRunning = activeRun?.state === 'running' || activeRun?.state === 'queued';
    const isPaused = activeRun?.state === 'paused';
    const canCancel = isRunning || isPaused;
    const settled = activeRun == null ? 0 : settledCount(activeRun, steps);
    const announcement = activeRun == null ? '' : announcementFor(activeRun, steps);

    return (
      <section
        aria-label={L.runPanelHeading}
        data-testid="workflow-run-panel"
        className={cn('flex flex-col gap-4', className)}
      >
        <header>
          <h2 className="text-base font-semibold text-text-primary">{L.runPanelHeading}</h2>
        </header>

        <p role="status" aria-live="polite" className="sr-only" data-testid="workflow-announcement">
          {announcement}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {showStart ? (
            <Button
              type="button"
              disabled={!controls.canStart || isRunning || isPaused}
              onClick={() => {
                controls.start();
              }}
            >
              {L.runStart}
            </Button>
          ) : null}
          {isRunning ? (
            <Button type="button" variant="outline" onClick={controls.pause}>
              {L.runPause}
            </Button>
          ) : null}
          {isPaused ? (
            <Button type="button" variant="outline" onClick={controls.resume}>
              {L.runResume}
            </Button>
          ) : null}
          {canCancel ? (
            <Button type="button" variant="outline" onClick={() => controls.cancel()}>
              {L.runCancel}
            </Button>
          ) : null}
        </div>

        {controls.blocker != null ? <Alert variant="warning">{L.runInvalid}</Alert> : null}

        {activeRun == null ? (
          <EmptyState icon={ListChecks} title={L.historyEmpty} />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span
                data-testid="workflow-run-status"
                className="text-sm font-medium text-text-primary"
              >
                {RUN_STATE_LABELS[activeRun.state]}
              </span>
              <span data-testid="workflow-progress" className="text-sm text-text-secondary">
                {formatLabel(L.progressSummary, { completed: settled, total: steps.length })}
              </span>
            </div>
            <Progress value={activeRun.progress * 100} aria-label={L.progressLabel} />
            <ol className="flex flex-col gap-1">
              {steps.map((step, index) => (
                <li
                  key={index}
                  className="flex items-center justify-between gap-2 text-sm"
                  data-testid={`workflow-step-${index}`}
                >
                  <span className="text-text-primary">{step.name || step.id}</span>
                  <span
                    data-testid={`step-status-${step.id}`}
                    className={cn(
                      'font-medium',
                      statusClass(activeRun.stepStatus[step.id] ?? 'pending'),
                    )}
                  >
                    {STEP_STATUS_LABELS[activeRun.stepStatus[step.id] ?? 'pending']}
                  </span>
                </li>
              ))}
            </ol>
            {activeRun.error != null ? <Alert variant="error">{activeRun.error}</Alert> : null}
          </div>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text-primary">{L.runHistoryHeading}</h3>
          {history.length === 0 ? (
            <p className="text-sm text-text-secondary">{L.historyEmpty}</p>
          ) : (
            <ul data-testid="workflow-run-history" className="flex flex-col gap-1">
              {history
                .slice()
                .reverse()
                .map((runId) => {
                  const run = runs[runId];
                  return (
                    <li key={runId}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={formatLabel(L.selectRun, { run: runId })}
                        aria-current={activeRun?.runId === runId ? 'true' : undefined}
                        onClick={() => dispatch({ type: 'select_run', runId })}
                      >
                        <span className="text-text-primary">{runId}</span>
                        {run != null ? (
                          <span className="text-text-secondary">{RUN_STATE_LABELS[run.state]}</span>
                        ) : null}
                      </Button>
                    </li>
                  );
                })}
            </ul>
          )}
        </section>
      </section>
    );
  },
);

export default WorkflowRunPanel;
