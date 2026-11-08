import { Switch } from '@librechat/client';
import { useAtomValue, useSetAtom } from 'jotai';
import { smartRouteEnabled } from '~/store/settings';
import { useLocalize } from '~/hooks';

/**
 * X5 Smart Route toggle: when on, each send can travel with a different model
 * chosen by the fast/deep heuristic over the prompt. The model selector's
 * choice is never rewritten — routing is per-turn only.
 */
export default function SmartRouteSwitch() {
  const enabled = useAtomValue(smartRouteEnabled);
  const setEnabled = useSetAtom(smartRouteEnabled);
  const localize = useLocalize();
  const label = localize('com_nav_smart_route');
  const labelId = 'smartRoute-label';

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <div id={labelId}>{label}</div>
      </div>
      <Switch
        id="smartRoute"
        checked={enabled}
        onCheckedChange={setEnabled}
        className="ml-4"
        data-testid="smartRoute"
        aria-labelledby={labelId}
      />
    </div>
  );
}
