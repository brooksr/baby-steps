import { describe, expect, it } from 'vitest';
import { getFeedToDiaperLags, predictNextDiaper } from './diapers';
import type { CareEvent, DiaperKind } from './types';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const HOUR = 60 * 60_000;

const base = {
  babyId: 'theo-roche',
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

    expect(lags.wet).toEqual({ averageMinutes: 45, samples: 20 });
    expect(lags.dirty).toEqual({ averageMinutes: null, samples: 0 });
  });

  it('averages the longer wait to the next dirty diaper', () => {
    // Every fourth change is dirty, so a feed is either 45m or 3h 45m from the
    // next dirty one. Feeds further out than that are dropped as unrelated.
    const diapers = buildDiapers(20, (index) => (index % 4 === 3 ? 'dirty' : 'wet'));
    const lags = getFeedToDiaperLags([...diapers, ...buildFeedsBefore(diapers, 45)]);

    expect(lags.dirty).toEqual({ averageMinutes: 135, samples: 10 });
  });

  it('reports no average when nothing pairs up', () => {
    expect(getFeedToDiaperLags([])).toEqual({
      dirty: { averageMinutes: null, samples: 0 },
      wet: { averageMinutes: null, samples: 0 }
    });
  });
});

describe('next diaper prediction', () => {
  it('projects the typical gap forward from the last change', () => {
    const prediction = predictNextDiaper(buildDiapers(20), NOW);

    expect(prediction).not.toBeNull();
    expect(prediction?.expectedAt).toBe('2026-10-01T14:00:00.000Z');
    expect(prediction?.windowStartAt).toBe('2026-10-01T13:45:00.000Z');
    expect(prediction?.windowEndAt).toBe('2026-10-01T14:15:00.000Z');
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
      { ...base, id: 'feed-late', method: 'nursing', startedAt: '2026-10-01T11:30:00.000Z', type: 'feed' }
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
