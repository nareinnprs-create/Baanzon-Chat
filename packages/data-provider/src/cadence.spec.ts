import type { TScheduleCadence } from './types/schedules';
import {
  cadenceIntervalMinutes,
  cadenceToCron,
  isValidCronExpression,
  nextRunInstants,
} from './cadence';

/**
 * The cadence helpers are shared by the schedule dialog (preview + validation)
 * and the server, so their output is a contract: a drift here either shows run
 * times the schedule does not keep or accepts a cadence the server rejects.
 */

const at = (overrides: Partial<Extract<TScheduleCadence, { frequency: 'daily' }>>) =>
  ({ frequency: 'daily', hour: 9, minute: 30, ...overrides }) as TScheduleCadence;

describe('cadenceToCron', () => {
  it('maps structured frequencies to five-field expressions', () => {
    expect(cadenceToCron(at({}))).toBe('30 9 * * *');
    expect(cadenceToCron(at({ frequency: 'hourly' }))).toBe('30 * * * *');
    expect(cadenceToCron(at({ frequency: 'weekdays' }))).toBe('30 9 * * 1-5');
  });

  it('sorts weekly days and defaults to Monday when none are given', () => {
    expect(cadenceToCron(at({ frequency: 'weekly', daysOfWeek: [5, 1, 3] }))).toBe(
      '30 9 * * 1,3,5',
    );
    expect(cadenceToCron(at({ frequency: 'weekly' }))).toBe('30 9 * * 1');
  });

  it('passes a cron expression through untouched', () => {
    const cadence = { frequency: 'cron', expression: '*/15 * * * *' } as TScheduleCadence;
    expect(cadenceToCron(cadence)).toBe('*/15 * * * *');
  });
});

describe('isValidCronExpression', () => {
  it('accepts five-field expressions that can actually fire', () => {
    expect(isValidCronExpression('0 9 * * 1-5')).toBe(true);
    expect(isValidCronExpression('*/15 * * * *')).toBe(true);
  });

  it('rejects the wrong field count and empty input', () => {
    expect(isValidCronExpression('')).toBe(false);
    expect(isValidCronExpression('0 9 * *')).toBe(false);
    expect(isValidCronExpression('0 0 9 * * *')).toBe(false);
  });

  it('rejects patterns that parse but can never match', () => {
    expect(isValidCronExpression('0 0 30 2 *')).toBe(false);
  });
});

describe('nextRunInstants', () => {
  it('returns the requested number of strictly increasing instants', () => {
    const instants = nextRunInstants(at({}), 'UTC', 3);
    expect(instants).toHaveLength(3);
    for (let i = 1; i < instants.length; i += 1) {
      expect(instants[i].getTime()).toBeGreaterThan(instants[i - 1].getTime());
    }
    expect(instants[0].getUTCHours()).toBe(9);
    expect(instants[0].getUTCMinutes()).toBe(30);
  });

  it('returns an empty list for an unreadable cron expression', () => {
    const cadence = { frequency: 'cron', expression: '0 0 30 2 *' } as TScheduleCadence;
    expect(nextRunInstants(cadence, 'UTC', 2)).toEqual([]);
  });
});

describe('cadenceIntervalMinutes', () => {
  it('reports hourly gaps and daily gaps with the DST allowance', () => {
    expect(cadenceIntervalMinutes(at({ frequency: 'hourly' }), 'UTC')).toBe(60);
    // A day-and-longer gap subtracts the largest real-world spring-forward shift.
    expect(cadenceIntervalMinutes(at({}), 'UTC')).toBe(24 * 60 - 120);
  });

  it('reports a weekly gap for a single day', () => {
    expect(cadenceIntervalMinutes(at({ frequency: 'weekly', daysOfWeek: [1] }), 'UTC')).toBe(
      7 * 24 * 60 - 120,
    );
  });
});
