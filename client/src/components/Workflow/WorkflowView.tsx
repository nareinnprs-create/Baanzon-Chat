import { useRef, useState } from 'react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import type { WorkflowRunPanelHandle } from './WorkflowRunPanel';
import type { WorkflowExecutor } from './api';
import type { WorkflowDraft } from './types';
import WorkflowRunPanel from './WorkflowRunPanel';
import WorkflowEditor from './WorkflowEditor';
import { seedWorkflowAtom } from './atoms';
import { cn } from '~/utils';

/**
 * The composition root for the Workflow Builder: an {@link WorkflowEditor} and
 * a {@link WorkflowRunPanel} sharing one Jotai store. The host supplies the
 * injected executor (so the feature owns no transport) and, optionally, the
 * document to open with; the editor's run action starts the run through the
 * panel's imperative handle.
 */

export interface WorkflowViewProps {
  executor: WorkflowExecutor;
  /** Document to seed the editor with; the view builds an isolated store. */
  initialWorkflow?: WorkflowDraft;
  /** Called with the validated document when the user saves. */
  onSave?: (workflow: WorkflowDraft) => void;
  className?: string;
}

interface WorkflowViewContentProps {
  executor: WorkflowExecutor;
  onSave?: (workflow: WorkflowDraft) => void;
  className?: string;
}

function WorkflowViewContent({ executor, onSave, className }: WorkflowViewContentProps) {
  const panelRef = useRef<WorkflowRunPanelHandle>(null);
  return (
    <div className={cn('grid gap-4 lg:grid-cols-2', className)}>
      <WorkflowEditor onSave={onSave} onRun={() => panelRef.current?.start()} />
      <WorkflowRunPanel ref={panelRef} executor={executor} showStart={false} />
    </div>
  );
}

export default function WorkflowView({
  executor,
  initialWorkflow,
  onSave,
  className,
}: WorkflowViewProps) {
  const [store] = useState(() => {
    const created = createStore();
    if (initialWorkflow != null) {
      created.set(seedWorkflowAtom, initialWorkflow);
    }
    return created;
  });

  return (
    <JotaiProvider store={store}>
      <WorkflowViewContent executor={executor} onSave={onSave} className={className} />
    </JotaiProvider>
  );
}
