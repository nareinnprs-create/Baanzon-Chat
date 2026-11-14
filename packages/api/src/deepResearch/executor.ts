import { randomUUID } from 'crypto';
import type { TDeepResearchPlan, TDeepResearchStatus } from 'librechat-data-provider';
import type {
  DeepResearchEventEmitter,
  DeepResearchPlanInput,
  DeepResearchRunInput,
  DeepResearchRunner,
  DeepResearchRunnerDeps,
  DeepResearchSearchResult,
} from './types';

/** A step reads at most this many sources before synthesis; bounded on purpose. */
const MAX_SOURCES = 8;

const RUNNING_STATUS: TDeepResearchStatus = 'running';

/**
 * The real backend executor for Deep Research. Stateless by design: a run is
 * one SSE stream for a single step (search → read → synthesize), so horizontal
 * scaling does not need shared run state. Search and the LLM arrive through
 * injected providers; with neither wired the runner still completes, emitting
 * an explanatory event and assembling whatever it has, which keeps the flow
 * usable instead of dead-ending when a backend is up but unconfigured.
 */
export function createDeepResearchRunner(deps: DeepResearchRunnerDeps): DeepResearchRunner {
  const { searchProvider, llm } = deps;

  async function createPlan(input: DeepResearchPlanInput, signal: AbortSignal) {
    const { topic } = input;
    if (signal.aborted) {
      throw abortError();
    }
    const template = buildTemplatePlan(topic);
    if (llm == null) {
      return template;
    }
    try {
      const prompt = [
        'You are a research planner. Break the topic into 3 to 5 sequential research steps.',
        `Topic: ${topic}`,
        'Respond with ONLY a JSON array, no prose and no code fences. Each element is an object with exactly two string fields: "title" (a short step title) and "query" (a web search query for that step).',
        'Order steps so they build on each other: background first, then evidence, then analysis or synthesis last.',
      ].join('\n\n');
      const steps = parsePlanSteps(await llm.complete(prompt, signal));
      if (steps.length === 0) {
        return template;
      }
      return { id: `plan-${randomUUID()}`, topic, steps };
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'AbortError') {
        throw caught;
      }
      /** A failed planner call degrades to the deterministic template. */
      return template;
    }
  }

  async function runStep(
    input: DeepResearchRunInput,
    signal: AbortSignal,
    emit: DeepResearchEventEmitter,
  ) {
    const { step } = input;

    emit(progress(0.1, 'Searching sources', { code: 'search_started', stepId: step.id }));

    let sources: DeepResearchSearchResult[] = [];
    if (searchProvider == null) {
      emit(
        progress(0.35, 'Web search is not configured for Deep Research', {
          code: 'search_unsupported',
          stepId: step.id,
        }),
      );
    } else {
      sources = (await searchProvider.search(step.query, signal)).slice(0, MAX_SOURCES);
      emit(
        progress(0.6, `Read ${sources.length} source${sources.length === 1 ? '' : 's'}`, {
          code: 'sources_read',
          stepId: step.id,
        }),
      );
    }

    emit(progress(0.85, 'Synthesizing findings', { code: 'synthesize_started', stepId: step.id }));
    return synthesize(step, sources, signal);
  }

  async function synthesize(
    step: DeepResearchRunInput['step'],
    sources: DeepResearchSearchResult[],
    signal: AbortSignal,
  ) {
    if (llm != null) {
      const prompt = [
        `Research step: ${step.title}`,
        `Question: ${step.query}`,
        ...sources.map(
          (source, index) =>
            `[${index + 1}] ${source.title}${source.url ? ` (${source.url})` : ''}\n${
              source.snippet ?? ''
            }`,
        ),
        'Write a concise summary of the findings for this step.',
      ].join('\n\n');
      return { detail: await llm.complete(prompt, signal), citations: toCitations(sources) };
    }
    return { detail: assembleDetail(step, sources), citations: toCitations(sources) };
  }

  async function buildReport(plan: TDeepResearchPlan, signal: AbortSignal) {
    if (signal.aborted) {
      throw abortError();
    }
    const sections = plan.steps.map((step, index) => ({
      id: `section-${index + 1}`,
      heading: step.title,
      body: step.detail && step.detail.trim() !== '' ? step.detail : EMPTY_STEP_BODY,
      citations: step.citations ?? [],
    }));
    const citations = plan.steps.flatMap((step) => step.citations ?? []);
    return {
      planId: plan.id,
      title: `Research report: ${plan.topic}`,
      summary: await reportSummary(plan, signal),
      sections,
      citations,
      generatedAt: new Date().toISOString(),
    };
  }

  async function reportSummary(plan: TDeepResearchPlan, signal: AbortSignal): Promise<string> {
    const fallback = `Completed ${plan.steps.length} step${
      plan.steps.length === 1 ? '' : 's'
    } on ${plan.topic}.`;
    if (llm == null) {
      return fallback;
    }
    try {
      const material = plan.steps
        .map((step) => `## ${step.title}\n${(step.detail ?? '').slice(0, 8000)}`)
        .join('\n\n')
        .slice(0, 24000);
      const summary = (
        await llm.complete(
          [
            'Write an executive summary of this research report in three sentences or fewer.',
            'Answer in plain prose, no headings, no lists, no citations.',
            'Material:',
            material,
          ].join('\n\n'),
          signal,
        )
      ).trim();
      return summary || fallback;
    } catch {
      return fallback;
    }
  }

  return { createPlan, runStep, buildReport };
}

const EMPTY_STEP_BODY = 'This step did not produce a summary.';

/** Bounded plan shape: at least one, at most five steps. */
const PLAN_MIN_STEPS = 1;
const PLAN_MAX_STEPS = 5;

/**
 * Extracts plan steps from the planner LLM's reply. Tolerates code fences and
 * prose around the JSON array; anything not cleanly shaped is dropped, and an
 * empty result sends the caller to the deterministic template.
 */
function parsePlanSteps(raw: string): TDeepResearchPlan['steps'] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const steps = parsed
    .map((entry) => {
      const shape = entry as { title?: unknown; query?: unknown };
      const title = typeof shape.title === 'string' ? shape.title.trim() : '';
      const query = typeof shape.query === 'string' ? shape.query.trim() : '';
      if (!title || !query) {
        return null;
      }
      return { title: title.slice(0, 500), query: query.slice(0, 4000) };
    })
    .filter((step): step is { title: string; query: string } => step != null)
    .slice(0, PLAN_MAX_STEPS);
  if (steps.length < PLAN_MIN_STEPS) {
    return [];
  }
  return steps.map((step, index) => ({ id: `step-${index + 1}`, ...step }));
}

/** The deterministic fallback plan used when no LLM is wired or parsing fails. */
function buildTemplatePlan(topic: string): TDeepResearchPlan {
  return {
    id: `plan-${randomUUID()}`,
    topic,
    steps: [
      {
        id: 'step-1',
        title: `Background: ${topic}`,
        query: `${topic} background context overview`,
      },
      {
        id: 'step-2',
        title: `Evidence: ${topic}`,
        query: `${topic} key evidence data findings`,
      },
      {
        id: 'step-3',
        title: `Synthesis: ${topic}`,
        query: `${topic} analysis implications outlook`,
      },
    ],
  };
}

function progress(
  value: number,
  detail: string,
  extra: { code: string; stepId?: string },
): Parameters<DeepResearchEventEmitter>[0] {
  return {
    kind: 'progress',
    status: RUNNING_STATUS,
    code: extra.code,
    stepId: extra.stepId,
    detail,
    progress: value,
  };
}

function toCitations(sources: DeepResearchSearchResult[]) {
  return sources.map((source, index) => ({
    id: `citation-${index + 1}`,
    title: source.title,
    ...(source.url !== undefined ? { url: source.url } : {}),
    ...(source.snippet !== undefined ? { snippet: source.snippet } : {}),
  }));
}

function assembleDetail(
  step: DeepResearchRunInput['step'],
  sources: DeepResearchSearchResult[],
): string {
  if (sources.length === 0) {
    return `No sources were retrievable for "${step.title}" — web search is not configured, so this step could not be researched.`;
  }
  return `Collected ${sources.length} source${sources.length === 1 ? '' : 's'}: ${sources
    .map((source) => source.title)
    .join('; ')}.`;
}

function abortError(): Error {
  const error = new Error('Deep research run aborted');
  error.name = 'AbortError';
  return error;
}
