import { createStore, Provider as JotaiProvider } from 'jotai';
import { act, render, screen, fireEvent } from '@testing-library/react';
import type { TOptions } from 'i18next';
import type { ResearchPlan, ResearchReport, ResearchStep } from '../types';
import type { DeepResearchExecutor } from '../api';
import DeepResearchView from '../DeepResearchView';
import { DEEP_RESEARCH_LABELS } from '../labels';
import i18n from '~/locales/i18n';

const t = i18n.t.bind(i18n) as (key: string, options?: TOptions) => string;
const L = Object.fromEntries(
  Object.entries(DEEP_RESEARCH_LABELS).map(([name, key]) => [name, t(key)]),
) as Record<keyof typeof DEEP_RESEARCH_LABELS, string>;

function makeStep(id: string, title: string): ResearchStep {
  return { id, title, query: title, status: 'pending', progress: 0 };
}

function makePlan(topic: string, count = 2): ResearchPlan {
  return {
    id: 'plan-1',
    topic,
    steps: Array.from({ length: count }, (_value, index) =>
      makeStep(`step-${index + 1}`, `${topic} step ${index + 1}`),
    ),
  };
}

function makeReport(plan: ResearchPlan): ResearchReport {
  return {
    planId: plan.id,
    title: `Research report: ${plan.topic}`,
    summary: 'All done.',
    sections: [],
    citations: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderView(executor: DeepResearchExecutor) {
  const store = createStore();
  const result = render(
    <JotaiProvider store={store}>
      <DeepResearchView executor={executor} />
    </JotaiProvider>,
  );
  return { store, ...result };
}

/** Types a topic and clicks Generate plan (the plan is still pending on its gate). */
function startPlanning() {
  fireEvent.change(screen.getByLabelText(L.topicLabel), { target: { value: 'Quantum' } });
  fireEvent.click(screen.getByRole('button', { name: L.generatePlan }));
}

/** Resolves the plan gate and waits for the editor to appear. */
async function resolvePlan(gate: Deferred<ResearchPlan>, plan: ResearchPlan) {
  await act(async () => {
    gate.resolve(plan);
  });
  await screen.findByDisplayValue('Quantum step 1');
}

describe('DeepResearchView', () => {
  it('renders the empty state: a topic form with a disabled generate action', () => {
    renderView({ createPlan: jest.fn(), runStep: jest.fn(), buildReport: jest.fn() });

    expect(screen.getByRole('heading', { name: L.featureTitle })).toBeInTheDocument();
    expect(screen.getByLabelText(L.topicLabel)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: L.generatePlan })).toBeDisabled();
  });

  it('shows a planning state while the planner builds the plan', () => {
    const gate = deferred<ResearchPlan>();
    renderView({
      createPlan: jest.fn(() => gate.promise),
      runStep: jest.fn(),
      buildReport: jest.fn(),
    });

    startPlanning();

    expect(screen.getByRole('status')).toHaveTextContent(L.planning);
    expect(screen.queryByRole('button', { name: L.generatePlan })).not.toBeInTheDocument();
  });

  it('runs a plan with live progress, announces it, then renders the report', async () => {
    const planGate = deferred<ResearchPlan>();
    const stepGate = deferred();
    const plan = makePlan('Quantum');
    const report = makeReport(plan);
    const runStep = jest.fn(async () => {
      await stepGate.promise;
      return { detail: 'done' };
    });
    const buildReport = jest.fn(async () => report);
    const executor: DeepResearchExecutor = {
      createPlan: jest.fn(() => planGate.promise),
      runStep,
      buildReport,
    };

    renderView(executor);
    startPlanning();
    await resolvePlan(planGate, plan);

    fireEvent.click(screen.getByRole('button', { name: L.runPlan }));

    expect(screen.getByRole('button', { name: L.pause })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Running step 1 of 2');
    expect(screen.getByTestId('deep-research-step-step-1')).toBeInTheDocument();

    await act(async () => {
      stepGate.resolve();
    });

    expect(await screen.findByRole('heading', { name: L.reportHeading })).toBeInTheDocument();
    expect(screen.getByText(report.title)).toBeInTheDocument();
    expect(runStep).toHaveBeenCalledTimes(2);
    expect(buildReport).toHaveBeenCalledTimes(1);
  });

  it('pauses and resumes a running plan', async () => {
    const planGate = deferred<ResearchPlan>();
    const plan = makePlan('Quantum');
    const runStep = jest.fn(() => new Promise<{ detail?: string }>(() => undefined));
    const executor: DeepResearchExecutor = {
      createPlan: jest.fn(() => planGate.promise),
      runStep,
      buildReport: jest.fn(),
    };

    renderView(executor);
    startPlanning();
    await resolvePlan(planGate, plan);

    fireEvent.click(screen.getByRole('button', { name: L.runPlan }));
    fireEvent.click(screen.getByRole('button', { name: L.pause }));

    expect(screen.getByRole('button', { name: L.resume })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Research paused at step 1 of 2');

    fireEvent.click(screen.getByRole('button', { name: L.resume }));

    expect(screen.getByRole('button', { name: L.pause })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Running step 1 of 2');
  });

  it('cancels a run and offers retry and start over', async () => {
    const planGate = deferred<ResearchPlan>();
    const plan = makePlan('Quantum');
    const executor: DeepResearchExecutor = {
      createPlan: jest.fn(() => planGate.promise),
      runStep: jest.fn(() => new Promise<{ detail?: string }>(() => undefined)),
      buildReport: jest.fn(),
    };

    renderView(executor);
    startPlanning();
    await resolvePlan(planGate, plan);

    fireEvent.click(screen.getByRole('button', { name: L.runPlan }));
    fireEvent.click(screen.getByRole('button', { name: L.cancel }));

    expect(screen.getByText(L.cancelledTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: L.retry })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: L.startOver })).toBeInTheDocument();
  });

  it('surfaces a failed run with the executor error and a retry', async () => {
    const planGate = deferred<ResearchPlan>();
    const failGate = deferred();
    const plan = makePlan('Quantum');
    const executor: DeepResearchExecutor = {
      createPlan: jest.fn(() => planGate.promise),
      runStep: jest.fn(async () => {
        await failGate.promise;
        throw new Error('Boom');
      }),
      buildReport: jest.fn(),
    };

    renderView(executor);
    startPlanning();
    await resolvePlan(planGate, plan);

    fireEvent.click(screen.getByRole('button', { name: L.runPlan }));
    await act(async () => {
      failGate.resolve();
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
    expect(screen.getByRole('button', { name: L.retry })).toBeInTheDocument();
  });
});
