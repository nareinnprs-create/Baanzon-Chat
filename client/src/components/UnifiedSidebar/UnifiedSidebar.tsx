import { useCallback, useState, useEffect, useRef, memo } from 'react';
import { useForm } from 'react-hook-form';
import { useMediaQuery } from '@librechat/client';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { ChatFormValues } from '~/common';
import {
  COLLAPSED_WIDTH,
  EXPANDED_MIN,
  TRANSITION_MS,
  EASING,
  MOBILE_DRAWER_TRANSITION,
  DRAWER_Z_INDEX,
  MOBILE_DRAWER_ID,
  MOBILE_DRAWER_WIDTH,
} from './constants';
import { ChatContext, ChatFormProvider, ActivePanelProvider } from '~/Providers';
import { MobileHeader, MobileBottomBar, MobileShortcutTargets } from './mobile';
import useUnifiedSidebarLinks from '~/hooks/Nav/useUnifiedSidebarLinks';
import useSidebarToggle from '~/hooks/Nav/useSidebarToggle';
import useSidebarState from '~/hooks/Nav/useSidebarState';
import { useChatHelpers, useLocalize } from '~/hooks';
import { useInterfaceMode } from '~/store/settings';
import SidePanelNav from '~/components/SidePanel/Nav';
import Sidebar from './Sidebar';
import { cn } from '~/utils';

function getInitialWidth(): number {
  const saved = localStorage.getItem('side:width');
  return saved ? Math.max(Number(saved), EXPANDED_MIN) : EXPANDED_MIN;
}

/** Atelier (Monolith) rail: the collapsed 52px strip becomes a fixed 64px
 *  rail that expands to a 280px panel on hover or click. Widths live here so
 *  the inline width/min/max triple stays in one place; tone stays in CSS
 *  under [data-atelier]. */
const ATELIER_RAIL_COLLAPSED = 64;
const ATELIER_RAIL_EXPANDED = 280;
const ATELIER_RAIL_TRANSITION = 'width 200ms ease, min-width 200ms ease, max-width 200ms ease';
const noop = () => undefined;

/**
 * Isolates useChatHelpers Recoil subscriptions from the sidebar layout.
 * Atom changes (e.g. during streaming) only re-render this component
 * and the active panel — not the sidebar shell, resize logic, or icon strip.
 * This works because Recoil subscriptions don't propagate to parent components.
 */
function SidebarChatProvider({ children }: { children: ReactNode }) {
  const chatHelpers = useChatHelpers(0);
  const sidebarFormMethods = useForm<ChatFormValues>({ defaultValues: { text: '' } });
  return (
    <ChatFormProvider {...sidebarFormMethods}>
      <ChatContext.Provider value={chatHelpers}>{children}</ChatContext.Provider>
    </ChatFormProvider>
  );
}

function UnifiedSidebar() {
  const localize = useLocalize();
  const location = useLocation();
  const navigate = useNavigate();
  const { isSmallScreen, expanded } = useSidebarState();
  const { setSidebarOpen } = useSidebarToggle();
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [sidebarWidth, setSidebarWidth] = useState(getInitialWidth);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [isResizing, setIsResizing] = useState(false);
  const resizeHandlers = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);

  const links = useUnifiedSidebarLinks();
  const isInsightsRoute = location.pathname.startsWith('/insights');
  const panelExpanded = expanded && !isInsightsRoute;
  /** Atelier rail only restyles the desktop sidebar; the mobile drawer below
   *  is untouched, and the drag-resize state machine is never engaged. */
  const atelierRail = useInterfaceMode() === 'atelier';
  const railWidth = panelExpanded ? ATELIER_RAIL_EXPANDED : ATELIER_RAIL_COLLAPSED;

  /** The aside's max width is a viewport percentage, so the announced range has to track
   *  the viewport rather than a render-time snapshot of it. */
  useEffect(() => {
    const handleViewportResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, []);

  /** Mirrors the bounds the aside is rendered with, so the handle never announces a value
   *  outside its own range. CSS resolves a 40% that falls under `min-width` in favor of the
   *  minimum, and the resize handlers clamp the same way, so the floor belongs here too. */
  const resizeMax = Math.max(EXPANDED_MIN, Math.round(viewportWidth * 0.4));
  const resizeNow = panelExpanded
    ? Math.min(Math.max(sidebarWidth, EXPANDED_MIN), resizeMax)
    : COLLAPSED_WIDTH;

  const handleCollapse = useCallback(
    (afterSlide?: () => void) => {
      setSidebarOpen(false, afterSlide);
    },
    [setSidebarOpen],
  );

  const handleExpand = useCallback(() => {
    setSidebarOpen(true);
  }, [setSidebarOpen]);

  const handleLeaveInsights = useCallback(() => {
    navigate('/c/new');
  }, [navigate]);

  const handlePanelExpand = useCallback(() => {
    if (isInsightsRoute) {
      handleLeaveInsights();
    }
    handleExpand();
  }, [handleExpand, handleLeaveInsights, isInsightsRoute]);

  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
    document.body.style.userSelect = 'none';
    const maxWidth = window.innerWidth * 0.4;
    let rafId: number | null = null;

    const move = (e: MouseEvent) => {
      if (rafId != null) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const next = Math.max(EXPANDED_MIN, Math.min(e.clientX, maxWidth));
        setSidebarWidth(next);
      });
    };

    const up = () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      document.body.style.userSelect = '';
      setIsResizing(false);
      resizeHandlers.current = null;
      setSidebarWidth((w) => {
        localStorage.setItem('side:width', String(Math.round(w)));
        return w;
      });
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };

    resizeHandlers.current = { move, up };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, []);

  const handleResizeKeyboard = useCallback((direction: 'shrink' | 'grow') => {
    setSidebarWidth((w) => {
      const next =
        direction === 'shrink'
          ? Math.max(w - 20, EXPANDED_MIN)
          : Math.min(w + 20, window.innerWidth * 0.4);
      localStorage.setItem('side:width', String(Math.round(next)));
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (resizeHandlers.current) {
        document.removeEventListener('mousemove', resizeHandlers.current.move);
        document.removeEventListener('mouseup', resizeHandlers.current.up);
      }
    };
  }, []);

  useEffect(() => {
    if (!isSmallScreen || !expanded) {
      return;
    }
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        return;
      }
      /**
       * Menus opened from the drawer portal out of it, so their Escape still
       * reaches this listener. Dismissing the whole drawer would skip the level
       * the user meant to leave.
       *
       * Presence alone is not the signal: not every menu unmounts when closed —
       * the account menu stays mounted and merely `hidden` — so matching those
       * too would suppress Escape for the drawer permanently.
       */
      if (document.querySelector('[role="menu"]:not([hidden])') != null) {
        return;
      }
      handleCollapse();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isSmallScreen, expanded, handleCollapse]);

  if (isSmallScreen) {
    return (
      <div
        id={MOBILE_DRAWER_ID}
        className={cn(
          /** The close swipe reads horizontal touches here (the drawer holds no
           * horizontal scrollers), while pinch-zoom stays with the browser —
           * this full-viewport surface must not disable zooming entirely. */
          'fixed inset-y-0 left-0 flex touch-pan-y touch-pinch-zoom flex-col bg-surface-primary-alt',
          expanded ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{
          width: MOBILE_DRAWER_WIDTH,
          /** The strip setting changes the width without passing through the
           *  snap path, so the preference has to reach the declarative style
           *  too or that one change still animates. */
          transition: prefersReducedMotion ? undefined : MOBILE_DRAWER_TRANSITION,
          zIndex: DRAWER_Z_INDEX,
        }}
        inert={!expanded ? '' : undefined}
      >
        <SidebarChatProvider>
          <ActivePanelProvider>
            <MobileHeader
              links={links}
              expanded={expanded}
              onClose={handleCollapse}
              onLeaveInsights={handleLeaveInsights}
              routeActiveId={isInsightsRoute ? 'insights' : undefined}
            />
            <nav
              id="chat-history-nav"
              className="min-h-0 flex-1 overflow-hidden bg-surface-primary-alt"
            >
              <SidePanelNav links={links} />
            </nav>
            <MobileShortcutTargets
              links={links}
              onLeaveInsights={handleLeaveInsights}
              routeActiveId={isInsightsRoute ? 'insights' : undefined}
            />
            <MobileBottomBar links={links} onNewChat={handleCollapse} />
          </ActivePanelProvider>
        </SidebarChatProvider>
      </div>
    );
  }

  return (
    <SidebarChatProvider>
      <ActivePanelProvider>
        <aside
          className="relative flex h-full flex-shrink-0 overflow-hidden"
          style={{
            width: atelierRail ? railWidth : panelExpanded ? sidebarWidth : COLLAPSED_WIDTH,
            minWidth: atelierRail
              ? railWidth
              : panelExpanded
                ? EXPANDED_MIN
                : COLLAPSED_WIDTH,
            maxWidth: atelierRail ? railWidth : panelExpanded ? '40%' : COLLAPSED_WIDTH,
            transition: atelierRail
              ? prefersReducedMotion
                ? undefined
                : ATELIER_RAIL_TRANSITION
              : isResizing
                ? 'none'
                : `width ${TRANSITION_MS}ms ${EASING}, min-width ${TRANSITION_MS}ms ${EASING}, max-width ${TRANSITION_MS}ms ${EASING}`,
          }}
          aria-label={localize('com_nav_control_panel')}
          /** The rail expands on hover as well as click; the click path (rail
           *  icons, toggle button) is the existing state machine untouched. */
          onMouseEnter={atelierRail && !panelExpanded ? handleExpand : undefined}
          onMouseLeave={atelierRail && panelExpanded ? () => handleCollapse() : undefined}
        >
          <Sidebar
            links={links}
            expanded={panelExpanded}
            width={atelierRail ? railWidth : resizeNow}
            minWidth={atelierRail ? railWidth : panelExpanded ? EXPANDED_MIN : COLLAPSED_WIDTH}
            maxWidth={atelierRail ? railWidth : panelExpanded ? resizeMax : COLLAPSED_WIDTH}
            onCollapse={handleCollapse}
            onExpand={handlePanelExpand}
            onLeaveInsights={handleLeaveInsights}
            /** The rail is hover-resized, not drag-resized: the separator is
             *  hidden in CSS under [data-atelier], so the handlers are inert. */
            onResizeStart={atelierRail ? noop : handleResizeStart}
            onResizeKeyboard={atelierRail ? noop : handleResizeKeyboard}
          />
        </aside>
      </ActivePanelProvider>
    </SidebarChatProvider>
  );
}

export default memo(UnifiedSidebar);
