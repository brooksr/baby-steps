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
        method: 'bottle',
        startedAt: '2026-09-02T09:00:00.000Z',
        type: 'feed'
      },
      {
        ...base,
        amountOz: 4,
        contents: 'breastmilk',
        id: 'bottle-2',
        method: 'bottle',
        startedAt: '2026-09-03T09:00:00.000Z',
        type: 'feed'
      },
      {
        ...base,
        id: 'sleep-1',
        endedAt: '2026-09-03T03:00:00.000Z',
        startedAt: '2026-09-03T01:00:00.000Z',
        type: 'sleep'
      },
      {
        ...base,
        id: 'diaper-1',
        kind: 'both',
        startedAt: '2026-09-03T10:00:00.000Z',
        type: 'diaper'
      },
      {
        ...base,
        id: 'diaper-2',
        kind: 'wet',
        startedAt: '2026-09-03T14:00:00.000Z',
        type: 'diaper'
      }
    ];

    const analytics = getFirstYearAnalytics(profile, events, new Date('2026-09-04T12:00:00.000Z'));

    expect(analytics.daysElapsed).toBe(3);
    expect(analytics.progressPercent).toBe(1);
    expect(analytics.stats.feeds).toMatchObject({ average: 1, max: 1, min: 1 });
    expect(analytics.stats.milkOunces).toMatchObject({ average: 3, max: 4, min: 2 });
    expect(analytics.stats.sleepHours).toMatchObject({ average: 2, max: 2, min: 2 });
  });

  it('splits diapers into wet and dirty, counting a "both" change as one of each', () => {
    const profile = {
      ...createDefaultBabyProfile(new Date('2026-06-20T12:00:00.000Z')),
      birthDate: '2026-09-02T06:30:00.000Z'
    };
    const events: CareEvent[] = [
      { ...base, id: 'd-1', kind: 'both', startedAt: '2026-09-02T09:00:00.000Z', type: 'diaper' },
      { ...base, id: 'd-2', kind: 'wet', startedAt: '2026-09-02T12:00:00.000Z', type: 'diaper' },
      { ...base, id: 'd-3', kind: 'dirty', startedAt: '2026-09-02T15:00:00.000Z', type: 'diaper' }
    ];

    const [day] = getFirstYearAnalytics(profile, events, new Date('2026-09-03T12:00:00.000Z')).points;

    expect(day).toMatchObject({ diapers: 4, dirtyDiapers: 2, wetDiapers: 2 });
  });

  it('averages wet and dirty over the days that logged any diaper', () => {
    const profile = {
      ...createDefaultBabyProfile(new Date('2026-06-20T12:00:00.000Z')),
      birthDate: '2026-09-02T06:30:00.000Z'
    };
    const events: CareEvent[] = [
      { ...base, id: 'd-1', kind: 'both', startedAt: '2026-09-02T09:00:00.000Z', type: 'diaper' },
      { ...base, id: 'd-2', kind: 'dirty', startedAt: '2026-09-02T15:00:00.000Z', type: 'diaper' },
      // A day with nothing dirty still counts against the dirty average.
      { ...base, id: 'd-3', kind: 'wet', startedAt: '2026-09-03T09:00:00.000Z', type: 'diaper' },
      { ...base, id: 'd-4', kind: 'wet', startedAt: '2026-09-03T12:00:00.000Z', type: 'diaper' }
    ];

    const { stats } = getFirstYearAnalytics(profile, events, new Date('2026-09-04T12:00:00.000Z'));

    expect(stats.diapers).toMatchObject({ average: 2.5, max: 3, min: 2 });
    expect(stats.wetDiapers).toMatchObject({ average: 1.5, max: 2, min: 1 });
    expect(stats.dirtyDiapers).toMatchObject({ average: 1, max: 2, min: 0 });
  });
});
