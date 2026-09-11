import { describe, expect, it } from 'vitest';
import { getNightKey, getParentReport, isNightDuty } from './parentReport';
import type { CareEvent } from './types';

function sleep(startedAt: string, endedAt: string): CareEvent {
  return {
    babyId: 'mom-roche',
    createdAt: startedAt,
    endedAt,
    id: `sleep_${startedAt}`,
    startedAt,
    syncState: 'synced',
    type: 'sleep',
    updatedAt: startedAt
  } as CareEvent;
}

function feed(startedAt: string, method: 'nursing' | 'bottle' = 'nursing', caregiverId?: string): CareEvent {
  return {
    babyId: 'theo-roche',
    caregiverId,
    createdAt: startedAt,
    id: `feed_${startedAt}`,
    method,
    startedAt,
    syncState: 'synced',
    type: 'feed',
    updatedAt: startedAt
  } as CareEvent;
}

describe('which night a sleep belongs to', () => {
  // Otherwise one night splits at midnight into two half-nights.
  it('keys small-hours sleep to the evening before', () => {
    expect(getNightKey('2026-03-04T22:30:00')).toBe('2026-03-04');
    expect(getNightKey('2026-03-05T01:30:00')).toBe('2026-03-04');
    expect(getNightKey('2026-03-05T13:30:00')).toBe('2026-03-05');
  });

  it('reads 10pm to 6am as night duty', () => {
    expect(isNightDuty('2026-03-04T23:10:00')).toBe(true);
    expect(isNightDuty('2026-03-05T03:10:00')).toBe(true);
    expect(isNightDuty('2026-03-05T09:10:00')).toBe(false);
  });
});

describe('a parent report', () => {
  it('adds a broken night up into one row, keeping the longest stretch', () => {
    const report = getParentReport([
      sleep('2026-03-04T22:00:00', '2026-03-05T01:00:00'),
      sleep('2026-03-05T02:00:00', '2026-03-05T06:00:00')
    ]);

    expect(report.nights).toHaveLength(1);
    expect(report.nights[0]).toMatchObject({
      dateKey: '2026-03-04',
      longestStretchMinutes: 240,
      sessions: 2,
      sleepMinutes: 420
    });
    expect(report.averageSleepMinutes).toBe(420);
  });

  // Nobody signs an entry, so this is not "who got up" — it is which of this
  // parent's own sleeps was broken into.
  it('counts baby events that landed inside a logged sleep', () => {
    const report = getParentReport(
      [sleep('2026-03-04T22:00:00', '2026-03-05T06:00:00')],
      [feed('2026-03-05T01:00:00'), feed('2026-03-05T04:00:00'), feed('2026-03-05T11:00:00')]
    );

    expect(report.nights[0].interruptions).toBe(2);
    expect(report.averageInterruptions).toBe(2);
  });

  it('counts the household care load behind the period', () => {
    const report = getParentReport(
      [sleep('2026-03-04T22:00:00', '2026-03-05T06:00:00')],
      [feed('2026-03-05T01:00:00'), feed('2026-03-05T11:00:00', 'bottle'), { ...feed('2026-03-05T12:00:00'), kind: 'wet', type: 'diaper' } as CareEvent]
    );

    expect(report.care).toMatchObject({ diapers: 1, feeds: 2, nightEvents: 1, nursingFeeds: 1, total: 3 });
  });

  // A sleep timer left running overnight and beyond is not a sleep.
  it('drops an unfinished or implausible session', () => {
    const running = { ...sleep('2026-03-04T22:00:00', '2026-03-05T06:00:00'), endedAt: undefined } as CareEvent;
    const stuck = sleep('2026-03-04T22:00:00', '2026-03-06T06:00:00');

    expect(getParentReport([running, stuck]).nights).toHaveLength(0);
  });

  it('says nothing rather than zero with no sleep logged', () => {
    const report = getParentReport([]);

    expect(report.averageSleepMinutes).toBeNull();
    expect(report.averageInterruptions).toBeNull();
  });

  describe('attributing the care load', () => {
    const night = sleep('2026-03-04T22:00:00', '2026-03-05T06:00:00');

    it('splits what this parent did from what the household logged', () => {
      const report = getParentReport(
        [night],
        [
          feed('2026-03-05T01:00:00', 'nursing', 'mom-roche'),
          feed('2026-03-05T04:00:00', 'bottle', 'dad-roche'),
          feed('2026-03-05T11:00:00', 'bottle', 'mom-roche')
        ],
        'mom-roche'
      );

      expect(report.care.total).toBe(3);
      expect(report.care.mine).toMatchObject({ feeds: 2, nightEvents: 1, nursingFeeds: 1, total: 2 });
      expect(report.care.unattributed).toBe(0);
    });

    // "Logged by" is optional, so a low share can mean a quiet week or an
    // unfilled field — the report has to be able to tell the difference.
    it('counts entries that name nobody separately', () => {
      const report = getParentReport([night], [feed('2026-03-05T01:00:00'), feed('2026-03-05T04:00:00', 'nursing', 'mom-roche')], 'mom-roche');

      expect(report.care.mine.total).toBe(1);
      expect(report.care.unattributed).toBe(1);
    });

    it('attributes nothing when no caregiver is asked about', () => {
      const report = getParentReport([night], [feed('2026-03-05T01:00:00', 'nursing', 'mom-roche')]);

      expect(report.care.total).toBe(1);
      expect(report.care.mine.total).toBe(0);
    });

    // Whose sleep was broken is not the same question as who got up.
    it('counts an interruption whoever is recorded as having handled it', () => {
      const report = getParentReport([night], [feed('2026-03-05T01:00:00', 'bottle', 'dad-roche')], 'mom-roche');

      expect(report.nights[0].interruptions).toBe(1);
      expect(report.care.mine.total).toBe(0);
    });
  });
});
