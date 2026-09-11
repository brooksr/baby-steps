import { describe, expect, it } from 'vitest';
import {
  FEED_DAY_MAX_FEEDS,
  FEED_DAY_MIN_FEEDS,
  FEED_DAY_START_HOUR,
  getFeedOrderReport,
  toClockMinutes
} from './feedOrder';
import type { CareEvent } from './types';

const base = {
  babyId: 'theo-roche',
  createdAt: '2026-10-01T12:00:00.000Z',
  method: 'nursing' as const,
  syncState: 'local' as const,
  type: 'feed' as const,
  updatedAt: '2026-10-01T12:00:00.000Z'
};

const pad = (value: number) => String(value).padStart(2, '0');

function feed(id: string, dateKey: string, hour: number, minute = 0): CareEvent {
  return { ...base, id, startedAt: new Date(`${dateKey}T${pad(hour)}:${pad(minute)}:00`).toISOString() };
}

/** One calendar day's feeds, given as local hours. */
function day(dateKey: string, hours: number[]): CareEvent[] {
  return hours.map((hour, index) => feed(`${dateKey}-${index}`, dateKey, hour));
}

/**
 * An ordinary day: `FEED_DAY_MIN_FEEDS` feeds every hour from `start`, so it
 * clears the count filter and the sequence under test is the interesting part.
 */
function fullDay(dateKey: string, start = 6): CareEvent[] {
  return day(dateKey, Array.from({ length: FEED_DAY_MIN_FEEDS }, (_, index) => start + index));
}

/** The clock time an index averages out to, for reading assertions plainly. */
function clockOf(report: ReturnType<typeof getFeedOrderReport>, index: number) {
  return toClockMinutes(report.slots[index].averageOffset, report.dayStartMinutes);
}

describe('feed order', () => {
  it('averages the clock time of each feed by its place in the day', () => {
    // Two ordinary days an hour apart from each other, feed for feed.
    const report = getFeedOrderReport([...fullDay('2026-10-01', 6), ...fullDay('2026-10-02', 8)]);

    expect(report.slots).toHaveLength(FEED_DAY_MIN_FEEDS);
    expect(report.slots[0].index).toBe(1);
    // 6a and 8a average to 7a, and every later index follows an hour on.
    expect(clockOf(report, 0)).toBe(7 * 60);
    expect(clockOf(report, 1)).toBe(8 * 60);
    expect(clockOf(report, 2)).toBe(9 * 60);
  });

  it('numbers feeds within their own day, in time order', () => {
    // Logged out of order — the day's first feed is still the earliest one.
    const scrambled = [...fullDay('2026-10-01', 6)].reverse();
    const report = getFeedOrderReport(scrambled);

    expect([0, 1, 2].map((index) => clockOf(report, index))).toEqual([6 * 60, 7 * 60, 8 * 60]);
  });

  it('counts a small-hours feed as the tail of the day before, not a new one', () => {
    // Eight feeds from 7am, then one at 1am — nine in one feeding day.
    const report = getFeedOrderReport([
      ...day('2026-10-01', [7, 9, 11, 13, 15, 17, 19, 22]),
      feed('overnight', '2026-10-02', 1)
    ]);

    expect(report.days).toBe(1);
    expect(report.slots).toHaveLength(9);
    expect(clockOf(report, 8)).toBe(1 * 60);
    // And it sorts last, twenty hours into the day rather than one.
    expect(report.slots[8].averageOffset).toBe(20 * 60);
  });

  it('starts a new day at the start hour', () => {
    // Each day is eight feeds plus one either side of the 5am boundary, so both
    // land on nine and the split is what is under test.
    const report = getFeedOrderReport([
      ...day('2026-10-01', [6, 8, 10, 12, 14, 16, 18, 20]),
      feed('closing', '2026-10-02', FEED_DAY_START_HOUR - 1, 59),
      feed('opening', '2026-10-02', FEED_DAY_START_HOUR),
      ...day('2026-10-02', [7, 9, 11, 13, 15, 17, 19, 21])
    ]);

    // The 4:59 feed closes out Oct 1; the 5:00 feed opens Oct 2.
    expect(report.days).toBe(2);
    expect(clockOf(report, 0)).toBe(5.5 * 60);
    // The 4:59 feed is the ninth of Oct 1, at the very end of its track.
    expect(report.slots[8].latestOffset).toBe(24 * 60 - 1);
    // Oct 2's ninth is its 9pm one — sixteen hours in, not twenty-four.
    expect(report.slots[8].earliestOffset).toBe(16 * 60);
  });

  it('keeps the spread of each index beside its average', () => {
    const report = getFeedOrderReport([
      ...fullDay('2026-10-01', 6),
      ...fullDay('2026-10-02', 8),
      ...fullDay('2026-10-03', 10)
    ]);

    expect(clockOf(report, 0)).toBe(8 * 60);
    expect(toClockMinutes(report.slots[0].earliestOffset)).toBe(6 * 60);
    expect(toClockMinutes(report.slots[0].latestOffset)).toBe(10 * 60);
    expect(report.slots[0].days).toBe(3);
  });

  it('averages the wait since that day’s previous feed', () => {
    const report = getFeedOrderReport([
      ...day('2026-10-01', [6, 9, 11, 12, 13, 14, 15, 16, 17]),
      ...day('2026-10-02', [6, 10, 11, 12, 13, 14, 15, 16, 17])
    ]);

    // The first of the day follows nothing.
    expect(report.slots[0].averageGapMinutes).toBeNull();
    expect(report.slots[1].averageGapMinutes).toBe(3.5 * 60);
  });

  it('measures a gap across midnight as the hours it really was', () => {
    const report = getFeedOrderReport([
      ...day('2026-10-01', [6, 8, 10, 12, 14, 16, 18, 23]),
      feed('overnight', '2026-10-02', 2)
    ]);

    expect(report.slots[8].averageGapMinutes).toBe(3 * 60);
  });

  it('averages an index over only the days that reached it', () => {
    const report = getFeedOrderReport([
      ...fullDay('2026-10-01', 6),
      ...day('2026-10-02', [...Array.from({ length: 9 }, (_, i) => 6 + i), 23])
    ]);

    expect(report.slots[0].days).toBe(2);
    expect(report.slots[9].days).toBe(1);
    // The shorter day does not pull the tenth feed earlier — it is not in it.
    expect(clockOf(report, 9)).toBe(23 * 60);
  });

  it('stops the typical sequence at the first index too few days reached', () => {
    const report = getFeedOrderReport([
      ...day('2026-10-01', [...Array.from({ length: 9 }, (_, i) => 6 + i), 23]),
      ...fullDay('2026-10-02', 6),
      ...fullDay('2026-10-03', 6)
    ]);

    expect(report.slots).toHaveLength(10);
    expect(report.typicalCount).toBe(9);
    expect(report.slots[8].typical).toBe(true);
    expect(report.slots[9].typical).toBe(false);
    expect(report.days).toBe(3);
    expect(report.feedsPerDay).toBeCloseTo(28 / 3, 5);
  });

  it('counts only days inside the ordinary feed-count range', () => {
    const report = getFeedOrderReport([
      ...fullDay('2026-10-01', 6),
      // The ragged end of a date range: one stray feed, at an hour that would
      // otherwise stretch feed 1 across the clock.
      ...day('2026-10-02', [19]),
      // And a day that ran long.
      ...day('2026-10-03', Array.from({ length: FEED_DAY_MAX_FEEDS + 1 }, (_, i) => 6 + i))
    ]);

    expect(report.days).toBe(1);
    expect(report.loggedDays).toBe(3);
    expect(report.feedsPerDay).toBe(FEED_DAY_MIN_FEEDS);
    // Feed 1 is the ordinary day's 6am, not a spread from 6am to 7pm.
    expect(report.slots[0].earliestOffset).toBe(report.slots[0].latestOffset);
    expect(clockOf(report, 0)).toBe(6 * 60);
  });

  it('keeps a day at either end of the range', () => {
    const report = getFeedOrderReport([
      ...day('2026-10-01', Array.from({ length: FEED_DAY_MIN_FEEDS }, (_, i) => 6 + i)),
      ...day('2026-10-02', Array.from({ length: FEED_DAY_MAX_FEEDS }, (_, i) => 6 + i))
    ]);

    expect(report.days).toBe(2);
    expect(report.slots).toHaveLength(FEED_DAY_MAX_FEEDS);
  });

  it('describes nothing rather than a stray day when none is ordinary', () => {
    const report = getFeedOrderReport([...day('2026-10-01', [7]), ...day('2026-10-02', [9, 14])]);

    expect(report.days).toBe(0);
    expect(report.loggedDays).toBe(2);
    expect(report.feedsPerDay).toBe(0);
    expect(report.slots).toEqual([]);
  });

  it('reports nothing rather than zeroes with an empty log', () => {
    const report = getFeedOrderReport([]);

    expect(report.days).toBe(0);
    expect(report.loggedDays).toBe(0);
    expect(report.feedsPerDay).toBe(0);
    expect(report.slots).toEqual([]);
    expect(report.typicalCount).toBe(0);
  });
});
