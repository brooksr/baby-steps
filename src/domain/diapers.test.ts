import { describe, expect, it } from 'vitest';
import { getFeedToDiaperLags, predictNextDiaper } from './diapers';
import type { CareEvent, DiaperKind } from './types';

const NOW = new Date('2026-10-01T12:00:00');
const HOUR = 60 * 60_000;

const base = {
  babyId: 'avery-example',
  createdAt: '2026-10-01T12:00:00.000Z',
  syncState: 'local' as const,
  updatedAt: '2026-10-01T12:00:00.000Z'
};

/** Changes every three hours, the most recent an hour before `NOW`. */
function buildDiapers(count: number, kindAt: (index: number) => DiaperKind = () => 'wet'): CareEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    ...base,
    id: `diaper-${index}`,
    kind: kindAt(index),
    startedAt: new Date(NOW.getTime() - HOUR - (count - 1 - index) * 3 * HOUR).toISOString(),
    type: 'diaper' as const
  }));
}

/** One nursing session a fixed number of minutes before each change. */
function buildFeedsBefore(diapers: CareEvent[], minutesBefore: number): CareEvent[] {
  return diapers.map((diaper, index) => ({
    ...base,
    id: `feed-${index}`,
    method: 'nursing' as const,
    startedAt: new Date(new Date(diaper.startedAt).getTime() - minutesBefore * 60_000).toISOString(),
    type: 'feed' as const
  }));
}

describe('feed to diaper lags', () => {
  it('averages the wait from a feed to the next wet diaper', () => {
    const diapers = buildDiapers(20);
    const lags = getFeedToDiaperLags([...diapers, ...buildFeedsBefore(diapers, 45)]);

    expect(lags.wet).toEqual({ averageMinutes: 45, maxMinutes: 45, minMinutes: 45, samples: 20 });
    expect(lags.dirty).toEqual({ averageMinutes: null, maxMinutes: null, minMinutes: null, samples: 0 });
  });

  it('averages the longer wait to the next dirty diaper', () => {
    // Every fourth change is dirty, so a feed is either 45m or 3h 45m from the
    // next dirty one. Feeds further out than that are dropped as unrelated.
    const diapers = buildDiapers(20, (index) => (index % 4 === 3 ? 'dirty' : 'wet'));
    const lags = getFeedToDiaperLags([...diapers, ...buildFeedsBefore(diapers, 45)]);

    // The mean sits between the two waits the pattern actually produces.
    expect(lags.dirty).toEqual({ averageMinutes: 135, maxMinutes: 225, minMinutes: 45, samples: 10 });
  });

  it('reports no average when nothing pairs up', () => {
    expect(getFeedToDiaperLags([])).toEqual({
      dirty: { averageMinutes: null, maxMinutes: null, minMinutes: null, samples: 0 },
      wet: { averageMinutes: null, maxMinutes: null, minMinutes: null, samples: 0 }
    });
  });
});

describe('next diaper prediction', () => {
  it('projects the typical gap forward from the last change', () => {
    const prediction = predictNextDiaper(buildDiapers(20), NOW);

    expect(prediction).not.toBeNull();
    expect(prediction?.expectedAt).toBe(new Date('2026-10-01T14:00:00').toISOString());
    expect(prediction?.windowStartAt).toBe(new Date('2026-10-01T13:45:00').toISOString());
    expect(prediction?.windowEndAt).toBe(new Date('2026-10-01T14:15:00').toISOString());
    expect(prediction?.minutesAway).toBe(120);
    expect(prediction?.typicalGapMinutes).toBeCloseTo(180, 5);
    expect(prediction?.confidence).toBe('high');
    expect(prediction?.likelyKind).toBe('wet');
    expect(prediction?.basis).toContain('Typical 3h between changes');
  });

  it('declines to guess without enough intervals', () => {
    expect(predictNextDiaper([], NOW)).toBeNull();
    expect(predictNextDiaper(buildDiapers(3), NOW)).toBeNull();
  });

  it('pulls the estimate toward a feed logged since the last change', () => {
    const diapers = buildDiapers(20);
    const events: CareEvent[] = [
      ...diapers,
      ...buildFeedsBefore(diapers, 45),
      { ...base, id: 'feed-late', method: 'nursing', startedAt: new Date('2026-10-01T11:30:00').toISOString(), type: 'feed' }
    ];

    const prediction = predictNextDiaper(events, NOW);

    // Interval alone says 2h away; the 11:30 feed's usual 45m lag says 15m. The
    // blend lands between them, nearer the interval.
    expect(prediction?.minutesAway).toBe(78);
    expect(prediction?.basis).toContain('adjusted for the feed 30m ago');
  });

  it('expects a dirty change once the usual dirty stretch has run out', () => {
    const prediction = predictNextDiaper(buildDiapers(20, (index) => (index % 4 === 0 && index <= 12 ? 'dirty' : 'wet')), NOW);

    expect(prediction?.likelyKind).toBe('dirty');
  });

  function overnightLog(lastAt: string) {
    const time = new Date(lastAt).getTime();
    return buildDiapers(8).map((event, index) => ({ ...event, startedAt: new Date(time - (7-index)*3*HOUR).toISOString() }));
  }

  it('allows eight hours overnight without moving the usual earliest estimate', () => {
    const events = overnightLog('2026-10-01T19:00:00');
    const prediction = predictNextDiaper(events, new Date('2026-10-02T01:00:00'))!;
    expect(prediction.windowEndAt).toBe(new Date('2026-10-02T03:00:00').toISOString());
    expect(prediction.windowStartAt).toBe(new Date('2026-10-01T21:45:00').toISOString());
    expect(prediction.basis).toContain('overnight window up to 8h');
  });

  it('ends the overnight allowance at 7am and returns to the learned daytime window', () => {
    const events = overnightLog('2026-10-01T23:00:00');
    for (const now of ['2026-10-01T23:30:00', '2026-10-02T06:59:59']) {
      expect(predictNextDiaper(events, new Date(now))!.windowEndAt).toBe(new Date('2026-10-02T07:00:00').toISOString());
    }
    expect(predictNextDiaper(events, new Date('2026-10-02T07:00:00'))!.windowEndAt).toBe(new Date('2026-10-02T02:15:00').toISOString());
    // A late-night change never produces a reversed window near morning.
    const nearMorning = predictNextDiaper(overnightLog('2026-10-02T06:00:00'), new Date('2026-10-02T06:30:00'))!;
    expect(nearMorning.windowEndAt).toBe(new Date('2026-10-02T07:00:00').toISOString());
    expect(Date.parse(nearMorning.windowStartAt)).toBeLessThanOrEqual(Date.parse(nearMorning.windowEndAt));
    expect(Date.parse(nearMorning.expectedAt)).toBeLessThanOrEqual(Date.parse(nearMorning.windowEndAt));
  });

  it('starts the allowance at 7pm and never keeps an eight-hour-old change in range', () => {
    const events = overnightLog('2026-10-01T16:00:00');
    expect(predictNextDiaper(events, new Date('2026-10-01T18:59:59'))!.windowEndAt).toBe(new Date('2026-10-01T19:15:00').toISOString());
    const midnight = new Date('2026-10-02T00:00:00');
    expect(predictNextDiaper(events, new Date('2026-10-01T19:00:00'))!.windowEndAt).toBe(midnight.toISOString());
    expect(predictNextDiaper(events, new Date(midnight.getTime()+1))!.windowEndAt).toBe(midnight.toISOString());
  });

  it('loses confidence when the log has gone quiet', () => {
    const stale = buildDiapers(20).map((event) => ({
      ...event,
      startedAt: new Date(new Date(event.startedAt).getTime() - 2 * 24 * HOUR).toISOString()
    }));

    const prediction = predictNextDiaper(stale, NOW);

    expect(prediction?.minutesAway).toBeLessThan(0);
    expect(prediction?.confidence).toBe('low');
  });
});
