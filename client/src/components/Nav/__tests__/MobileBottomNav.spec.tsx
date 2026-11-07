import React from 'react';
import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { cleanup, render, screen } from '@testing-library/react';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

import MobileBottomNav from '../MobileBottomNav';

/**
 * The shared setup installs a writable (not configurable) `matchMedia` whose
 * stubs assign over it, mirroring the useMediaQuery spec's convention. The
 * breakpoint claim ("only below mobile") is asserted through this polyfill.
 */
const setBreakpoint = (matches: boolean) => {
  (window as unknown as { matchMedia: unknown }).matchMedia = jest
    .fn()
    .mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
};

function renderNav(initialPath: string) {
  return render(
    <RecoilRoot>
      <MemoryRouter initialEntries={[initialPath]}>
        <MobileBottomNav />
      </MemoryRouter>
    </RecoilRoot>,
  );
}

/** Destination label (the mocked localize echoes the key), target route. */
const DESTINATIONS: [string, string][] = [
  ['com_ui_chats', '/c/new'],
  ['com_ui_projects', '/projects'],
  ['com_ui_explore', '/agents'],
  ['com_ui_knowledge', '/knowledge'],
];

describe('MobileBottomNav', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders only below the mobile breakpoint', () => {
    setBreakpoint(true);
    const below = renderNav('/c/new');
    expect(
      screen.getByRole('navigation', { name: 'com_nav_mobile_navigation' }),
    ).toBeInTheDocument();
    below.unmount();

    setBreakpoint(false);
    const above = renderNav('/c/new');
    expect(above.container).toBeEmptyDOMElement();
  });

  it('exposes the blueprint destinations as links to their existing routes', () => {
    setBreakpoint(true);
    renderNav('/c/new');

    for (const [label, path] of DESTINATIONS) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', path);
    }
  });

  it.each([
    ['/', 'com_ui_chats'],
    ['/home', 'com_ui_chats'],
    ['/c/abc123', 'com_ui_chats'],
    ['/projects', 'com_ui_projects'],
    ['/projects/xyz', 'com_ui_projects'],
    ['/agents', 'com_ui_explore'],
    ['/agents/broadcasts', 'com_ui_explore'],
    ['/knowledge', 'com_ui_knowledge'],
    ['/knowledge/xyz', 'com_ui_knowledge'],
    ['/c/new', 'com_ui_chats'],
  ])('marks %s as the %s destination', (pathname, expected) => {
    setBreakpoint(true);
    renderNav(pathname);

    const active = screen.getByRole('link', { name: expected });
    expect(active).toHaveAttribute('aria-current', 'page');
    for (const [label] of DESTINATIONS) {
      if (label !== expected) {
        expect(screen.getByRole('link', { name: label })).not.toHaveAttribute('aria-current');
      }
    }
  });

  it('leaves no destination active on a route outside the bar', () => {
    setBreakpoint(true);
    renderNav('/search');

    const current = DESTINATIONS.filter(([label]) =>
      screen.getByRole('link', { name: label }).getAttribute('aria-current'),
    );
    expect(current).toEqual([]);
  });

  it('navigates to the destination route on tap', async () => {
    setBreakpoint(true);
    renderNav('/c/new');
    const user = userEvent.setup();

    await user.click(screen.getByRole('link', { name: 'com_ui_projects' }));

    expect(screen.getByRole('link', { name: 'com_ui_projects' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'com_ui_chats' })).not.toHaveAttribute('aria-current');
  });

  it('keeps every touch target at the full bar height (44px floor)', () => {
    setBreakpoint(true);
    renderNav('/c/new');

    for (const [label] of DESTINATIONS) {
      expect(screen.getByRole('link', { name: label })).toHaveClass('h-14');
    }
  });
});
