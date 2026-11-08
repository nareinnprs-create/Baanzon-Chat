import { createInMemoryExecutor, WorkflowView } from '~/components/Workflow';

/**
 * Route shell for the Workflow Builder. `createInMemoryExecutor` is the
 * feature's dependency-free reference executor, used as the placeholder until a
 * backend `WorkflowExecutor` is injected; it runs the editor's draft end to end
 * without a transport. `WorkflowView` wraps itself in a per-mount Jotai store,
 * so no extra provider is needed here.
 */
const executor = createInMemoryExecutor();

export default function WorkflowRoute() {
  return <WorkflowView executor={executor} />;
}
