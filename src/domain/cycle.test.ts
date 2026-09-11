import { describe, expect, it } from 'vitest';
import { getCycleStats, getCycleToday, getPeriods, predictCycle } from './cycle';
import type { CareEvent, MensesFlow } from './types';

function menses(dateKey: string, flow: MensesFlow = 'medium'): CareEvent {
  return {
    babyId: 'mom-roche',
    createdAt: `${dateKey}T08:00:00.000Z`,
    flow,
    id: `menses_${dateKey}`,
    startedAt: `${dateKey}T08:00:00`,
    syncState: 'synced',
    type: 'menses',
    updatedAt: `${dateKey}T08:00:00.000Z`
  } as CareEvent;
}

/** Bleeding days for a period starting on `startKey`, `days` long. */
function period(startKey: string, days = 4) {
  const start = new Date(`${startKey}T12:00:00`);
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(start.getTime() + index * 86_400_000);
    return menses(day.toISOString().slice(0, 10));
  });
}

describe('grouping bleeding days into periods', () => {
  it('reads consecutive days as one period', () => {
    const periods = getPeriods(period('2026-03-01', 5));

    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ days: 5, endKey: '2026-03-05', startKey: '2026-03-01' });
  });

  // Bleeding pauses, and a day gets missed — neither starts a new period.
  it('keeps a one- or two-day gap inside the same period', () => {
    const periods = getPeriods([menses('2026-03-01'), menses('2026-03-02'), menses('2026-03-04')]);

    expect(periods).toHaveLength(1);
    expect(periods[0].days).toBe(4);
  });

  it('starts a new period after three days clear', () => {
    const periods = getPeriods([menses('2026-03-01'), menses('2026-03-05')]);

    expect(periods.map((entry) => entry.startKey)).toEqual(['2026-03-01', '2026-03-05']);
  });

  it('takes one entry per day, keeping the heaviest flow logged', () => {
    const periods = getPeriods([menses('2026-03-01', 'spotting'), menses('2026-03-01', 'heavy')]);

    expect(periods[0].days).toBe(1);
    expect(periods[0].flows).toEqual(['heavy']);
  });

  // A cycle is start-to-start, so the day count of the period itself is not it.
  it('measures cycles from one start to the next', () => {
    const periods = getPeriods([...period('2026-03-01'), ...period('2026-03-29')]);

    expect(periods[0].cycleLengthDays).toBe(28);
    expect(periods[1].cycleLengthDays).toBeUndefined();
  });
});

describe('cycle stats', () => {
  it('averages the recent cycles and reports their spread', () => {
    // 28 then 29 days, so the average rounds to 29.
    const stats = getCycleStats([...period('2026-01-01'), ...period('2026-01-29'), ...period('2026-02-27')]);

    expect(stats.averageCycleDays).toBe(29);
    expect(stats.shortestCycleDays).toBe(28);
    expect(stats.longestCycleDays).toBe(29);
    expect(stats.spreadDays).toBe(1);
    expect(stats.countedCycles).toBe(2);
  });

  // A two-month hole in the log is not a two-month cycle. Averaging one in would
  // poison every prediction after it, so it is listed but not counted.
  it('drops an out-of-range gap from the average, and says it did', () => {
    const stats = getCycleStats([...period('2026-01-01'), ...period('2026-05-01'), ...period('2026-05-29')]);

    expect(stats.averageCycleDays).toBe(28);
    expect(stats.countedCycles).toBe(1);
    expect(stats.droppedCycles).toBe(1);
  });

  it('averages period length over finished periods only', () => {
    // The last period is still being logged, so it must not drag the average.
    const stats = getCycleStats([...period('2026-01-01', 5), ...period('2026-01-29', 5), ...period('2026-02-26', 1)]);

    expect(stats.averagePeriodDays).toBe(5);
  });
});

describe('predicting the next period and the fertile window', () => {
  const regular = [...period('2026-01-01'), ...period('2026-01-29'), ...period('2026-02-26')];

  it('projects the next start off the average cycle', () => {
    const prediction = predictCycle(regular);

    expect(prediction?.nextPeriodKey).toBe('2026-03-26');
    expect(prediction?.confidence).toBe('low'); // two counted cycles is not confident
  });

  // The luteal phase is the stable half, so ovulation is counted back from the
  // next period rather than forward from the last one.
  it('places ovulation 14 days before the predicted period, with the window around it', () => {
    const prediction = predictCycle(regular);

    expect(prediction?.ovulationKey).toBe('2026-03-12');
    expect(prediction?.fertileStartKey).toBe('2026-03-07');
    expect(prediction?.fertileEndKey).toBe('2026-03-13');
  });

  // Identical cycles still do not arrive to the day.
  it('never closes the window tighter than a day either side', () => {
    const steady = [...period('2026-01-01'), ...period('2026-01-29'), ...period('2026-02-26')];
    const prediction = predictCycle(steady);

    expect(prediction?.nextPeriodKey).toBe('2026-03-26');
    expect(prediction?.windowStartKey).toBe('2026-03-25');
    expect(prediction?.windowEndKey).toBe('2026-03-27');
  });

  it('widens the window to the range recent cycles actually ran', () => {
    const prediction = predictCycle([...period('2026-01-01'), ...period('2026-01-26'), ...period('2026-02-27')]);

    // 25 and 32 day cycles: the window opens at the shortest and closes at the longest.
    expect(prediction?.windowStartKey).toBe('2026-03-24');
    expect(prediction?.windowEndKey).toBe('2026-03-31');
    expect(prediction?.confidence).toBe('low');
  });

  it('is confident only once several cycles agree', () => {
    const steady = [...period('2026-01-01'), ...period('2026-01-29'), ...period('2026-02-26'), ...period('2026-03-26')];

    expect(predictCycle(steady)?.confidence).toBe('high');
  });

  // One cycle is a single gap, not a pattern. Declining beats a wrong calendar.
  it('declines rather than predicting off one cycle', () => {
    expect(predictCycle(period('2026-03-01'))).toBeNull();
    expect(predictCycle([...period('2026-01-01'), ...period('2026-01-29')])).toBeNull();
  });
});

describe('where today sits', () => {
  const regular = [...period('2026-01-01'), ...period('2026-01-29'), ...period('2026-02-26')];

  it('counts the cycle day from the last period start', () => {
    expect(getCycleToday(regular, new Date('2026-03-05T09:00:00'))?.dayOfCycle).toBe(8);
  });

  it('names the phase today falls in', () => {
    expect(getCycleToday(regular, new Date('2026-02-27T09:00:00'))?.phase).toBe('period');
    expect(getCycleToday(regular, new Date('2026-03-05T09:00:00'))?.phase).toBe('follicular');
    expect(getCycleToday(regular, new Date('2026-03-08T09:00:00'))?.phase).toBe('fertile');
    expect(getCycleToday(regular, new Date('2026-03-12T09:00:00'))?.phase).toBe('ovulation');
    expect(getCycleToday(regular, new Date('2026-03-20T09:00:00'))?.phase).toBe('luteal');
  });

  // Past the predicted date the count goes negative, so the UI can say "late"
  // instead of quietly showing a date that has already gone by.
  it('counts down to the next period, and past it', () => {
    expect(getCycleToday(regular, new Date('2026-03-20T09:00:00'))?.daysUntilNextPeriod).toBe(6);
    expect(getCycleToday(regular, new Date('2026-03-29T09:00:00'))?.daysUntilNextPeriod).toBe(-3);
  });

  it('has nothing to say with no period logged', () => {
    expect(getCycleToday([], new Date('2026-03-20T09:00:00'))).toBeNull();
  });
});
