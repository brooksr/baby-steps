import { describe, expect, it } from 'vitest';
import { createDefaultBabyProfile } from './dates';
import { getFirstYearAnalytics } from './firstYear';
import type { CareEvent } from './types';

const base = {
  babyId: 'theo-roche',
  createdAt: '2026-09-02T12:00:00.000Z',
  syncState: 'local' as const,
  updatedAt: '2026-09-02T12:00:00.000Z'
};

describe('first year analytics', () => {
  it('calculates progress and min average max stats from logged days', () => {
    const profile = {
      ...createDefaultBabyProfile(new Date('2026-06-20T12:00:00.000Z')),
      birthDate: '2026-09-02T06:30:00.000Z'
    };
    const events: CareEvent[] = [
      {
        ...base,
        amountOz: 2,
        contents: 'breastmilk',
        id: 'bottle-1',
        startedAt: '2026-09-02T09:00:00.000Z',
        type: 'bottle'
      },
      {
        ...base,
        amountOz: 4,
        contents: 'breastmilk',
        id: 'bottle-2',
        startedAt: '2026-09-03T09:00:00.000Z',
        type: 'bottle'
      },
      {
        ...base,
        id: 'sleep-1',
        endedAt: '2026-09-03T03:00:00.000Z',
        startedAt: '2026-09-03T01:00:00.000Z',
        type: 'sleep'
      }
    ];

    const analytics = getFirstYearAnalytics(profile, events, new Date('2026-09-04T12:00:00.000Z'));

    expect(analytics.daysElapsed).toBe(3);
    expect(analytics.progressPercent).toBe(1);
    expect(analytics.stats.feeds).toMatchObject({ average: 1, max: 1, min: 1 });
    expect(analytics.stats.milkOunces).toMatchObject({ average: 3, max: 4, min: 2 });
    expect(analytics.stats.sleepHours).toMatchObject({ average: 2, max: 2, min: 2 });
  });
});
