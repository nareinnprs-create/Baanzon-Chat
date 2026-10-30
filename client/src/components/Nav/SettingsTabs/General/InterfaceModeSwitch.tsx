import { Switch } from '@librechat/client';
import { useAtomValue, useSetAtom } from 'jotai';
import { interfaceMode, useInterfaceMode } from '~/store/settings';
import { useLocalize } from '~/hooks';

/**
 * User-facing toggle for the interface mode lever. Persists a local override
 * ('classic' | 'atelier') over the server default; `useInterfaceMode()` is the
 * consumer hook for the shell itself, which is not switched visually yet.
 */
export default function InterfaceModeSwitch() {
  const mode = useInterfaceMode();
  const setMode = useSetAtom(interfaceMode);
  const localize = useLocalize();
  const label = localize('com_nav_interface_atelier');
  const labelId = 'interfaceAtelier-label';

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <div id={labelId}>{label}</div>
      </div>
      <Switch
        id="interfaceAtelier"
        checked={mode === 'atelier'}
        onCheckedChange={(checked) => setMode(checked ? 'atelier' : 'classic')}
        className="ml-4"
        data-testid="interfaceAtelier"
        aria-labelledby={labelId}
      />
    </div>
  );
}
