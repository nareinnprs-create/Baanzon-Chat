import { useState } from 'react';
import { Provider } from 'jotai';
import {
  CanvasWorkspace,
  createInMemoryEditSelection,
  createSampleDocument,
} from '~/components/Canvas';
import { loadCanvasSnapshot } from '~/components/Canvas/storage';
import { useAuthContext } from '~/hooks';

/** Stable identities: `CanvasWorkspace` re-dispatches its load effect whenever
 *  the `document` prop changes, so the sample must not be built per render. */
const sampleDocument = createSampleDocument();
const editSelection = createInMemoryEditSelection();

/** One document per user per browser. The feature has no backend yet, so
 *  without this a reload or PWA restart discarded every edit; scoping by user
 *  keeps a shared device from showing one account's document to another. */
const storageKeyFor = (userId?: string) => `baanzon-canvas-document-v1:${userId ?? 'guest'}`;

function StoredCanvas({ storageKey }: { storageKey: string }) {
  const [snapshot] = useState(() => loadCanvasSnapshot(storageKey));
  return (
    <CanvasWorkspace
      document={snapshot?.document ?? sampleDocument}
      initialComments={snapshot?.comments}
      initialVersions={snapshot?.versions}
      editSelection={editSelection}
      persistKey={storageKey}
    />
  );
}

/**
 * Route shell for Canvas. The in-memory `editSelection` is the feature's
 * dependency-free reference backend, used until a real AI edit transport is
 * injected; the stored snapshot (or the sample document on first visit) gives
 * the workspace content to edit. The per-mount Jotai store keeps document,
 * selection, comments and version state local to the page, and the workspace
 * mirrors it to `localStorage`. The provider is keyed by the storage key so
 * switching accounts starts from that account's own document.
 */
export default function CanvasRoute() {
  const { user } = useAuthContext();
  const storageKey = storageKeyFor(user?.id);
  return (
    <Provider key={storageKey}>
      <StoredCanvas storageKey={storageKey} />
    </Provider>
  );
}
