import type { FlagOverrideRow, FlagOverrideStore } from './types';
import { createFlagService, resolveFlagMap } from './service';

function row(overrides: Partial<FlagOverrideRow> = {}): FlagOverrideRow {
  return {
    key: 'workspace.projects',
    scope: 'global',
    scopeId: null,
    value: false,
    ...overrides,
  };
}

function twoRowStore(rowsForGet?: FlagOverrideRow[]): FlagOverrideStore {
  return {
    listFlagOverrides: jest.fn().mockResolvedValue(rowsForGet ?? []),
    upsertFlagOverride: jest
      .fn()
      .mockImplementation((input) =>
        Promise.resolve({ ...input, scopeId: input.scopeId ?? null } as FlagOverrideRow),
      ),
  };
}

describe('resolveFlagMap', () => {
  it('falls back to the ship defaults when nothing is set', () => {
    expect(resolveFlagMap(undefined, [])).toEqual({
      'workspace.projects': true,
      'deepResearch.ui': true,
      'workflow.builder': true,
    });
  });

  it('applies config levers over the defaults', () => {
    expect(resolveFlagMap({ 'workspace.projects': false, 'workflow.builder': false }, [])).toEqual({
      'workspace.projects': false,
      'deepResearch.ui': true,
      'workflow.builder': false,
    });
  });

  it('lets a global DB override outrank both the default and the config lever', () => {
    const overrides = [row({ key: 'workspace.projects', scope: 'global', value: true })];
    expect(resolveFlagMap({ 'workspace.projects': false }, overrides)).toEqual({
      'workspace.projects': true,
      'deepResearch.ui': true,
      'workflow.builder': true,
    });
  });

  it('lets an organization override outrank a global one and other keys stay put', () => {
    const overrides = [
      row({ key: 'deepResearch.ui', scope: 'global', value: true }),
      row({ key: 'deepResearch.ui', scope: 'organization', value: false }),
      row({ key: 'workflow.builder', scope: 'organization', value: false }),
    ];
    const resolved = resolveFlagMap(undefined, overrides);
    expect(resolved['deepResearch.ui']).toBe(false);
    expect(resolved['workflow.builder']).toBe(false);
  });

  it('ignores unknown keys instead of surfacing garbage to callers', () => {
    const overrides = [
      row({ key: 'stale.removed.flag', scope: 'global', value: true }),
      row({ key: 'workspace.projects', scope: 'global', value: false }),
    ];
    expect(Object.keys(resolveFlagMap(undefined, overrides)).sort()).toEqual([
      'deepResearch.ui',
      'workflow.builder',
      'workspace.projects',
    ]);
    expect(resolveFlagMap(undefined, overrides)['workspace.projects']).toBe(false);
  });

  it('ignores truthy non-boolean config lever values (schema rejects them upstream)', () => {
    const bad = { 'workspace.projects': 'off' } as unknown as Partial<Record<string, boolean>>;
    expect(resolveFlagMap(bad, [])['workspace.projects']).toBe(true);
  });
});

describe('createFlagService', () => {
  it('resolveFlags reads the store once and resolves config + overrides', async () => {
    const store = twoRowStore([row({ key: 'workflow.builder', value: false })]);
    const service = createFlagService({ store });

    const flags = await service.resolveFlags({
      config: { 'deepResearch.ui': false },
      organizationId: '64b64b64b64b64b64b64b640',
    });

    expect(store.listFlagOverrides).toHaveBeenCalledWith('64b64b64b64b64b64b64b640');
    expect(flags).toEqual({
      'workspace.projects': true,
      'deepResearch.ui': false,
      'workflow.builder': false,
    });
  });

  it('resolveFlags without an organization reads global rows only', async () => {
    const store = twoRowStore([]);
    const service = createFlagService({ store });

    await service.resolveFlags({ config: {} });
    expect(store.listFlagOverrides).toHaveBeenCalledWith(undefined);
  });

  it('setFlag forwards to the store upsert (the only sanctioned write path)', async () => {
    const store = twoRowStore();
    const service = createFlagService({ store });

    const result = await service.setFlag({
      key: 'deepResearch.ui',
      scope: 'organization',
      scopeId: '64b64b64b64b64b64b64b640',
      value: true,
    });

    expect(store.upsertFlagOverride).toHaveBeenCalledWith({
      key: 'deepResearch.ui',
      scope: 'organization',
      scopeId: '64b64b64b64b64b64b64b640',
      value: true,
    });
    expect(result.key).toBe('deepResearch.ui');
  });
});
