import { randomUUID } from 'crypto';
import type {
  TDeepResearchPlan,
  TDeepResearchReport,
  TDeepResearchStatus,
} from 'librechat-data-provider';
import type {
  DeepResearchEmittedEvent,
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

  async function runStep(
    input: DeepResearchRunInput,
    signal: AbortSignal,
    emit: DeepResearchEventEmitter,
  ) {
    const { step } = input;

    emit(
      progress(0.1, 'Searching sources', { code: 'search_started', stepId: step.id }),
    );

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

    emit(
      progress(0.85, 'Synthesizing findings', { code: 'synthesize_started', stepId: step.id }),
    );
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
      summary: `Completed ${plan.steps.length} step${
        plan.steps.length === 1 ? '' : 's'
      } on ${plan.topic}.`,
      sections,
      citations,
      generatedAt: new Date().toISOString(),
    };
  }

  return { createPlan, runStep, buildReport };
}

const EMPTY_STEP_BODY = 'This step did not produce a summary.';

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
