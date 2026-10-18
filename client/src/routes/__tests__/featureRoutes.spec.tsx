import { render, screen } from '@testing-library/react';
import type { TOptions } from 'i18next';
import type { ReactNode } from 'react';
import { DEEP_RESEARCH_LABELS } from '~/components/DeepResearch/labels';
import { WORKFLOW_LABELS } from '~/components/Workflow';
import { DATA_LAB_LABELS } from '~/components/DataLab';
import DeepResearchRoute from '../DeepResearchRoute';
import { CANVAS_LABELS } from '~/components/Canvas';
import { VOICE_LABELS } from '~/components/Voice';
import WorkflowRoute from '../WorkflowRoute';
import DataLabRoute from '../DataLabRoute';
import CanvasRoute from '../CanvasRoute';
import VoiceRoute from '../VoiceRoute';
import i18n from '~/locales/i18n';
import { router } from '../index';

/** The route table pulls in the whole shell. The feature routes under test do not
 *  touch any of it, so the shell is stubbed and the route table itself — the part
 *  this file exists to check — stays real. */
jest.mock('~/components/Auth', () => ({
  Login: () => null,
  VerifyEmail: () => null,
  Registration: () => null,
  ResetPassword: () => null,
  ApiErrorWatcher: () => null,
  TwoFactorScreen: () => null,
  RequestPasswordReset: () => null,
}));

jest.mock('~/components/Agents/MarketplaceContext', () => ({
  MarketplaceProvider: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('~/components/Agents/Marketplace', () => () => null);
jest.mock('~/components/OAuth', () => ({
  OAuthSuccess: () => null,
  OAuthError: () => null,
}));
jest.mock('~/hooks/AuthContext', () => ({
  AuthContextProvider: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('../RouteErrorBoundary', () => () => null);
jest.mock('../Layouts/Startup', () => () => null);
jest.mock('../Layouts/Login', () => () => null);
jest.mock('../Dashboard', () => ({
  __esModule: true,
  default: { path: 'dashboard', element: null },
}));
jest.mock('../ShareRoute', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../ChatRoute', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../Search', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../Root', () => ({
  __esModule: true,
  default: () => null,
}));

const t = i18n.t.bind(i18n) as (key: string, options?: TOptions) => string;

type RouteNode = {
  path?: string;
  element?: unknown;
  lazy?: () => Promise<{ Component: unknown }>;
  children?: RouteNode[];
};

const routeTable = (router as unknown as { routes: RouteNode[] }).routes;

/** Every shipped capability, the path it answers on, and the route module that
 *  path has to resolve to. The pairing is the contract: a path wired to the
 *  wrong module still loads, still renders, and still passes a "did it mount"
 *  check, so only the identity assertion below catches it. */
const FEATURE_ROUTES: { path: string; Component: unknown }[] = [
  { path: 'canvas', Component: CanvasRoute },
  { path: 'voice', Component: VoiceRoute },
  { path: 'workflow', Component: WorkflowRoute },
  { path: 'data-lab', Component: DataLabRoute },
  { path: 'deep-research', Component: DeepResearchRoute },
];

/** Locates a registered path and reports the paths it sits beside, which is what
 *  tells an app-shell route from a stray top-level one. */
function locate(path: string): { node: RouteNode; siblings: string[] } {
  const walk = (nodes: RouteNode[]): { node: RouteNode; siblings: string[] } | undefined => {
    for (const node of nodes) {
      if (node.path === path) {
        return { node, siblings: nodes.map((sibling) => sibling.path ?? '') };
      }
      const found = walk(node.children ?? []);
      if (found != null) {
        return found;
      }
    }
    return undefined;
  };

  const found = walk(routeTable);
  if (found == null) {
    throw new Error(`route "${path}" is not registered in the route table`);
  }
  return found;
}

type LazyEntry = {
  path: string;
  lazy: () => Promise<{ Component: unknown }>;
};

/** Every lazily-loaded route in the table, at any depth. */
function lazyRoutes(nodes: RouteNode[] = routeTable): LazyEntry[] {
  return nodes.flatMap((node) => [
    ...(typeof node.lazy === 'function' && node.path != null
      ? [{ path: node.path, lazy: node.lazy }]
      : []),
    ...lazyRoutes(node.children ?? []),
  ]);
}

describe('feature route table wiring', () => {
  it.each(FEATURE_ROUTES)(
    'resolves /$path to its own route module rather than a sibling capability',
    async ({ path, Component }) => {
      const { node } = locate(path);

      expect(typeof node.lazy).toBe('function');
      const loaded = await (node.lazy as () => Promise<{ Component: unknown }>)();

      expect(loaded.Component).toBe(Component);
    },
  );

  it.each(FEATURE_ROUTES)(
    'mounts /$path in the same authenticated branch as the chat routes',
    ({ path }) => {
      const { siblings } = locate(path);

      /* Sharing a branch with the chat routes is what puts the page behind the
       * auth gate and the app shell. A feature page registered at the top level
       * would render outside both, and `path` would not appear here. */
      expect(siblings).toEqual(expect.arrayContaining(['search', 'c/:conversationId?', 'skills']));
      expect(routeTable.map((route) => route.path)).not.toContain(path);
    },
  );

  it('registers each feature module exactly once, at the path it owns', async () => {
    /* The inverse of the test above, and the half that catches a duplicated
     * registration: two paths sharing one module, or a module reachable from a
     * path that is not its own, both leave a component listed under more than
     * one path here. */
    const registered = await Promise.all(
      lazyRoutes().map(async ({ path, lazy }) => ({
        path,
        Component: (await lazy()).Component,
      })),
    );

    for (const { path, Component } of FEATURE_ROUTES) {
      const paths = registered
        .filter((entry) => entry.Component === Component)
        .map((entry) => entry.path);

      expect(paths).toEqual([path]);
    }
  });
});

describe('feature route shells mount', () => {
  it('mounts /canvas with its heading, landmark and the sample document', () => {
    render(<CanvasRoute />);

    expect(screen.getByRole('region', { name: CANVAS_LABELS.featureTitle })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: CANVAS_LABELS.featureTitle })).toBeInTheDocument();

    /* The route owns the injected document: with none, the workspace renders its
     * empty state instead, and this sample text is what proves the prop arrived. */
    expect(screen.getAllByText('Canvas workspace').length).toBeGreaterThan(0);
    expect(screen.queryByText(CANVAS_LABELS.emptyTitle)).not.toBeInTheDocument();
    expect(screen.queryByText(CANVAS_LABELS.loading)).not.toBeInTheDocument();
  });

  it('mounts /voice with its heading and the state for a browser without WebRTC', () => {
    /* jsdom has no `RTCPeerConnection`, which is the "no transport injected,
     * no WebRTC available" case a real unsupported browser hits: the route has to
     * say so rather than throw on mount. */
    render(<VoiceRoute />);

    expect(screen.getByRole('region', { name: VOICE_LABELS.title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: VOICE_LABELS.title })).toBeInTheDocument();
    expect(screen.getByText(VOICE_LABELS.unsupportedTitle)).toBeInTheDocument();
  });

  it('mounts /workflow with the editor and run panel sharing the injected executor', () => {
    render(<WorkflowRoute />);

    expect(screen.getByTestId('workflow-editor')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-run-panel')).toBeInTheDocument();
    /* The executor is a required prop, so the run panel reaching its idle state
     * rather than throwing is the assertion that the route passed one. */
    expect(screen.getByText(WORKFLOW_LABELS.noStepsTitle)).toBeInTheDocument();
  });

  it('mounts /data-lab with its heading and the empty state for an unwired dataset', () => {
    render(<DataLabRoute />);

    const title = t(DATA_LAB_LABELS.title);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    /* The route must expose a landmark, like Canvas, Voice and Deep Research. */
    expect(screen.getByRole('region', { name: title })).toBeInTheDocument();
    expect(screen.getByText(t(DATA_LAB_LABELS.emptyTitle))).toBeInTheDocument();
  });

  it('mounts /deep-research with its heading, landmark and the topic entry surface', () => {
    render(<DeepResearchRoute />);

    const title = t(DEEP_RESEARCH_LABELS.featureTitle);
    expect(screen.getByRole('region', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    /* Idle is the first state of the flow, and the topic field is its only way in. */
    expect(screen.getByLabelText(t(DEEP_RESEARCH_LABELS.topicLabel))).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(t(DEEP_RESEARCH_LABELS.topicPlaceholder)),
    ).toBeInTheDocument();
  });
});
