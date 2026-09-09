import { describe, expect, it } from 'vitest';
import { createDefaultBabyProfile } from './dates';
import { getDayMetricStats, getFirstYearAnalytics } from './firstYear';
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

  it('weights dirty changes by size and keeps the counts behind them', () => {
    const profile = {
      ...createDefaultBabyProfile(new Date('2026-06-20T12:00:00.000Z')),
      birthDate: '2026-09-02T06:30:00.000Z'
    };
    const events: CareEvent[] = [
      { ...base, id: 'p-1', kind: 'dirty', poopSize: 'large', startedAt: '2026-09-02T09:00:00.000Z', type: 'diaper' },
      { ...base, id: 'p-2', kind: 'both', poopSize: 'medium', startedAt: '2026-09-02T12:00:00.000Z', type: 'diaper' },
      { ...base, id: 'p-3', kind: 'dirty', poopSize: 'small', startedAt: '2026-09-02T15:00:00.000Z', type: 'diaper' },
      // No size on it: a change nobody sized counts as a medium one.
      { ...base, id: 'p-4', kind: 'dirty', startedAt: '2026-09-02T18:00:00.000Z', type: 'diaper' }
    ];

    const [day] = getFirstYearAnalytics(profile, events, new Date('2026-09-03T12:00:00.000Z')).points;

    expect(day).toMatchObject({ dirtyDiapers: 4, dirtyLarge: 1, dirtyMedium: 1, dirtySmall: 1 });
    expect(day.poopLoad).toBeCloseTo(1 + 2 / 3 + 1 / 3 + 2 / 3, 5);
  });
});

describe('per-day stats', () => {
  const entries = [
    { dateKey: '2026-09-02', value: 8 },
    { dateKey: '2026-09-03', value: 4 }
  ];

  // Four feeds by 6am is a pace of sixteen a day, not a four-feed day.
  it('counts the day in progress as the part of it that has happened', () => {
    const stats = getDayMetricStats(entries, new Date('2026-09-03T06:00:00'));

    expect(stats.average).toBeCloseTo(12 / 1.25, 5);
  });

  it('leaves the day in progress out of min and max while a finished day exists', () => {
    expect(getDayMetricStats(entries, new Date('2026-09-03T06:00:00'))).toMatchObject({ max: 8, min: 8 });
    // ...but a single unfinished day is all there is to report.
    expect(getDayMetricStats(entries.slice(1), new Date('2026-09-03T06:00:00'))).toMatchObject({ max: 4, min: 4 });
  });

  it('averages finished days plainly', () => {
    expect(getDayMetricStats(entries, new Date('2026-09-04T06:00:00')).average).toBe(6);
  });
});
