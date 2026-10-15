import { useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ThemeContext } from '@librechat/client';
import type { CommandPaletteItem } from './types';
import useNewChat from '~/hooks/Chat/useNewChat';

/**
 * Opens the existing settings dialog. Settings is a shell dialog opened from
 * the user menu rather than a route, so the palette reuses the same triggers
 * the keyboard-shortcut handler clicks instead of inventing a second opener.
 */
function openSettingsDialog() {
  const trigger = document.querySelector<HTMLElement>('[data-testid="nav-user"]');
  if (trigger == null) {
    return;
  }
  if (trigger.getAttribute('aria-expanded') !== 'true') {
    trigger.click();
    window.setTimeout(() => {
      document.querySelector<HTMLElement>('[data-testid="nav-settings"]')?.click();
    }, 150);
    return;
  }
  document.querySelector<HTMLElement>('[data-testid="nav-settings"]')?.click();
}

/** Default action set — real navigation/theme/chat wiring for the palette host. */
export default function useCommandPaletteActions(): CommandPaletteItem[] {
  const navigate = useNavigate();
  const { startNewChat } = useNewChat();
  const { resolvedMode, setTheme } = useContext(ThemeContext);

  return useMemo<CommandPaletteItem[]>(
    () => [
      {
        id: 'new-chat',
        group: 'actions',
        labelKey: 'com_ui_command_palette_action_new_chat',
        keywords: ['new', 'chat', 'conversation', 'create'],
        run: () => {
          startNewChat();
          navigate('/c/new');
        },
      },
      {
        id: 'search-chats',
        group: 'actions',
        labelKey: 'com_ui_command_palette_action_search_chats',
        keywords: ['search', 'find', 'chats', 'conversations'],
        run: () => navigate('/search'),
      },
      {
        id: 'open-settings',
        group: 'actions',
        labelKey: 'com_ui_command_palette_action_open_settings',
        keywords: ['settings', 'preferences', 'config', 'account'],
        run: () => openSettingsDialog(),
      },
      {
        id: 'toggle-theme',
        group: 'actions',
        labelKey: 'com_ui_command_palette_action_toggle_theme',
        keywords: ['theme', 'dark', 'light', 'appearance', 'toggle'],
        run: () => setTheme(resolvedMode === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'nav-agents',
        group: 'navigation',
        labelKey: 'com_ui_command_palette_nav_agents',
        keywords: ['agents', 'marketplace', 'go', 'navigate'],
        run: () => navigate('/agents'),
      },
      {
        id: 'nav-skills',
        group: 'navigation',
        labelKey: 'com_ui_command_palette_nav_skills',
        keywords: ['skills', 'go', 'navigate'],
        run: () => navigate('/skills'),
      },
      {
        id: 'nav-knowledge',
        group: 'navigation',
        labelKey: 'com_ui_command_palette_nav_knowledge',
        keywords: ['knowledge', 'files', 'go', 'navigate'],
        run: () => navigate('/knowledge'),
      },
      {
        id: 'nav-projects',
        group: 'navigation',
        labelKey: 'com_ui_command_palette_nav_projects',
        keywords: ['projects', 'go', 'navigate'],
        run: () => navigate('/projects'),
      },
      {
        id: 'nav-insights',
        group: 'navigation',
        labelKey: 'com_ui_command_palette_nav_insights',
        keywords: ['insights', 'analytics', 'usage', 'go', 'navigate'],
        run: () => navigate('/insights'),
      },
    ],
    [navigate, resolvedMode, setTheme, startNewChat],
  );
}
