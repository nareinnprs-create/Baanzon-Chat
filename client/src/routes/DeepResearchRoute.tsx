import { Provider } from 'jotai';
import { createBackendDeepResearchExecutor, DeepResearchView } from '~/components/DeepResearch';

/**
 * Route shell for Deep Research. `createBackendDeepResearchExecutor` talks to
 * the backend `/api/deep-research` endpoints and falls back to the feature's
 * in-memory executor when the backend is unavailable (`deepResearch.enabled`
 * off, the origins' server missing, or the stream lost), so the flow always
 * works. The per-mount Jotai store isolates the flow's state from the rest of
 * the app.
 */
const executor = createBackendDeepResearchExecutor();

export default function DeepResearchRoute() {
  return (
    <Provider>
      <DeepResearchView executor={executor} />
    </Provider>
  );
}
