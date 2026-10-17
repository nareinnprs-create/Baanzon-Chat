import type { WorkflowScheduler, WorkflowSchedulerDeps, WorkflowTrigger } from './types';

const DEFAULT_CLOCK = (): Date => new Date();

function parseDate(value: string | undefined): Date | null {
  if (value == null) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nextIntervalRun(trigger: { everyMs: number; anchor?: string }, after: Date): Date | null {
  if (!(trigger.everyMs > 0)) {
    return null;
  }
  const anchor = parseDate(trigger.anchor);
  if (trigger.anchor != null && anchor == null) {
    return null;
  }
  if (anchor == null) {
    return new Date(after.getTime() + trigger.everyMs);
  }
  if (anchor.getTime() > after.getTime()) {
    return anchor;
  }
  const steps = Math.floor((after.getTime() - anchor.getTime()) / trigger.everyMs) + 1;
  return new Date(anchor.getTime() + steps * trigger.everyMs);
}

/** Pure next-fire computation; `after` is exclusive. */
export function computeNextWorkflowRun(
  trigger: WorkflowTrigger,
  after: Date,
  deps: WorkflowSchedulerDeps = {},
): Date | null {
  switch (trigger.type) {
    case 'manual':
      return null;
    case 'once': {
      const at = parseDate(trigger.at);
      return at != null && at.getTime() > after.getTime() ? at : null;
    }
    case 'interval':
      return nextIntervalRun(trigger, after);
    case 'cron':
      return deps.nextCronRun != null
        ? deps.nextCronRun(trigger.expression, after, trigger.timezone)
        : null;
  }
}

/** Whether an occurrence at or before `now` exists after `lastRunAt`. */
export function isWorkflowTriggerDue(
  trigger: WorkflowTrigger,
  lastRunAt: Date | null,
  now: Date,
  deps: WorkflowSchedulerDeps = {},
): boolean {
  switch (trigger.type) {
    case 'manual':
      return false;
    case 'once': {
      const at = parseDate(trigger.at);
      if (at == null || at.getTime() > now.getTime()) {
        return false;
      }
      return lastRunAt == null || lastRunAt.getTime() < at.getTime();
    }
    case 'interval': {
      if (!(trigger.everyMs > 0) || trigger.anchor == null) {
        return false;
      }
      const anchor = parseDate(trigger.anchor);
      if (anchor == null || now.getTime() < anchor.getTime()) {
        return false;
      }
      const steps = Math.floor((now.getTime() - anchor.getTime()) / trigger.everyMs);
      const mostRecent = anchor.getTime() + steps * trigger.everyMs;
      return lastRunAt == null || lastRunAt.getTime() < mostRecent;
    }
    case 'cron': {
      if (deps.nextCronRun == null) {
        return false;
      }
      const from = lastRunAt ?? new Date(0);
      const candidate = deps.nextCronRun(trigger.expression, from, trigger.timezone);
      return candidate != null && candidate.getTime() <= now.getTime();
    }
  }
}

export function createWorkflowScheduler(deps: WorkflowSchedulerDeps = {}): WorkflowScheduler {
  const clock = deps.clock ?? DEFAULT_CLOCK;

  return {
    nextRun(trigger: WorkflowTrigger, after?: Date): Date | null {
      return computeNextWorkflowRun(trigger, after ?? clock(), deps);
    },
    isDue(trigger: WorkflowTrigger, lastRunAt: Date | null): boolean {
      return isWorkflowTriggerDue(trigger, lastRunAt, clock(), deps);
    },
  };
}
