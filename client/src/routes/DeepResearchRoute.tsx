import { useMemo } from 'react';
import { Provider } from 'jotai';
import { createBackendDeepResearchExecutor, DeepResearchView } from '~/components/DeepResearch';
import { useAuthContext } from '~/hooks/AuthContext';

/**
 * Route shell for Deep Research. `createBackendDeepResearchExecutor` talks to
 * the backend `/api/deep-research` endpoints and falls back to the feature's
 * in-memory executor when the backend is unavailable (`deepResearch.enabled`
 * off, the origins' server missing, or the stream lost), so the flow always
 * works. The run stream authenticates with the session's Bearer token because
 * `EventSource` cannot carry one. The per-mount Jotai store isolates the
 * flow's state from the rest of the app.
 */
export default function DeepResearchRoute() {
  const { token } = useAuthContext();
  const executor = useMemo(
    () => createBackendDeepResearchExecutor({ getToken: () => token }),
    [token],
  );
  return (
    <Provider>
      <DeepResearchView executor={executor} />
    </Provider>
  );
}
