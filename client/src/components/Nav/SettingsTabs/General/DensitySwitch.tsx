import { Switch } from '@librechat/client';
import { useAtomValue, useSetAtom } from 'jotai';
import { useLocalize } from '~/hooks';
import { densityCompact } from '~/store/settings';

/** Blueprint §63.7: low density is the default; compact trades air for rows. */
export default function DensitySwitch() {
  const localize = useLocalize();
  const compact = useAtomValue(densityCompact);
  const setCompact = useSetAtom(densityCompact);

  return (
    <div className="flex items-center justify-between">
      <div id="density-switch-label" className="flex flex-col">
        <span>{localize('com_ui_density_compact')}</span>
        <span className="text-xs text-text-secondary">{localize('com_ui_density_compact_hint')}</span>
      </div>
      <Switch
        checked={compact}
        onCheckedChange={(checked: boolean) => setCompact(checked)}
        aria-labelledby="density-switch-label"
      />
    </div>
  );
}
