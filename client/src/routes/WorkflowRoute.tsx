import { createServerExecutor, WorkflowView } from '~/components/Workflow';

/**
 * Route shell for the Workflow Builder. `createServerExecutor` persists the
 * draft on the server (`POST /api/workflows`), triggers a detached run and
 * polls the run record into the panel; `WorkflowView` wraps itself in a
 * per-mount Jotai store, so no extra provider is needed here.
 */
const executor = createServerExecutor();

export default function WorkflowRoute() {
  return <WorkflowView executor={executor} />;
}
