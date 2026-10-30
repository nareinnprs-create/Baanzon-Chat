import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { WorkflowDraft } from '../types';
import { WORKFLOW_LABELS as L } from '../labels';
import { createInMemoryExecutor } from '../api';
import WorkflowView from '../WorkflowView';

function documentWithSteps(): WorkflowDraft {
  return {
    id: 'flow-1',
    name: 'Flow',
    description: '',
    definition: {
      steps: [{ id: 'a', type: 'custom', name: 'First step', input: {} }],
    },
  };
}

describe('WorkflowView', () => {
  it('renders the editor and the run panel', () => {
    render(<WorkflowView executor={createInMemoryExecutor()} />);

    expect(screen.getByTestId('workflow-editor')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-run-panel')).toBeInTheDocument();
  });

  it('seeds the editor from the initial workflow and blocks save until named', () => {
    render(<WorkflowView executor={createInMemoryExecutor()} />);
    expect(screen.getByRole('button', { name: L.saveWorkflow })).toBeDisabled();
    expect(screen.getByText(L.noStepsTitle)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: L.addStep }));
    expect(screen.getByTestId('workflow-step')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(L.workflowNameLabel), { target: { value: 'Flow' } });
    expect(screen.getByRole('button', { name: L.saveWorkflow })).toBeEnabled();
  });

  it('saves the validated document and confirms', () => {
    const onSave = jest.fn();
    render(
      <WorkflowView
        initialWorkflow={documentWithSteps()}
        onSave={onSave}
        executor={createInMemoryExecutor()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: L.saveWorkflow }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toEqual({
      id: 'flow-1',
      name: 'Flow',
      description: '',
      definition: {
        steps: [{ id: 'a', type: 'custom', name: 'First step', input: {} }],
      },
    });
    expect(screen.getByText(L.savedMessage)).toBeInTheDocument();
  });

  it('reports invalid step input and gates save', () => {
    render(
      <WorkflowView executor={createInMemoryExecutor()} initialWorkflow={documentWithSteps()} />,
    );

    fireEvent.change(screen.getByLabelText(L.stepInputLabel), { target: { value: '{' } });

    expect(screen.getByText(L.stepInputInvalidJson)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: L.saveWorkflow })).toBeDisabled();
  });

  it('runs the workflow through the injected executor and shows completion', async () => {
    render(
      <WorkflowView
        executor={createInMemoryExecutor({ stepDelayMs: 0 })}
        initialWorkflow={documentWithSteps()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: L.runStart }));

    await waitFor(() =>
      expect(screen.getByTestId('workflow-run-status')).toHaveTextContent(L.runStatusCompleted),
    );
    expect(screen.getByTestId('workflow-run-history')).toBeInTheDocument();
  });
});
