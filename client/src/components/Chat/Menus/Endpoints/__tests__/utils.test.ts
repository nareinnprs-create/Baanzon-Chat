import type { useLocalize } from '~/hooks';
import type { Endpoint } from '~/common';
import { filterItems, getBrandedEndpoints } from '../utils';

const agentsEndpoint: Endpoint = {
  value: 'agents',
  label: 'My Agents',
  hasModels: true,
  icon: null,
  showMarketplace: true,
  searchAliases: ['agent marketplace', 'marketplace'],
};

const disabledAgentsEndpoint: Endpoint = {
  value: 'agents',
  label: 'My Agents',
  hasModels: false,
  icon: null,
};

describe('model selector utilities', () => {
  it('matches endpoint search aliases', () => {
    const results = filterItems([agentsEndpoint], 'marketplace', undefined, undefined);
    expect(results).toEqual([agentsEndpoint]);
  });

  it('matches localized Marketplace labels', () => {
    const localize = ((key: string) => {
      if (key === 'com_agents_marketplace') {
        return 'Tienda de Agentes';
      }
      if (key === 'com_ui_marketplace') {
        return 'Tienda';
      }
      return key;
    }) as ReturnType<typeof useLocalize>;

    const results = filterItems([agentsEndpoint], 'tienda', undefined, undefined, localize);
    expect(results).toEqual([agentsEndpoint]);
  });

  it('does not match agents when there are no selectable agent options', () => {
    const results = filterItems([disabledAgentsEndpoint], 'my agents', undefined, undefined);
    expect(results).toEqual([]);
  });

  it('hides endpoints covered by the spec catalog from the picker', () => {
    const opraiz: Endpoint = {
      value: 'Opraiz',
      label: 'Opraiz',
      hasModels: true,
      icon: null,
      models: [{ name: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', isGlobal: true }],
    };
    const agents: Endpoint = { ...agentsEndpoint };
    const specs = [
      { name: 'baanzon-intelligence', label: 'Baanzon Intelligence', preset: { endpoint: 'Opraiz', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' } },
    ] as never as Parameters<typeof getBrandedEndpoints>[0];

    expect(getBrandedEndpoints(specs, [opraiz, agents])).toEqual([agents]);
    // No specs -> nothing is hidden
    expect(getBrandedEndpoints([], [opraiz, agents])).toEqual([opraiz, agents]);
    expect(getBrandedEndpoints(undefined, [opraiz, agents])).toEqual([opraiz, agents]);
  });
});
