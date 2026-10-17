import { Button, Chip, Progress } from '@librechat/client';
import { AlertTriangle, Check, Circle, Loader2, Pause, Play, X } from 'lucide-react';
import type { ResearchPlan, ResearchStatus, StepStatus } from './types';
import { DEEP_RESEARCH_LABELS, type DeepResearchLabelKey } from './labels';
import { useLocalize } from '~/hooks';

type Localize = ReturnType<typeof useLocalize>;

export type ProgressTimelineProps = {
  plan: ResearchPlan;
  status: ResearchStatus;
  activeStepId?: string | null;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
};

type ChipTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

const STEP_TONE: Record<StepStatus, ChipTone> = {
  pending: 'neutral',
  running: 'info',
  paused: 'warning',
  completed: 'success',
  failed: 'error',
  skipped: 'neutral',
};

const STEP_LABEL: Record<StepStatus, DeepResearchLabelKey> = {
  pending: 'stepStatusPending',
  running: 'stepStatusRunning',
  paused: 'stepStatusPaused',
  completed: 'stepStatusCompleted',
  failed: 'stepStatusFailed',
  skipped: 'stepStatusSkipped',
};

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'completed') {
    return <Check className="size-4 text-status-success" aria-hidden="true" />;
  }
  if (status === 'failed') {
    return <AlertTriangle className="size-4 text-status-error" aria-hidden="true" />;
  }
  if (status === 'paused') {
    return <Pause className="size-4 text-status-warning" aria-hidden="true" />;
  }
  if (status === 'running') {
    return <Loader2 className="size-4 animate-spin text-status-info" aria-hidden="true" />;
  }
  return <Circle className="size-4 text-text-tertiary" aria-hidden="true" />;
}

/**
 * Builds the sentence the polite live region announces. It is derived from the
 * same state the timeline renders, so a screen reader hears the step and its
 * progress at the moment sighted users see them change.
 */
function buildAnnouncement(
  plan: ResearchPlan,
  status: ResearchStatus,
  activeStepId: string | null,
  localize: Localize,
): string {
  const total = plan.steps.length;
  const completed = plan.steps.filter((step) => step.status === 'completed').length;
  if (status === 'completed') {
    return localize(DEEP_RESEARCH_LABELS.completedAnnouncement, { completed, total });
  }
  if (status === 'cancelled') {
    return localize(DEEP_RESEARCH_LABELS.cancelledAnnouncement);
  }
  const index = plan.steps.findIndex((step) => step.id === activeStepId);
  const step = index >= 0 ? plan.steps[index] : undefined;
  if (status === 'paused' && step) {
    return localize(DEEP_RESEARCH_LABELS.pausedAnnouncement, {
      current: index + 1,
      total,
      title: step.title,
    });
  }
  if (status === 'running' && step) {
    return localize(DEEP_RESEARCH_LABELS.runningAnnouncement, {
      current: index + 1,
      total,
      title: step.title,
      progress: Math.round(step.progress * 100),
    });
  }
  return localize(DEEP_RESEARCH_LABELS.progressSummary, { completed, total });
}

/**
 * Ordered steps with per-step status and live progress, plus the pause, resume
 * and cancel controls. The only `aria-live` region is the status sentence;
 * progress bars carry their own value text so a screen reader can read one step
 * on demand without being interrupted on every tick.
 */
export default function ProgressTimeline({
  plan,
  status,
  activeStepId = null,
  onPause,
  onResume,
  onCancel,
}: ProgressTimelineProps) {
  const localize = useLocalize();
  const completed = plan.steps.filter((step) => step.status === 'completed').length;
  const total = plan.steps.length;
  const announcement = buildAnnouncement(plan, status, activeStepId, localize);

  return (
    <div className="flex flex-col gap-3" data-testid="deep-research-progress">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">
          {localize(DEEP_RESEARCH_LABELS.progressHeading)}
        </h3>
        <p className="text-xs tabular-nums text-text-secondary">
          {localize(DEEP_RESEARCH_LABELS.progressSummary, { completed, total })}
        </p>
      </div>

      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>

      <ol
        aria-label={localize(DEEP_RESEARCH_LABELS.progressHeading)}
        className="flex list-none flex-col gap-2 p-0"
      >
        {plan.steps.map((step, index) => {
          const isActive = step.id === activeStepId;
          return (
            <li
              key={step.id}
              data-testid={`deep-research-step-${step.id}`}
              className="flex flex-col gap-2 rounded-xl border border-border-light bg-surface-primary p-3"
            >
              <div className="flex items-center gap-2">
                <StepIcon status={step.status} />
                <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                  {step.title}
                </span>
                <Chip tone={STEP_TONE[step.status]} size="sm">
                  {localize(DEEP_RESEARCH_LABELS[STEP_LABEL[step.status]])}
                </Chip>
              </div>
              {isActive || step.status === 'running' || step.status === 'paused' ? (
                <Progress
                  value={Math.round(step.progress * 100)}
                  aria-label={`${localize(DEEP_RESEARCH_LABELS.stepTitleLabel)} ${index + 1}`}
                />
              ) : null}
              {step.detail ? <p className="text-xs text-text-secondary">{step.detail}</p> : null}
              {step.status === 'failed' && step.error ? (
                <p className="text-xs text-status-error">{step.error}</p>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="flex items-center gap-2">
        {status === 'running' ? (
          <Button type="button" variant="outline" size="sm" onClick={onPause}>
            <Pause className="size-4" aria-hidden="true" />
            {localize(DEEP_RESEARCH_LABELS.pause)}
          </Button>
        ) : null}
        {status === 'paused' ? (
          <Button type="button" variant="default" size="sm" onClick={onResume}>
            <Play className="size-4" aria-hidden="true" />
            {localize(DEEP_RESEARCH_LABELS.resume)}
          </Button>
        ) : null}
        {status === 'running' || status === 'paused' ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            <X className="size-4" aria-hidden="true" />
            {localize(DEEP_RESEARCH_LABELS.cancel)}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
