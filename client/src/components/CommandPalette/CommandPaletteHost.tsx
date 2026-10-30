import { useNavigate } from 'react-router-dom';
import useCommandPaletteActions from './useCommandPaletteActions';
import CommandPalette from './CommandPalette';

/**
 * Mounts the command palette once at the app shell. Kept separate from the
 * presentational component so the action list (router, theme, chat wiring) is
 * injectable and the palette itself stays testable in isolation.
 */
export default function CommandPaletteHost() {
  const items = useCommandPaletteActions();
  const navigate = useNavigate();
  return <CommandPalette items={items} onNavigate={navigate} />;
}
