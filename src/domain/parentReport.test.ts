import { describe, expect, it } from 'vitest';
import { getNightKey, getParentReport, getRest, isNightDuty } from './parentReport';
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

    // A wakeup the other parent got up for is still the household's work, but
    // it did not break this parent's sleep.
    it('keeps the other parent\'s wakeup in the load but out of this night', () => {
      const report = getParentReport([night], [feed('2026-03-05T01:00:00', 'bottle', 'dad-roche')], 'mom-roche');

      expect(report.care.total).toBe(1);
      expect(report.care.mine.total).toBe(0);
      expect(report.nights[0].interruptions).toBe(0);
    });
  });

  describe('time in bed is not time asleep', () => {
    // 21:30 to 05:00 is 7h30 in bed.
    const night = ['2026-08-06T21:30:00', '2026-08-07T05:00:00'] as const;

    it('counts the whole span when nothing woke them', () => {
      const rest = getRest(...night);

      expect(rest).toMatchObject({ awakeMinutes: 0, inBedMinutes: 450, longestRestMinutes: 450, restMinutes: 450 });
      expect(rest.wakeups).toHaveLength(0);
    });

    // One feed at 01:00: asleep 21:30–01:00, settling until 01:15, then 01:15–05:00.
    it('charges the wakeup and the settling after it', () => {
      const rest = getRest(...night, [feed('2026-08-07T01:00:00')]);

      expect(rest.wakeups).toHaveLength(1);
      expect(rest.restMinutes).toBe(210 + 225);
      expect(rest.awakeMinutes).toBe(15);
      expect(rest.longestRestMinutes).toBe(225);
    });

    // A feed, a change and a re-settle inside half an hour is one broken night,
    // not three.
    it('reads entries within the cluster window as a single wakeup', () => {
      const rest = getRest(...night, [
        feed('2026-08-07T01:00:00'),
        feed('2026-08-07T01:20:00'),
        feed('2026-08-07T01:45:00')
      ]);

      expect(rest.wakeups).toHaveLength(1);
      expect(rest.wakeups[0].events).toBe(3);
      // Awake 01:00–01:45 plus 15 settling.
      expect(rest.awakeMinutes).toBe(60);
    });

    it('splits entries further apart than the window into separate wakeups', () => {
      const rest = getRest(...night, [feed('2026-08-07T01:00:00'), feed('2026-08-07T02:00:00')]);

      expect(rest.wakeups).toHaveLength(2);
    });

    // Twenty minutes with your eyes shut between feeds is not sleep.
    it('drops a stretch too short to be rest', () => {
      const rest = getRest(...night, [feed('2026-08-07T01:00:00'), feed('2026-08-07T01:40:00')]);

      // 21:30–01:00 counts; 01:15–01:40 is 25 minutes and does not; then 01:55–05:00.
      expect(rest.restMinutes).toBe(210 + 185);
      expect(rest.longestRestMinutes).toBe(210);
    });

    it('takes the thresholds as options', () => {
      const rest = getRest(...night, [feed('2026-08-07T01:00:00')], { fallbackAsleepMinutes: 30 });

      expect(rest.restMinutes).toBe(210 + 210);
      expect(rest.awakeMinutes).toBe(30);
    });

    // Woken five minutes before getting up: the settling has nowhere to run, so
    // it costs nothing beyond the minutes actually lost.
    it('clamps settling at getting-up time', () => {
      const rest = getRest(...night, [feed('2026-08-07T04:55:00')]);

      expect(rest.restMinutes).toBe(445);
      expect(rest.awakeMinutes).toBe(5);
    });

    // The whole point of recording a caregiver: a wakeup the other parent
    // handled did not cost this one any sleep.
    it('ignores a wakeup recorded against the other parent', () => {
      const mine = getParentReport(
        [sleep(...night)],
        [feed('2026-08-07T01:00:00', 'nursing', 'brooks-roche')],
        'jenni-roche'
      );

      expect(mine.nights[0].sleepMinutes).toBe(450);
      expect(mine.nights[0].interruptions).toBe(0);
    });

    // Charging a broken night to the parent who slept through it is exactly
    // what recording a caregiver is there to prevent.
    it('charges an entry naming nobody to nobody', () => {
      const report = getParentReport([sleep(...night)], [feed('2026-08-07T01:00:00')], 'jenni-roche');

      expect(report.nights[0].interruptions).toBe(0);
      expect(report.nights[0].sleepMinutes).toBe(450);
      // It is still the household's work, and still counted as unattributed.
      expect(report.care.total).toBe(1);
      expect(report.care.unattributed).toBe(1);
    });

    it('counts a wakeup recorded against this parent', () => {
      const report = getParentReport(
        [sleep(...night)],
        [feed('2026-08-07T01:00:00', 'nursing', 'jenni-roche')],
        'jenni-roche'
      );

      expect(report.nights[0].interruptions).toBe(1);
      expect(report.nights[0].sleepMinutes).toBe(435);
      expect(report.nights[0].inBedMinutes).toBe(450);
    });

    // Asking about the household rather than a person still counts everything.
    it('counts every entry when no parent is named', () => {
      const report = getParentReport([sleep(...night)], [feed('2026-08-07T01:00:00')]);

      expect(report.nights[0].interruptions).toBe(1);
    });
  });

  // A backfilled night and the same night logged by hand cover the same hours;
  // adding them together reported a fourteen-hour night.
  describe('overlapping entries', () => {
    it('merges two entries covering the same night', () => {
      const report = getParentReport([
        sleep('2026-08-06T21:30:00', '2026-08-07T05:00:00'),
        sleep('2026-08-06T22:30:00', '2026-08-07T05:00:00')
      ]);

      expect(report.nights).toHaveLength(1);
      expect(report.nights[0]).toMatchObject({ inBedMinutes: 450, sessions: 1, sleepMinutes: 450 });
    });

    it('extends the merged span to the later end', () => {
      const report = getParentReport([
        sleep('2026-08-06T21:30:00', '2026-08-07T04:00:00'),
        sleep('2026-08-06T23:00:00', '2026-08-07T06:00:00')
      ]);

      expect(report.nights[0].inBedMinutes).toBe(510);
    });

    // A night and the nap after it are two separate stretches, not one.
    it('keeps spans that only touch as two sessions', () => {
      const report = getParentReport([
        sleep('2026-08-06T21:30:00', '2026-08-07T05:00:00'),
        sleep('2026-08-07T06:00:00', '2026-08-07T08:00:00')
      ]);

      expect(report.nights[0]).toMatchObject({ inBedMinutes: 570, sessions: 2 });
    });
  });

  // The average longest run can fall as a period widens and takes in worse
  // nights; the best single night only ever goes up. Both are reported so the
  // one that looks impossible can be read against the one that is not.
  it('reports the best night\'s longest run as well as the average', () => {
    const report = getParentReport(
      [
        sleep('2026-08-06T21:30:00', '2026-08-07T05:00:00'),
        sleep('2026-08-07T21:30:00', '2026-08-08T05:00:00')
      ],
      [feed('2026-08-07T01:00:00', 'nursing', 'jenni-roche')],
      'jenni-roche'
    );

    // One night runs unbroken (450); the other splits at 01:00 into 210 and 225.
    expect(report.bestStretchMinutes).toBe(450);
    expect(report.averageLongestStretchMinutes).toBe(338);
  });
});
