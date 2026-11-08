import type {
  ResearchCitation,
  ResearchPlan,
  ResearchReport,
  ResearchSection,
  ResearchStep,
} from './types';

/**
 * The single seam between the Deep Research view and whatever produces the
 * research. The view is written against this interface and receives an
 * implementation as a prop, so it never imports a transport, a data-provider
 * endpoint or a React Query hook. A real backend adapter and the in-memory
 * reference below are interchangeable.
 */

/** Reports live progress for the step currently running. */
export type StepProgressCallback = (progress: number, detail?: string) => void;

/** What a completed step reports back; merged into the plan step by the view. */
export type ResearchStepResult = {
  detail?: string;
  citations?: ResearchCitation[];
};

export interface DeepResearchExecutor {
  /** Build the initial, editable plan for a topic. */
  createPlan(topic: string, signal: AbortSignal): Promise<ResearchPlan>;
  /**
   * Run one step. The caller passes an `AbortSignal` it aborts on pause, cancel
   * or unmount; implementations must reject promptly once it fires.
   */
  runStep(
    step: ResearchStep,
    signal: AbortSignal,
    onProgress?: StepProgressCallback,
  ): Promise<ResearchStepResult>;
  /** Compile the finished plan into a report. */
  buildReport(plan: ResearchPlan, signal: AbortSignal): Promise<ResearchReport>;
}

export type InMemoryExecutorOptions = {
  /** Number of steps the generated plan contains. */
  stepCount?: number;
  /** Artificial latency before the plan resolves; useful for loading states. */
  planDelayMs?: number;
  /** Artificial latency per step; progress is announced twice across it. */
  stepDelayMs?: number;
  /** Artificial latency before the report resolves. */
  reportDelayMs?: number;
};

const DEFAULT_STEP_COUNT = 3;
const DEFAULT_STEP_DELAY_MS = 120;

let planSequence = 0;

function abortError(): Error {
  const error = new Error('Deep research run aborted');
  error.name = 'AbortError';
  return error;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function buildPlan(topic: string, stepCount: number): ResearchPlan {
  planSequence += 1;
  const steps: ResearchStep[] = Array.from({ length: stepCount }, (_value, index) => ({
    id: `step-${index + 1}`,
    title: `Research ${topic} (step ${index + 1})`,
    query: `${topic} — step ${index + 1}`,
    status: 'pending',
    progress: 0,
  }));
  return { id: `plan-${planSequence}`, topic, steps };
}

function buildReport(plan: ResearchPlan): ResearchReport {
  const citations: ResearchCitation[] = [
    { id: 'citation-1', title: 'Placeholder source', url: 'https://example.com' },
  ];
  const sections: ResearchSection[] = plan.steps.map((step, index) => ({
    id: `section-${index + 1}`,
    heading: step.title,
    body: step.detail ?? `${step.title} completed.`,
    citations: [],
  }));
  return {
    planId: plan.id,
    title: `Research report: ${plan.topic}`,
    summary: `Completed ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'} on ${plan.topic}.`,
    sections,
    citations,
    generatedAt: new Date(0).toISOString(),
  };
}

/**
 * A deterministic, dependency-free reference executor.
 *
 * It exists so the view and its tests can run a complete flow without a
 * backend, and so integrators have a working default to swap out. Delays are
 * configurable and default to zero (plan/report) and a short per-step wait, so
 * tests can pass `stepDelayMs: 0` for an instant run.
 */
export function createInMemoryExecutor(
  options: InMemoryExecutorOptions = {},
): DeepResearchExecutor {
  const stepCount = options.stepCount ?? DEFAULT_STEP_COUNT;
  const planDelayMs = options.planDelayMs ?? 0;
  const stepDelayMs = options.stepDelayMs ?? DEFAULT_STEP_DELAY_MS;
  const reportDelayMs = options.reportDelayMs ?? 0;

  return {
    async createPlan(topic, signal) {
      await delay(planDelayMs, signal);
      return buildPlan(topic, stepCount);
    },
    async runStep(step, signal, onProgress) {
      onProgress?.(0.1, step.title);
      await delay(stepDelayMs / 2, signal);
      onProgress?.(0.6, step.title);
      await delay(stepDelayMs / 2, signal);
      onProgress?.(1, step.title);
      if (signal.aborted) {
        throw abortError();
      }
      return { detail: `${step.title} completed.` };
    },
    async buildReport(plan, signal) {
      await delay(reportDelayMs, signal);
      return buildReport(plan);
    },
  };
}
