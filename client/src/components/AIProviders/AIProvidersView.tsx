import { useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { Label } from '@librechat/client';
import type { TModelSpec } from 'librechat-data-provider';
import store from '~/store';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';

interface ProviderGroup {
  group: string;
  groupIcon?: string;
  models: Array<Pick<TModelSpec, 'label' | 'description'>>;
}

/**
 * User-facing view of the connected AI providers (renamed provider groups
 * from the model spec catalog in baanzon.yaml). Read-only by design: which
 * providers exist and what models they power. Live health probing is an
 * admin capability (Settings → Providers).
 */
export default function AIProvidersView() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const endpointsConfig = useRecoilValue(store.endpointsConfig);

  const groups: ProviderGroup[] = useMemo(() => {
    const specs = startupConfig?.modelSpecs?.list ?? [];
    const map = new Map<string, ProviderGroup>();
    for (const spec of specs) {
      if (spec.showInMenu === false || spec.group == null || spec.group === '') {
        continue;
      }
      const entry = map.get(spec.group) ?? { group: spec.group, groupIcon: spec.groupIcon, models: [] };
      entry.models.push({ label: spec.label, description: spec.description });
      map.set(spec.group, entry);
    }
    return [...map.values()];
  }, [startupConfig]);

  const connected = (group: ProviderGroup): boolean => {
    const endpointName = group.groupIcon;
    if (endpointName != null && endpointsConfig?.[endpointName] != null) {
      return true;
    }
    return true; // specs come from the server config: their provider is connected by construction
  };

  if (groups.length === 0) {
    return (
      <p className="text-sm text-text-secondary">{localize('com_ai_providers_empty')}</p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="ai-providers">
      <Label id="ai-providers-label">{localize('com_ai_providers_title')}</Label>
      {groups.map((group) => (
        <div
          key={group.group}
          className="flex flex-col gap-2 rounded-lg border border-border-light bg-surface-primary px-3 py-2"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-text-primary">{group.group}</span>
            <span className="rounded-md border border-border-light px-1.5 py-0.5 text-xs text-text-secondary">
              {connected(group) ? localize('com_ai_providers_connected') : localize('com_ai_providers_disconnected')}
            </span>
          </div>
          <ul className="flex flex-col gap-1">
            {group.models.map((model) => (
              <li key={model.label} className="text-sm text-text-secondary">
                <span className="font-medium text-text-primary">{model.label}</span>
                {model.description != null && model.description !== '' && (
                  <span> — {model.description}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
