import { applyCustomEndpointsLevers, filterCustomEndpoints } from './guards';

describe('filterCustomEndpoints', () => {
  const list = ['a', 'b', 'c'].map((name) => ({
    name,
    apiKey: 'sk-x',
    baseURL: `https://${name}.example.com/v1`,
    models: { default: [{ name: 'm1' }] },
  }));

  it('passes the list through when no levers are configured (defaults preserve behavior)', () => {
    const { endpoints, levers } = filterCustomEndpoints(list);
    expect(endpoints).toHaveLength(3);
    expect(levers).toEqual({ enabled: true, maxUpstreams: 8 });
  });

  it('returns an empty list when enabled is false', () => {
    const { endpoints, levers } = filterCustomEndpoints(list, { enabled: false });
    expect(endpoints).toHaveLength(0);
    expect(levers.enabled).toBe(false);
  });

  it('caps the list at maxUpstreams and warns about the clamp', () => {
    const { endpoints, levers } = filterCustomEndpoints(list, { maxUpstreams: 2 });
    expect(endpoints.map((e) => e.name)).toEqual(['a', 'b']);
    expect(levers.clampedFrom).toBe(3);
  });

  it('falls back to the default cap for invalid maxUpstreams', () => {
    const { levers } = filterCustomEndpoints(list, { maxUpstreams: 0 });
    expect(levers.maxUpstreams).toBe(8);
    expect(levers.clampedFrom).toBeUndefined();
  });

  it('treats a non-array payload conservatively', () => {
    expect(filterCustomEndpoints(undefined).endpoints).toEqual([]);
    expect(filterCustomEndpoints('nope').endpoints).toEqual([]);
  });
});

describe('applyCustomEndpointsLevers', () => {
  it('reads the levers and endpoints from the app config', () => {
    const { endpoints } = applyCustomEndpointsLevers({
      config: { customEndpoints: { maxUpstreams: 1 } },
      endpoints: { custom: [{ name: 'a' }] },
    });
    expect(endpoints).toHaveLength(1);
  });
});
