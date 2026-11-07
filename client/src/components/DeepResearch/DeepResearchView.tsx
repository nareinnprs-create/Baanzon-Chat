import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { Ban, Microscope, TriangleAlert } from 'lucide-react';
import { Button, EmptyState, Input, Label, Spinner } from '@librechat/client';
import type { DeepResearchExecutor } from './api';
import { deepResearchStateAtom, dispatchDeepResearchAtom } from './atoms';
import { RESEARCH_ERROR_NO_PLAN, RESEARCH_ERROR_NO_STEPS } from './state';
import PlanEditor, { isPlanValid } from './PlanEditor';
import ProgressTimeline from './ProgressTimeline';
import { DEEP_RESEARCH_LABELS } from './labels';
import ReportView from './ReportView';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type Localize = ReturnType<typeof useLocalize>;

export type DeepResearchViewProps = {
  /**
   * The research backend. The view is written entirely against this interface
   * and never imports a transport or a query hook.
   */
  executor: DeepResearchExecutor;
  /** Initial value for the topic field. */
  initialTopic?: string;
  className?: string;
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error) {
    return error;
  }
  return fallback;
}

/** Maps the machine's symbolic error codes to copy; everything else passes through. */
function resolveErrorMessage(error: string, localize: Localize): string {
  if (error === RESEARCH_ERROR_NO_STEPS) {
    return localize(DEEP_RESEARCH_LABELS.noStepsError);
  }
  if (error === RESEARCH_ERROR_NO_PLAN) {
    return localize(DEEP_RESEARCH_LABELS.noPlanError);
  }
  return error;
}

/**
 * The Deep Research flow: generate a plan, edit it, run it with live progress,
 * pause/resume/cancel, and read the report. All flow state lives in the
 * feature's Jotai atoms; this component drives the async executor against that
 * state and renders one explicit branch per lifecycle status.
 */
export default function DeepResearchView({
  executor,
  initialTopic = '',
  className,
}: DeepResearchViewProps) {
  const localize = useLocalize();
  const state = useAtomValue(deepResearchStateAtom);
  const dispatch = useSetAtom(dispatchDeepResearchAtom);
  const store = useStore();
  const [topic, setTopic] = useState(initialTopic);
  const planControllerRef = useRef<AbortController | null>(null);

  /** Latest executor without making the run effect restart when its identity changes. */
  const executorRef = useRef(executor);
  executorRef.current = executor;

  const { status, plan, report, error, activeStepId } = state;

  useEffect(() => {
    return () => {
      planControllerRef.current?.abort();
    };
  }, []);

  const handleGeneratePlan = useCallback(() => {
    const trimmed = topic.trim();
    if (!trimmed) {
      return;
    }
    dispatch({ type: 'start_planning', topic: trimmed });
    planControllerRef.current?.abort();
    const controller = new AbortController();
    planControllerRef.current = controller;
    executorRef.current
      .createPlan(trimmed, controller.signal)
      .then((nextPlan) => {
        if (controller.signal.aborted) {
          return;
        }
        dispatch({ type: 'plan_ready', plan: nextPlan });
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        dispatch({
          type: 'fail',
          error: toErrorMessage(caught, localize(DEEP_RESEARCH_LABELS.failureDescription)),
        });
      });
  }, [dispatch, localize, topic]);

  /**
   * The run engine. It re-runs whenever the flow is `running` and the active
   * step changes: it runs that step, and once no step is active it compiles the
   * report. Pausing, cancelling and unmounting abort the in-flight step through
   * the effect's cleanup.
   */
  useEffect(() => {
    if (status !== 'running') {
      return undefined;
    }
    const current = store.get(deepResearchStateAtom);
    const currentPlan = current.plan;
    if (!currentPlan) {
      return undefined;
    }
    const controller = new AbortController();
    let live = true;
    const activeStep = currentPlan.steps.find((step) => step.id === current.activeStepId);

    if (!activeStep) {
      executorRef.current
        .buildReport(currentPlan, controller.signal)
        .then((nextReport) => {
          if (live) {
            dispatch({ type: 'complete', report: nextReport });
          }
        })
        .catch((caught: unknown) => {
          if (live) {
            dispatch({
              type: 'fail',
              error: toErrorMessage(caught, localize(DEEP_RESEARCH_LABELS.failureDescription)),
            });
          }
        });
      return () => {
        live = false;
        controller.abort();
      };
    }

    const step = activeStep;
    executorRef.current
      .runStep(step, controller.signal, (progress, detail) => {
        if (live) {
          dispatch({ type: 'step_progress', stepId: step.id, progress, detail });
        }
      })
      .then((result) => {
        if (live) {
          dispatch({ type: 'step_completed', stepId: step.id, detail: result.detail });
        }
      })
      .catch((caught: unknown) => {
        if (!live || controller.signal.aborted) {
          return;
        }
        dispatch({
          type: 'step_failed',
          stepId: step.id,
          error: toErrorMessage(caught, localize(DEEP_RESEARCH_LABELS.failureDescription)),
        });
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [activeStepId, dispatch, localize, status, store]);

  const topicFieldId = 'deep-research-topic';
  const planIsValid = plan ? isPlanValid(plan) : false;

  return (
    <section
      aria-label={localize(DEEP_RESEARCH_LABELS.featureTitle)}
      className={cn('flex h-full min-h-0 flex-col gap-4 overflow-auto p-4', className)}
    >
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
          <Microscope className="size-4 text-text-secondary" aria-hidden="true" />
          {localize(DEEP_RESEARCH_LABELS.featureTitle)}
        </h2>
        <p className="text-sm text-text-secondary">
          {localize(DEEP_RESEARCH_LABELS.featureDescription)}
        </p>
      </header>

      {status === 'idle' ? (
        <form
          className="flex flex-col gap-3 rounded-xl border border-border-light bg-surface-secondary p-4"
          onSubmit={(event) => {
            event.preventDefault();
            handleGeneratePlan();
          }}
        >
          <Label htmlFor={topicFieldId}>{localize(DEEP_RESEARCH_LABELS.topicLabel)}</Label>
          <Input
            id={topicFieldId}
            value={topic}
            placeholder={localize(DEEP_RESEARCH_LABELS.topicPlaceholder)}
            onChange={(event) => setTopic(event.target.value)}
          />
          <div>
            <Button type="submit" variant="default" size="sm" disabled={topic.trim().length === 0}>
              {localize(DEEP_RESEARCH_LABELS.generatePlan)}
            </Button>
          </div>
        </form>
      ) : null}

      {status === 'planning' ? (
        <div role="status" className="flex items-center gap-2 text-sm text-text-secondary">
          <Spinner className="size-4" aria-hidden="true" />
          {localize(DEEP_RESEARCH_LABELS.planning)}
        </div>
      ) : null}

      {status === 'plan_ready' && plan ? (
        <div className="flex flex-col gap-3">
          <PlanEditor
            plan={plan}
            onTopicChange={(next) => dispatch({ type: 'update_topic', topic: next })}
            onAddStep={() => dispatch({ type: 'add_step' })}
            onRemoveStep={(stepId) => dispatch({ type: 'remove_step', stepId })}
            onRenameStep={(stepId, title) => dispatch({ type: 'rename_step', stepId, title })}
            onMoveStep={(stepId, direction) => dispatch({ type: 'move_step', stepId, direction })}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={!planIsValid}
              onClick={() => dispatch({ type: 'run' })}
            >
              {localize(DEEP_RESEARCH_LABELS.runPlan)}
            </Button>
            {!planIsValid ? (
              <p className="text-xs text-text-destructive">
                {localize(DEEP_RESEARCH_LABELS.planInvalid)}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {(status === 'running' || status === 'paused') && plan ? (
        <ProgressTimeline
          plan={plan}
          status={status}
          activeStepId={activeStepId}
          onPause={() => dispatch({ type: 'pause' })}
          onResume={() => dispatch({ type: 'resume' })}
          onCancel={() => dispatch({ type: 'cancel' })}
        />
      ) : null}

      {status === 'completed' && report ? (
        <ReportView
          report={report}
          onRetry={() => dispatch({ type: 'retry' })}
          onCopy={() => undefined}
        />
      ) : null}

      {status === 'failed' ? (
        <div role="alert">
          <EmptyState
            icon={TriangleAlert}
            title={localize(DEEP_RESEARCH_LABELS.failureTitle)}
            description={
              error
                ? resolveErrorMessage(error, localize)
                : localize(DEEP_RESEARCH_LABELS.failureDescription)
            }
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => dispatch({ type: 'retry' })}
              >
                {localize(DEEP_RESEARCH_LABELS.retry)}
              </Button>
            }
          />
        </div>
      ) : null}

      {status === 'cancelled' ? (
        <div role="status">
          <EmptyState
            icon={Ban}
            title={localize(DEEP_RESEARCH_LABELS.cancelledTitle)}
            description={localize(DEEP_RESEARCH_LABELS.cancelledDescription)}
            action={
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => dispatch({ type: 'retry' })}
                >
                  {localize(DEEP_RESEARCH_LABELS.retry)}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => dispatch({ type: 'reset' })}
                >
                  {localize(DEEP_RESEARCH_LABELS.startOver)}
                </Button>
              </div>
            }
          />
        </div>
      ) : null}
    </section>
  );
}
