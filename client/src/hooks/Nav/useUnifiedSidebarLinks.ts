import { useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, LibraryBig, MessagesSquare } from 'lucide-react';
import { useUserKeyQuery } from 'librechat-data-provider/react-query';
import { getConfigDefaults, getEndpointField } from 'librechat-data-provider';
import type { TEndpointsConfig } from 'librechat-data-provider';
import type { NavLink } from '~/common';
import { useGetEndpointsQuery, useGetStartupConfig, useInsightsAccessQuery } from '~/data-provider';
import ConversationsSection from '~/components/UnifiedSidebar/ConversationsSection';
import { useKnowledgeCollectionsEnabledQuery } from '~/data-provider';
import { useAuthContext, type TranslationKeys } from '~/hooks';
import useSideNavLinks from '~/hooks/Nav/useSideNavLinks';
import store from '~/store';

const defaultInterface = getConfigDefaults().interface;

/** The id the rail matches the active panel against, and so has to match the one
 *  `resolveActivePanel` compares with — the first link in the list when the
 *  saved panel is not among them. */
const KNOWLEDGE_PANEL_ID = 'knowledge';

/**
 * The label the rail shows while `rag.disabled` is on.
 *
 * The entry used to be removed outright, which made the page's own disabled state
 * reachable only by typing `/knowledge` — on a default install, where `rag.disabled`
 * is `true`, most users would never learn the feature exists at all. A disabled
 * entry was the obvious alternative and does not work: `NavIconButton` renders the
 * label into a `TooltipAnchor` around a `disabled` button, and a disabled button
 * takes neither pointer nor keyboard focus, so the explanation would never be
 * shown to anyone. So the entry stays present and *navigable* — the label names
 * the state before the click, and `/knowledge` carries the full "ask an
 * administrator" copy. A settings-page link was rejected in favour of this
 * because the feature has no settings surface of its own, so the link would have
 * been filed under a settings entry a user has to go looking for.
 */
const KNOWLEDGE_DISABLED_TITLE = 'com_ui_knowledge_nav_disabled' as TranslationKeys;

export default function useUnifiedSidebarLinks() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthContext();
  /** Selector instead of the full conversation atom: the links only depend on
   * the endpoint, so parameter edits and other conversation writes stay out. */
  const endpoint = useRecoilValue(store.conversationEndpointByIndex(0)) ?? undefined;
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();
  const isKnowledgeRoute = location.pathname.startsWith('/knowledge');

  const interfaceConfig = useMemo(
    () => startupConfig?.interface ?? defaultInterface,
    [startupConfig],
  );
  const insightsFeatureEnabled = startupConfig?.insightsEnabled === true;
  const isInsightsRoute = location.pathname.startsWith('/insights');
  const { data: insightsAccess, isLoading: isInsightsAccessLoading } = useInsightsAccessQuery(
    user?.id,
    {
      enabled: !!user && insightsFeatureEnabled && !isInsightsRoute,
    },
  );

  /** `rag.disabled` is the only signal knowledge has — there is no startup-config
   *  flag or permission for it — and the server answers 503 on every knowledge
   *  route when it is on, so the link's whole existence is decided by that probe.
   *  The entry waits for that answer rather than rendering a guess: `NavIconButton`
   *  takes the label from `link.title` and nothing else, so the only way to name
   *  the state before the click is to already know it, and an entry that appeared
   *  under one name and re-labelled itself a moment later would be worse than one
   *  that arrives ready. */
  const { disabled: isKnowledgeDisabled, isLoading: isKnowledgeProbeLoading } =
    useKnowledgeCollectionsEnabledQuery();

  const endpointType = useMemo(
    () => getEndpointField(endpointsConfig, endpoint, 'type'),
    [endpoint, endpointsConfig],
  );

  const userProvidesKey = useMemo(
    () => !!(endpointsConfig?.[endpoint ?? '']?.userProvide ?? false),
    [endpointsConfig, endpoint],
  );

  const { data: keyExpiry = { expiresAt: undefined } } = useUserKeyQuery(endpoint ?? '');

  const keyProvided = useMemo(
    () => (userProvidesKey ? !!(keyExpiry.expiresAt ?? '') : true),
    [keyExpiry.expiresAt, userProvidesKey],
  );

  const sideNavLinks = useSideNavLinks({
    keyProvided,
    endpoint,
    endpointType,
    interfaceConfig,
    endpointsConfig,
    includeHidePanel: false,
  });

  const links = useMemo(() => {
    const conversationLink: NavLink = {
      title: 'com_ui_chat_history',
      label: '',
      icon: MessagesSquare,
      id: 'conversations',
      Component: ConversationsSection,
    };

    const nextLinks = [...sideNavLinks];
    const insertAfterMcpBuilder = (link: NavLink) => {
      const mcpIndex = nextLinks.findIndex((next) => next.id === 'mcp-builder');
      nextLinks.splice(mcpIndex >= 0 ? mcpIndex + 1 : nextLinks.length, 0, link);
    };

    if (!isKnowledgeProbeLoading) {
      insertAfterMcpBuilder({
        /** Names the state rather than the feature while it is off: the icon rail's
         *  only text is this label (tooltip and `aria-label` alike), so it is the
         *  one place a user learns the feature exists and is unavailable before
         *  clicking anything. */
        title: isKnowledgeDisabled ? KNOWLEDGE_DISABLED_TITLE : 'com_ui_knowledge',
        label: '',
        icon: LibraryBig,
        id: KNOWLEDGE_PANEL_ID,
        onClick: () => {
          if (isKnowledgeRoute) {
            /** Already here: navigating would push a second history entry, so Back
             *  would have to be pressed twice to leave. */
            return;
          }
          if (isKnowledgeDisabled) {
            /** No `?new=1` while the switch is on: the page has nothing to create
             *  into and the parameter would only be stripped again. */
            navigate('/knowledge');
            return;
          }
          /** `?new=1` is the list page's "open the create dialog" signal, and the
           *  nav is the only entry point that reaches the knowledge feature from
           *  anywhere else in the app — landing on an empty list and having to
           *  find the button is what made the parameter look like dead code. */
          navigate('/knowledge?new=1');
        },
      });
    }

    if (
      insightsFeatureEnabled &&
      (isInsightsRoute || isInsightsAccessLoading || insightsAccess?.access === true)
    ) {
      insertAfterMcpBuilder({
        title: 'com_insights_navigation',
        label: '',
        icon: BarChart3,
        id: 'insights',
        disabled: !isInsightsRoute && isInsightsAccessLoading,
        onClick: () => {
          /** The derived flag rather than `location.pathname`: it is the same
           *  test, it is already a dependency of this memo, and reading the
           *  pathname out of the captured `location` here is the one thing that
           *  would let the memo serve a stale answer. */
          if (!isInsightsRoute) {
            navigate('/insights');
          }
        },
      });
    }

    return [conversationLink, ...nextLinks];
  }, [
    insightsAccess?.access,
    insightsFeatureEnabled,
    isInsightsAccessLoading,
    isInsightsRoute,
    isKnowledgeDisabled,
    isKnowledgeProbeLoading,
    isKnowledgeRoute,
    navigate,
    sideNavLinks,
  ]);

  return links;
}
