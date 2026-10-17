import { Provider } from 'jotai';
import { createInMemoryExecutor, DeepResearchView } from '~/components/DeepResearch';

/**
 * Route shell for Deep Research. `createInMemoryExecutor` is the feature's
 * dependency-free reference executor, used as the placeholder executor until a
 * backend `DeepResearchExecutor` is injected; it runs the whole plan → progress
 * → report flow without a transport. The per-mount Jotai store isolates the
 * flow's state from the rest of the app.
 */
const executor = createInMemoryExecutor();

export default function DeepResearchRoute() {
  return (
    <Provider>
      <DeepResearchView executor={executor} />
    </Provider>
  );
}
