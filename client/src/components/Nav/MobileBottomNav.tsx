import { memo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bot, Folder, LibraryBig, MessagesSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import useSidebarState from '~/hooks/Nav/useSidebarState';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * B25 (masterblueprint §72, "Mobile UI"): the bottom bar carries the surfaces
 * that survive a one-handed reach — chat, projects, the agent marketplace
 * (Explore) and the knowledge library. Profile and settings stay secondary
 * surfaces in the drawer, per the same section, so the bar holds exactly these
 * destinations and nothing else.
 *
 * Home — the first destination §72 lists — is deliberately not a separate tab:
 * `/home` is a redirect alias of `/c/new` (routes/index.tsx), so a Home tab and
 * a Chats tab would be two labels for one URL. The Chats tab carries the
 * landing surface instead, and is active on `/`, `/home` and `/c/*`.
 */
export const MOBILE_BOTTOM_NAV_HEIGHT = 56; // h-14, above the 44px touch floor

/** Hosts without a home indicator resolve this to 0px. */
const SAFE_AREA_INSET = 'env(safe-area-inset-bottom, 0px)';

/**
 * How much vertical room the chat pane must reserve while the bar is mounted,
 * so the composer and every route's footer are never occluded by it. Read by
 * `Root`, which owns the pane.
 */
export const MOBILE_BOTTOM_NAV_RESERVATION = `calc(${MOBILE_BOTTOM_NAV_HEIGHT}px + ${SAFE_AREA_INSET})`;

type Destination = {
  id: string;
  to: string;
  title: TranslationKeys;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
};

/**
 * Routes over labels: every destination targets a route that already exists
 * (see routes/index.tsx) and the icon mirrors what the desktop rail shows for
 * the same surface (useUnifiedSidebarLinks / useSideNavLinks).
 */
const DESTINATIONS: Destination[] = [
  {
    id: 'chats',
    to: '/c/new',
    title: 'com_ui_chats',
    icon: MessagesSquare,
    isActive: (pathname) => pathname === '/' || pathname === '/home' || pathname.startsWith('/c/'),
  },
  {
    id: 'projects',
    to: '/projects',
    title: 'com_ui_projects',
    icon: Folder,
    isActive: (pathname) => pathname.startsWith('/projects'),
  },
  {
    id: 'explore',
    to: '/agents',
    title: 'com_ui_explore',
    icon: Bot,
    isActive: (pathname) => pathname.startsWith('/agents'),
  },
  {
    id: 'library',
    to: '/knowledge',
    title: 'com_ui_knowledge',
    icon: LibraryBig,
    isActive: (pathname) => pathname.startsWith('/knowledge'),
  },
];

function MobileBottomNav() {
  const localize = useLocalize();
  const { pathname } = useLocation();
  /** The same shared reader the drawer uses, so the bar and the drawer can
   *  never disagree about which shell is up. */
  const { isSmallScreen, expanded } = useSidebarState();

  if (!isSmallScreen) {
    return null;
  }

  return (
    <nav
      data-testid="mobile-bottom-nav"
      aria-label={localize('com_nav_mobile_navigation')}
      /** Under the drawer (`DRAWER_Z_INDEX` = 110) and its scrim (109) so the
       *  open drawer layers over the bar; above the `relative z-0` shell. */
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border-light bg-surface-primary"
      style={{ paddingBottom: SAFE_AREA_INSET }}
      /** With the drawer open on top of the bar, the covered tabs must leave
       *  the tab order — the same bracket the pane's own `inert` uses. */
      inert={expanded ? '' : undefined}
    >
      {DESTINATIONS.map(({ id, to, title, icon: Icon, isActive }) => {
        const active = isActive(pathname);
        return (
          <Link
            key={id}
            to={to}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-primary',
              active ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary',
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
            <span>{localize(title)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default memo(MobileBottomNav);
