import { createWorkflowScheduler } from './scheduler';

describe('scheduler', () => {
  it('manual returns null', () => {
    const scheduler = createWorkflowScheduler({
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(scheduler.nextRun({ type: 'manual' })).toBeNull();
    expect(scheduler.isDue({ type: 'manual' }, null)).toBe(false);
  });

  it('once returns at if future', () => {
    const scheduler = createWorkflowScheduler({
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const next = scheduler.nextRun({ type: 'once', at: '2026-01-01T00:05:00.000Z' });
    expect(next?.toISOString()).toBe('2026-01-01T00:05:00.000Z');
  });

  it('once returns null if past', () => {
    const scheduler = createWorkflowScheduler({
      clock: () => new Date('2026-01-01T00:10:00.000Z'),
    });
    expect(scheduler.nextRun({ type: 'once', at: '2026-01-01T00:05:00.000Z' })).toBeNull();
  });

  it('interval computes next strictly after base', () => {
    const scheduler = createWorkflowScheduler({
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const next = scheduler.nextRun(
      { type: 'interval', everyMs: 60_000 },
      new Date('2026-01-01T00:00:30.000Z'),
    );
    expect(next?.toISOString()).toBe('2026-01-01T00:01:30.000Z');
  });

  it('interval with anchor falls back to anchor if future', () => {
    const scheduler = createWorkflowScheduler({
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const next = scheduler.nextRun(
      { type: 'interval', everyMs: 60_000, anchor: '2026-01-01T00:05:00.000Z' },
      new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(next?.toISOString()).toBe('2026-01-01T00:05:00.000Z');
  });

  it('interval uses injected clock for default base', () => {
    const scheduler = createWorkflowScheduler({
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const next = scheduler.nextRun({ type: 'interval', everyMs: 60_000 });
    expect(next?.toISOString()).toBe('2026-01-01T00:01:00.000Z');
  });

  it('cron delegates to nextCronRun', () => {
    const scheduler = createWorkflowScheduler({
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
      nextCronRun: (_expr, after) => new Date(after.getTime() + 5_000),
    });
    const next = scheduler.nextRun({ type: 'cron', expression: '* * * * *' });
    expect(next?.toISOString()).toBe('2026-01-01T00:00:05.000Z');
  });

  it('cron returns null without delegate', () => {
    const scheduler = createWorkflowScheduler({
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(scheduler.nextRun({ type: 'cron', expression: '* * * * *' })).toBeNull();
  });

  it('isDue handles once correctly', () => {
    const scheduler = createWorkflowScheduler({
      clock: () => new Date('2026-01-01T00:10:00.000Z'),
    });
    expect(scheduler.isDue({ type: 'once', at: '2026-01-01T00:05:00.000Z' }, null)).toBe(true);
    expect(
      scheduler.isDue(
        { type: 'once', at: '2026-01-01T00:05:00.000Z' },
        new Date('2026-01-01T00:05:00.000Z'),
      ),
    ).toBe(false);
  });
});
