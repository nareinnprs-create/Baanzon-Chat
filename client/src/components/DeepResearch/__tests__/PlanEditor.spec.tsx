import { render, screen, fireEvent } from '@testing-library/react';
import type { ResearchPlan, ResearchStep } from '../types';
import PlanEditor, { findEmptyStepIds, isPlanValid } from '../PlanEditor';
import { DEEP_RESEARCH_LABELS as L } from '../labels';

function makeStep(id: string, title: string): ResearchStep {
  return { id, title, query: '', status: 'pending', progress: 0 };
}

function makePlan(steps: ResearchStep[]): ResearchPlan {
  return { id: 'plan-1', topic: 'Topic', steps };
}

function renderEditor(plan: ResearchPlan) {
  const handlers = {
    onTopicChange: jest.fn(),
    onAddStep: jest.fn(),
    onRemoveStep: jest.fn(),
    onRenameStep: jest.fn(),
    onMoveStep: jest.fn(),
  };
  render(<PlanEditor plan={plan} {...handlers} />);
  return handlers;
}

describe('PlanEditor', () => {
  it('renders a row per step with its title and reorder controls', () => {
    renderEditor(makePlan([makeStep('step-1', 'First'), makeStep('step-2', 'Second')]));

    expect(screen.getByDisplayValue('First')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Second')).toBeInTheDocument();
    expect(screen.getByLabelText('Topic')).toHaveValue('Topic');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('adds a step', () => {
    const handlers = renderEditor(makePlan([makeStep('step-1', 'First')]));
    fireEvent.click(screen.getByRole('button', { name: L.addStep }));
    expect(handlers.onAddStep).toHaveBeenCalledTimes(1);
  });

  it('removes the addressed step', () => {
    const handlers = renderEditor(
      makePlan([makeStep('step-1', 'First'), makeStep('step-2', 'Second')]),
    );
    fireEvent.click(screen.getAllByRole('button', { name: L.removeStep })[0] as HTMLElement);
    expect(handlers.onRemoveStep).toHaveBeenCalledWith('step-1');
  });

  it('moves a step down and up, disabling the controls at the ends', () => {
    const handlers = renderEditor(
      makePlan([makeStep('step-1', 'First'), makeStep('step-2', 'Second')]),
    );

    const ups = screen.getAllByRole('button', { name: L.moveStepUp });
    const downs = screen.getAllByRole('button', { name: L.moveStepDown });
    expect(ups[0]).toBeDisabled();
    expect(downs[1]).toBeDisabled();

    fireEvent.click(downs[0] as HTMLElement);
    expect(handlers.onMoveStep).toHaveBeenCalledWith('step-1', 'down');

    fireEvent.click(ups[1] as HTMLElement);
    expect(handlers.onMoveStep).toHaveBeenCalledWith('step-2', 'up');
  });

  it('reports renames with the step id and the typed value', () => {
    const handlers = renderEditor(makePlan([makeStep('step-1', 'First')]));
    fireEvent.change(screen.getByLabelText(`${L.stepTitleLabel} 1`), {
      target: { value: 'Renamed' },
    });
    expect(handlers.onRenameStep).toHaveBeenCalledWith('step-1', 'Renamed');
  });

  it('shows the empty state and an add action when there are no steps', () => {
    const handlers = renderEditor(makePlan([]));
    expect(screen.getByText(L.planEmptyTitle)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: L.addStep }));
    expect(handlers.onAddStep).toHaveBeenCalledTimes(1);
  });

  it('flags a blank step title with an inline error', () => {
    renderEditor(makePlan([makeStep('step-1', ''), makeStep('step-2', 'Second')]));
    expect(screen.getByText(L.stepTitleRequired)).toBeInTheDocument();
    expect(screen.getByLabelText(`${L.stepTitleLabel} 1`)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(`${L.stepTitleLabel} 2`)).not.toHaveAttribute('aria-invalid');
  });
});

describe('plan validation helpers', () => {
  it('finds blank titles by id', () => {
    const plan = makePlan([makeStep('step-1', 'First'), makeStep('step-2', '  ')]);
    expect(findEmptyStepIds(plan)).toEqual(['step-2']);
  });

  it('accepts only plans with steps that all have titles', () => {
    expect(isPlanValid(makePlan([]))).toBe(false);
    expect(isPlanValid(makePlan([makeStep('step-1', '  ')]))).toBe(false);
    expect(isPlanValid(makePlan([makeStep('step-1', 'First')]))).toBe(true);
  });
});
