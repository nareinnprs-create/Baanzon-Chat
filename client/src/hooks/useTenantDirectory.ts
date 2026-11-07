import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  TenantDirectoryLoader,
  TenantLoadStatus,
  TenantOrganization,
  TenantProject,
  TenantSelection,
  TenantWorkspace,
} from '~/utils/tenant/types';

/**
 * Loads the tenant hierarchy through an injected {@link TenantDirectoryLoader}
 * and returns it as plain props for `<TenantSwitcher>`.
 *
 * This is where transport lives, on purpose: the switcher receives lists and a
 * status and never learns where they came from, so the same component serves a
 * React Query adapter, a server-fetched prop and a fixture. Nothing is
 * persisted — pass `selection` to open on a remembered scope, and read it back
 * from `onChange` to store it wherever the app keeps such things.
 */

/** Everything `<TenantSwitcher>` needs, straight through as props. */
export interface TenantDirectoryState {
  organizations: readonly TenantOrganization[];
  workspaces: readonly TenantWorkspace[];
  projects: readonly TenantProject[];
  status: TenantLoadStatus;
  error: string | null;
  /** Re-runs the read for the current scope; wired to the switcher's retry. */
  reload: () => void;
}

export interface UseTenantDirectoryOptions {
  /** The one seam to the backend. Its shape, not a URL, is what is required. */
  loader: TenantDirectoryLoader;
  /** The scope to load around. Defaults to the unscoped root. */
  selection?: Partial<TenantSelection>;
  /** Hold every read until the host is ready; the cascade then starts itself. */
  enabled?: boolean;
}

function messageOf(reason: unknown): string {
  if (reason instanceof Error && reason.message.length > 0) {
    return reason.message;
  }
  if (typeof reason === 'string' && reason.length > 0) {
    return reason;
  }
  return 'Unknown error';
}

/** An abort the caller triggered is not a failure and must not surface as one. */
function isAbort(reason: unknown): boolean {
  return reason instanceof Error && reason.name === 'AbortError';
}

export function useTenantDirectory({
  loader,
  selection,
  enabled = true,
}: UseTenantDirectoryOptions): TenantDirectoryState {
  const organizationId = selection?.organizationId ?? null;
  const workspaceId = selection?.workspaceId ?? null;

  const [organizations, setOrganizations] = useState<readonly TenantOrganization[]>([]);
  const [workspaces, setWorkspaces] = useState<readonly TenantWorkspace[]>([]);
  const [projects, setProjects] = useState<readonly TenantProject[]>([]);
  const [status, setStatus] = useState<TenantLoadStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  /**
   * Held in a ref so an inline `loader` prop does not restart the cascade on
   * every render of the host — the effect keys on the scope, not on the object.
   */
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const controller = new AbortController();
    let cancelled = false;

    async function read(): Promise<void> {
      try {
        setStatus('loading');
        setError(null);
        const loadedOrganizations = await loaderRef.current.loadOrganizations(controller.signal);
        if (cancelled) {
          return;
        }
        setOrganizations(loadedOrganizations);
        setWorkspaces([]);
        setProjects([]);

        if (organizationId == null) {
          setStatus('ready');
          return;
        }
        const loadedWorkspaces = await loaderRef.current.loadWorkspaces(
          organizationId,
          controller.signal,
        );
        if (cancelled) {
          return;
        }
        setWorkspaces(loadedWorkspaces);

        if (workspaceId == null) {
          setStatus('ready');
          return;
        }
        const loadedProjects = await loaderRef.current.loadProjects(workspaceId, controller.signal);
        if (cancelled) {
          return;
        }
        setProjects(loadedProjects);
        setStatus('ready');
      } catch (reason) {
        if (cancelled || isAbort(reason)) {
          return;
        }
        setError(messageOf(reason));
        setStatus('error');
      }
    }

    void read();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, organizationId, workspaceId, attempt]);

  const reload = useCallback(() => {
    setAttempt((previous) => previous + 1);
  }, []);

  return useMemo(
    () => ({ organizations, workspaces, projects, status, error, reload }),
    [organizations, workspaces, projects, status, error, reload],
  );
}

export default useTenantDirectory;
