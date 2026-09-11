import { describe, expect, it } from 'vitest';
import { getFeedClockReport } from './feedClock';
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

/** A wall-clock time on a local day, stored the way an event is — as UTC. */
function localIso(dateKey: string, hour: number, minute = 0) {
  return new Date(`${dateKey}T${pad(hour)}:${pad(minute)}:00`).toISOString();
}

function feed(id: string, dateKey: string, hour: number, durationMinutes?: number): CareEvent {
  return { ...base, durationMinutes, id, startedAt: localIso(dateKey, hour) };
}

/** Midday on the day after everything the fixtures log, so no band is in progress. */
const AFTER = new Date(`2026-10-03T12:00:00`);

function bandAt(events: CareEvent[], hour: number, now = AFTER) {
  const band = getFeedClockReport(events, 3, now).bands.find((entry) => entry.startHour === hour);
  if (!band) throw new Error(`no band at ${hour}`);
  return band;
}

describe('feed clock', () => {
  it('buckets feeds into three-hour bands by the local hour they started', () => {
    const report = getFeedClockReport(
      [feed('a', '2026-10-01', 7), feed('b', '2026-10-01', 8, 20), feed('c', '2026-10-01', 21)],
      3,
      AFTER
    );

    expect(report.bands).toHaveLength(8);
    expect(report.bands.find((band) => band.startHour === 6)?.feeds).toBe(2);
    expect(report.bands.find((band) => band.startHour === 21)?.feeds).toBe(1);
    expect(report.feeds).toBe(3);
  });

  it('labels a band with both ends, dropping a shared meridiem', () => {
    const labels = getFeedClockReport([], 3, AFTER).bands.map((band) => band.label);

    expect(labels).toEqual(['12–3a', '3–6a', '6–9a', '9a–12p', '12–3p', '3–6p', '6–9p', '9p–12a']);
  });

  it('averages the length of the feeds at that time, ignoring untimed ones', () => {
    const band = bandAt([feed('a', '2026-10-01', 7, 10), feed('b', '2026-10-01', 8, 30), feed('c', '2026-10-01', 8)], 6);

    expect(band.averageMinutes).toBe(20);
    expect(band.minMinutes).toBe(10);
    expect(band.maxMinutes).toBe(30);
    // The untimed feed still counts as a feed at that hour.
    expect(band.feeds).toBe(3);
    expect(band.timed).toBe(2);
  });

  it('drops a length long enough to be a timer left running', () => {
    const band = bandAt([feed('a', '2026-10-01', 7, 20), feed('b', '2026-10-01', 8, 9 * 60)], 6);

    expect(band.averageMinutes).toBe(20);
    expect(band.timed).toBe(1);
    expect(band.feeds).toBe(2);
  });

  it('divides feeds by the days a band was observed', () => {
    const events = [feed('a', '2026-10-01', 7), feed('b', '2026-10-02', 7), feed('c', '2026-10-02', 8)];

    expect(bandAt(events, 6).feedsPerDay).toBe(1.5);
  });

  it('does not count a band today that has not come round yet', () => {
    const morning = new Date(`2026-10-02T08:00:00`);
    const events = [feed('a', '2026-10-01', 7), feed('b', '2026-10-02', 7)];

    // Yesterday evening counts, this evening has not happened — one day, not two.
    expect(bandAt(events, 21, morning).feedsPerDay).toBe(0);
    expect(bandAt(events, 6, morning).feedsPerDay).toBeCloseTo(2 / (1 + 2 / 3), 5);
  });

  it('leaves a per-day rate off a band barely observed', () => {
    const justAfterMidnight = new Date(`2026-10-01T00:15:00`);

    expect(bandAt([feed('a', '2026-10-01', 0, 15)], 0, justAfterMidnight).feedsPerDay).toBeNull();
  });

  it('names the busiest band and where feeds run longest and shortest', () => {
    const events = [
      ...[10, 12, 14].map((minutes, index) => feed(`morning-${index}`, '2026-10-01', 7, minutes)),
      ...[40, 44, 48].map((minutes, index) => feed(`night-${index}`, '2026-10-01', 22, minutes)),
      feed('extra', '2026-10-01', 23, 30)
    ];
    const report = getFeedClockReport(events, 3, AFTER);

    expect(report.busiest?.label).toBe('9p–12a');
    expect(report.longest?.label).toBe('9p–12a');
    expect(report.shortest?.label).toBe('6–9a');
    expect(report.averageMinutes).toBeCloseTo((10 + 12 + 14 + 40 + 44 + 48 + 30) / 7, 5);
  });

  it('declines to name a band that only a feed or two backs up', () => {
    const report = getFeedClockReport([feed('a', '2026-10-01', 7, 10), feed('b', '2026-10-01', 22, 40)], 3, AFTER);

    expect(report.busiest?.label).toBe('6–9a');
    expect(report.longest).toBeNull();
    expect(report.shortest).toBeNull();
  });

  it('splits the day into the number of bands the chosen width asks for', () => {
    const events = [feed('a', '2026-10-01', 7, 10), feed('b', '2026-10-01', 8, 30)];

    expect(getFeedClockReport(events, 1, AFTER).bands).toHaveLength(24);
    expect(getFeedClockReport(events, 2, AFTER).bands).toHaveLength(12);
    expect(getFeedClockReport(events, 3, AFTER).bands).toHaveLength(8);
  });

  it('re-buckets the same feeds when the band narrows', () => {
    const events = [feed('a', '2026-10-01', 7, 10), feed('b', '2026-10-01', 8, 30)];
    const hourly = getFeedClockReport(events, 1, AFTER);

    // One 6–9a band of two feeds becomes two hourly bands of one each.
    expect(bandAt(events, 6).averageMinutes).toBe(20);
    expect(hourly.bands.find((band) => band.startHour === 7)?.averageMinutes).toBe(10);
    expect(hourly.bands.find((band) => band.startHour === 8)?.averageMinutes).toBe(30);
    expect(hourly.bands.map((band) => band.label)).toContain('7–8a');
    expect(hourly.bands.map((band) => band.label)).toContain('11a–12p');
    expect(hourly.bandHours).toBe(1);
  });

  it('reports nothing rather than zeroes with an empty log', () => {
    const report = getFeedClockReport([], 3, AFTER);

    expect(report.averageMinutes).toBeNull();
    expect(report.busiest).toBeNull();
    expect(report.days).toBe(0);
    expect(report.feeds).toBe(0);
    expect(report.bands.every((band) => band.feeds === 0 && band.averageMinutes === null)).toBe(true);
  });
});
