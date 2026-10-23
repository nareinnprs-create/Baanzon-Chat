import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NavLink } from '~/common';
import useUnifiedSidebarLinks from '~/hooks/Nav/useUnifiedSidebarLinks';

/** The icon rail is the only entry point to a capability that has no other link,
 *  so "is this feature reachable" is a question about the links this hook builds.
 *  Everything the hook reads is stubbed to a settled, non-loading answer: the
 *  links must not depend on a query that is still in flight. */
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockPathname }),
}));
jest.mock('recoil', () => ({ useRecoilValue: () => undefined }));
jest.mock('librechat-data-provider/react-query', () => ({
  useUserKeyQuery: () => ({ data: {} }),
}));
jest.mock('~/components/UnifiedSidebar/ConversationsSection', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('~/hooks/AuthContext', () => ({
  AuthContextProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('~/hooks/Nav/useSideNavLinks', () => ({
  __esModule: true,
  default: () => [],
}));
/* `~/hooks` and `~/data-provider` are mocked to the exact calls this hook makes.
 * Spreading `requireActual` over either one deadlocks on their import cycle
 * (`data-provider` → `hooks/Audio` → `data-provider`) and hands the barrel back
 * half-built, which fails on an unrelated export rather than on this hook. */
jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: { id: 'user-1' } }),
}));
jest.mock('~/store', () => ({
  __esModule: true,
  default: { conversationEndpointByIndex: () => 'openAI' },
}));
jest.mock('~/data-provider', () => ({
  useGetStartupConfig: jest.fn(() => ({ data: { insightsEnabled: false } })),
  useGetEndpointsQuery: jest.fn(() => ({ data: {} })),
  useInsightsAccessQuery: jest.fn(() => ({ data: undefined, isLoading: false })),
  useKnowledgeCollectionsEnabledQuery: jest.fn(() => ({ disabled: false, isLoading: false })),
}));

let mockPathname = '/';
const mockNavigate = jest.fn();

/** Each capability, the rail entry that reaches it, and the translation key the
 *  rail shows. The key is asserted rather than the rendered English because the
 *  rail's only text is that label: a hardcoded string here is an unlocalizable
 *  entry point. */
const FEATURE_LINKS: { id: string; path: string; title: string }[] = [
  { id: 'canvas', path: '/canvas', title: 'com_ui_canvas_title' },
  { id: 'voice', path: '/voice', title: 'com_ui_voice_title' },
  { id: 'workflow', path: '/workflow', title: 'com_ui_workflow_title' },
  { id: 'data-lab', path: '/data-lab', title: 'com_ui_data_lab_title' },
  { id: 'deep-research', path: '/deep-research', title: 'com_ui_deep_research_feature_title' },
];

function renderLinks(pathname = '/') {
  mockPathname = pathname;
  return renderHook(() => useUnifiedSidebarLinks()).result.current as NavLink[];
}

function linkFor(links: NavLink[], id: string): NavLink | undefined {
  return links.find((link) => link.id === id);
}

describe('feature navigation entry points', () => {
  it.each(FEATURE_LINKS)('offers $id in the rail as $title', ({ id, title }) => {
    const link = linkFor(renderLinks(), id);

    expect(link).toBeDefined();
    expect(link?.title).toBe(title);
    expect(link?.label).toBe('');
    expect(link?.icon).toBeDefined();
    /* Navigation rather than a panel: the capability has a page of its own, so
     * the rail entry belongs beside the other route links. */
    expect(link?.Component).toBeUndefined();
  });

  it.each(FEATURE_LINKS)('navigates to $path when the $id entry is used', ({ id, path }) => {
    const link = linkFor(renderLinks(), id);

    link?.onClick?.();

    expect(mockNavigate).toHaveBeenCalledWith(path);
  });

  it.each(FEATURE_LINKS)('drops the $id entry while already on $path', ({ id, path }) => {
    /* An entry for the page you are on is a dead click: the hook hides it, so
     * the rail carries exactly one way into each capability. */
    const link = linkFor(renderLinks(path), id);

    expect(link).toBeUndefined();
  });

  it('keeps every capability reachable from one place, with no duplicate ids', () => {
    const ids = renderLinks().map((link) => link.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const { id } of FEATURE_LINKS) {
      expect(ids).toContain(id);
    }
  });

  it('keeps the feature entries while the knowledge probe is still loading', () => {
    /* The knowledge probe is the one query the rail waits on and the feature
     * entries are inserted around its result, so a probe still in flight must
     * not take the five entries down with it. */
    const { useKnowledgeCollectionsEnabledQuery } = jest.requireMock('~/data-provider');
    useKnowledgeCollectionsEnabledQuery.mockReturnValueOnce({
      disabled: false,
      isLoading: true,
    });

    const ids = renderLinks().map((link) => link.id);

    for (const { id } of FEATURE_LINKS) {
      expect(ids).toContain(id);
    }
  });
});
