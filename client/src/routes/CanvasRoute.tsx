import { Provider } from 'jotai';
import {
  CanvasWorkspace,
  createInMemoryEditSelection,
  createSampleDocument,
} from '~/components/Canvas';

/** Stable identities: `CanvasWorkspace` re-dispatches its load effect whenever
 *  the `document` prop changes, so the sample must not be built per render. */
const sampleDocument = createSampleDocument();
const editSelection = createInMemoryEditSelection();

/**
 * Route shell for Canvas. The in-memory `editSelection` is the feature's
 * dependency-free reference backend, used until a real AI edit transport is
 * injected; the sample document gives the workspace content to edit. The
 * per-mount Jotai store keeps document, selection, comments and version state
 * local to the page.
 */
export default function CanvasRoute() {
  return (
    <Provider>
      <CanvasWorkspace document={sampleDocument} editSelection={editSelection} />
    </Provider>
  );
}
