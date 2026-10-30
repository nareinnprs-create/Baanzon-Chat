import type { EntitlementRow, EntitlementStore } from './types';
import {
  createEntitlementService,
  resolveLimitsMatrix,
  resolvePlanLimits,
  assertWithinLimit,
  EntitlementLimitError,
} from './service';

function row(overrides: Partial<EntitlementRow> = {}): EntitlementRow {
  return {
    plan: 'free',
    resource: 'tokens',
    scope: 'global',
    scopeId: null,
    limit: 1000,
    ...overrides,
  };
}

function twoRowStore(rowsForGet?: EntitlementRow[]): EntitlementStore {
  return {
    listPlanEntitlements: jest.fn().mockResolvedValue(rowsForGet ?? []),
    upsertPlanEntitlement: jest
      .fn()
      .mockImplementation((input) =>
        Promise.resolve({ ...input, scopeId: input.scopeId ?? null } as EntitlementRow),
      ),
  };
}

describe('resolvePlanLimits', () => {
  it('falls back to unlimited for every resource when nothing is set', () => {
    const limits = resolvePlanLimits(undefined, [], 'free');
    expect(Object.values(limits).every((limit) => limit === -1)).toBe(true);
    expect(Object.keys(limits).sort()).toEqual([
      'agentCompute',
      'media',
      'search',
      'storage',
      'tokens',
      'voice',
      'workflowExecutions',
    ]);
  });

  it('applies config levers for the named plan only, over the defaults', () => {
    const limits = resolvePlanLimits(
      { free: { tokens: 50000 }, pro: { tokens: 999999 } },
      [],
      'free',
    );
    expect(limits.tokens).toBe(50000);
    expect(limits.storage).toBe(-1);
  });

  it('lets a global DB entitlement outrank both the default and the config lever', () => {
    const entitlements = [row({ resource: 'tokens', scope: 'global', limit: 10 })];
    const limits = resolvePlanLimits({ free: { tokens: 50000 } }, entitlements, 'free');
    expect(limits.tokens).toBe(10);
  });

  it('lets an organization entitlement outrank a global one for the same plan', () => {
    const entitlements = [
      row({ resource: 'tokens', scope: 'global', limit: 10 }),
      row({ resource: 'tokens', scope: 'organization', scopeId: 'org-1', limit: 100 }),
    ];
    expect(resolvePlanLimits(undefined, entitlements, 'free').tokens).toBe(100);
  });

  it('keeps other plans untouched by rows for a different plan', () => {
    const entitlements = [row({ plan: 'pro', resource: 'tokens', scope: 'global', limit: 5 })];
    expect(resolvePlanLimits(undefined, entitlements, 'free').tokens).toBe(-1);
    expect(resolvePlanLimits(undefined, entitlements, 'pro').tokens).toBe(5);
  });

  it('ignores unknown resources and out-of-range limits instead of surfacing garbage', () => {
    const entitlements = [
      row({ resource: 'quantum' as never, scope: 'global', limit: 10 }),
      row({ resource: 'storage', scope: 'global', limit: -7 }),
      row({ resource: 'search', scope: 'global', limit: 3 }),
    ];
    const limits = resolvePlanLimits(undefined, entitlements, 'free');
    expect(limits.storage).toBe(-1);
    expect(limits.search).toBe(3);
  });

  it('ignores non-numeric config lever values (schema rejects them upstream)', () => {
    const bad = { free: { tokens: 'lots' } } as unknown as { free?: { tokens?: number } };
    expect(resolvePlanLimits(bad, [], 'free').tokens).toBe(-1);
  });
});

describe('resolveLimitsMatrix', () => {
  it('resolves every plan and layers rows per plan', () => {
    const entitlements = [
      row({ plan: 'free', resource: 'tokens', scope: 'global', limit: 10 }),
      row({ plan: 'pro', resource: 'search', scope: 'global', limit: 200 }),
    ];
    const matrix = resolveLimitsMatrix(undefined, entitlements);
    expect(Object.keys(matrix).sort()).toEqual(['basic', 'enterprise', 'free', 'pro']);
    expect(matrix.free.tokens).toBe(10);
    expect(matrix.pro.search).toBe(200);
    expect(matrix.basic.tokens).toBe(-1);
  });
});

describe('assertWithinLimit', () => {
  it('allows usage below a non-negative limit', () => {
    expect(() => assertWithinLimit({ resource: 'tokens', limit: 100, used: 99 })).not.toThrow();
  });

  it('throws an EntitlementLimitError carrying resource/limit/used when usage has no headroom', () => {
    try {
      assertWithinLimit({ resource: 'tokens', limit: 100, used: 100, principal: 'user-1' });
      throw new Error('expected assertWithinLimit to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EntitlementLimitError);
      const limitError = error as EntitlementLimitError;
      expect(limitError.resource).toBe('tokens');
      expect(limitError.limit).toBe(100);
      expect(limitError.used).toBe(100);
      expect(limitError.principal).toBe('user-1');
      expect(limitError.message).toContain('tokens');
    }
  });

  it('allows any usage when the limit is unlimited (-1)', () => {
    expect(() => assertWithinLimit({ resource: 'tokens', limit: -1, used: 1000000 })).not.toThrow();
  });

  it('treats a non-finite limit as unlimited rather than as a cap', () => {
    expect(() =>
      assertWithinLimit({ resource: 'tokens', limit: Number.NaN, used: 5 }),
    ).not.toThrow();
  });
});

describe('createEntitlementService', () => {
  it('resolveEntitlements reads the store once and resolves config + rows', async () => {
    const store = twoRowStore([
      row({ plan: 'free', resource: 'tokens', scope: 'global', limit: 250 }),
    ]);
    const service = createEntitlementService({ store });

    const matrix = await service.resolveEntitlements({
      config: { pro: { tokens: 999 } },
      organizationId: '64b64b64b64b64b64b64b640',
    });

    expect(store.listPlanEntitlements).toHaveBeenCalledWith('64b64b64b64b64b64b64b640');
    expect(matrix.free.tokens).toBe(250);
    expect(matrix.pro.tokens).toBe(999);
  });

  it('resolveEntitlements without an organization reads global rows only', async () => {
    const store = twoRowStore([]);
    const service = createEntitlementService({ store });

    await service.resolveEntitlements({ config: {} });
    expect(store.listPlanEntitlements).toHaveBeenCalledWith(undefined);
  });

  it('setEntitlement forwards to the store upsert (the only sanctioned write path)', async () => {
    const store = twoRowStore();
    const service = createEntitlementService({ store });

    const result = await service.setEntitlement({
      plan: 'pro',
      resource: 'workflowExecutions',
      scope: 'organization',
      scopeId: '64b64b64b64b64b64b64b640',
      limit: 25,
    });

    expect(store.upsertPlanEntitlement).toHaveBeenCalledWith({
      plan: 'pro',
      resource: 'workflowExecutions',
      scope: 'organization',
      scopeId: '64b64b64b64b64b64b64b640',
      limit: 25,
    });
    expect(result.plan).toBe('pro');
    expect(result.limit).toBe(25);
  });
});
