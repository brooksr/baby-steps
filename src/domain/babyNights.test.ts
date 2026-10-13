import { describe, expect, it } from 'vitest';
import { getBabyNight, getBabyNightsReport, getCurrentNightKey, shiftNightKey } from './babyNights';
import type { NurseryData } from './nurserySensor';
import type { CareEvent } from './types';

const base = { babyId: 'avery-example', createdAt: '2026-10-01T00:00:00.000Z', syncState: 'synced' as const, updatedAt: '2026-10-01T00:00:00.000Z' };
const at = (local: string) => new Date(local).toISOString();

function feed(startedAt: string, durationMinutes = 20): CareEvent {
  return { ...base, durationMinutes, id: `feed_${startedAt}`, method: 'nursing', startedAt: at(startedAt), type: 'feed' } as CareEvent;
}

function diaper(startedAt: string): CareEvent {
  return { ...base, id: `diaper_${startedAt}`, kind: 'wet', startedAt: at(startedAt), type: 'diaper' } as CareEvent;
}

function sleep(startedAt: string, endedAt?: string): CareEvent {
  return { ...base, endedAt: endedAt ? at(endedAt) : undefined, id: `sleep_${startedAt}`, startedAt: at(startedAt), type: 'sleep' } as CareEvent;
}

function pump(startedAt: string): CareEvent {
  return { ...base, amountOz: 3, id: `pump_${startedAt}`, startedAt: at(startedAt), type: 'pump' } as CareEvent;
}

/** A night shaped like a real one: bedtime logged, then only the feeds and changes. */
const loggedNight: CareEvent[] = [
  sleep('2026-10-12T19:00', '2026-10-12T21:50'),
  diaper('2026-10-12T21:52'),
  feed('2026-10-12T21:55'),
  feed('2026-10-13T01:13'),
  pump('2026-10-13T02:30'),
  feed('2026-10-13T03:08'),
  feed('2026-10-13T05:32'),
  diaper('2026-10-13T05:43')
];

const afternoon = new Date('2026-10-13T15:00');

const nursery: NurseryData = {
  episodes: [
    { endedAt: at('2026-10-13T01:12:30'), label: 'baby_cry', maxScore: 0.9, startedAt: at('2026-10-13T01:12') },
    { endedAt: at('2026-10-13T01:14:10'), label: 'baby_cry', maxScore: 0.8, startedAt: at('2026-10-13T01:14') },
    { endedAt: at('2026-10-13T02:31'), label: 'baby_cry', maxScore: 0.7, startedAt: at('2026-10-13T02:30') },
    { endedAt: at('2026-10-13T04:00:05'), label: 'speech', maxScore: 0.9, startedAt: at('2026-10-13T04:00') }
  ],
  nights: [{ coveragePercent: 98.3, cryEpisodes: 3, nightOf: '2026-10-12', status: 'complete' }]
};

const clock = (iso: string) => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

describe('a baby’s night', () => {
  it('reads wakes from night care entries and sleep from the stretches between them', () => {
    const night = getBabyNight(loggedNight, '2026-10-12', null, afternoon);

    expect(night.tracked).toBe(true);
    expect(night.inProgress).toBe(false);
    expect(clock(night.bedtime as string)).toBe('19:00');
    // The 21:52 change and 21:55 feed are one wake, which began when the logged sleep ended.
    expect(night.wakes.map((wake) => [clock(wake.startedAt), clock(wake.resumedAt), wake.entries])).toEqual([
      ['21:50', '22:30', 2],
      ['01:13', '01:48', 1],
      ['03:08', '03:43', 1],
      ['05:32', '06:07', 2]
    ]);
    // A pump is the parent's, not a wake.
    expect(night.wakes.flatMap((wake) => wake.types)).not.toContain('pump');
    expect(night.sleeps.map((stretch) => [clock(stretch.startedAt), stretch.minutes, stretch.source])).toEqual([
      ['19:00', 170, 'logged'],
      ['22:30', 163, 'estimated'],
      ['01:48', 80, 'estimated'],
      ['03:43', 109, 'estimated'],
      ['06:07', 53, 'estimated']
    ]);
    expect(night.sleepMinutes).toBe(575);
    expect(night.longestStretchMinutes).toBe(170);
    expect(night.estimated).toBe(true);
  });

  it('lays heard crying over the night without changing a single number', () => {
    const plain = getBabyNight(loggedNight, '2026-10-12', null, afternoon);
    const heard = getBabyNight(loggedNight, '2026-10-12', nursery, afternoon);

    expect(heard.sleepMinutes).toBe(plain.sleepMinutes);
    expect(heard.wakes).toHaveLength(plain.wakes.length);
    expect(heard.wakes.map((wake) => wake.heard)).toEqual([false, true, false, false]);
    // Two close episodes are one bout; speech is not crying.
    expect(heard.heard.map((cry) => [clock(cry.startedAt), cry.episodes, cry.withWake])).toEqual([
      ['01:12', 2, true],
      ['02:30', 1, false]
    ]);
    expect(heard.sensor).toEqual({ coveragePercent: 98.3, cryEpisodes: 3 });
  });

  it('treats entries at either end of the night as going down and getting up, not wakes', () => {
    const night = getBabyNight([feed('2026-10-12T19:10', 15), feed('2026-10-13T02:00'), feed('2026-10-13T06:45')], '2026-10-12', null, afternoon);

    expect(night.bedtime).toBeNull();
    expect(night.wakes).toHaveLength(1);
    expect(night.edges.map((edge) => clock(edge.startedAt))).toEqual(['19:10', '06:45']);
    expect(night.sleeps.map((stretch) => [clock(stretch.startedAt), stretch.minutes])).toEqual([
      ['19:40', 380],
      ['02:35', 250]
    ]);
  });

  it('reads an evening entry before 9pm as the bedtime routine unless a bedtime was logged', () => {
    const evening = [diaper('2026-10-12T19:30'), feed('2026-10-12T20:10'), feed('2026-10-13T01:00')];
    const unlogged = getBabyNight(evening, '2026-10-12', null, afternoon);

    expect(unlogged.wakes.map((wake) => clock(wake.startedAt))).toEqual(['01:00']);
    expect(unlogged.edges.map((edge) => [clock(edge.startedAt), edge.entries])).toEqual([['19:30', 2]]);
    expect(clock(unlogged.sleeps[0].startedAt)).toBe('20:45');
    // Down at 7, up for a feed at 8: with the bedtime logged, that feed broke the night.
    const logged = getBabyNight(
      [sleep('2026-10-12T19:00', '2026-10-12T20:00'), feed('2026-10-12T20:10'), sleep('2026-10-12T20:45', '2026-10-13T00:50'), feed('2026-10-13T01:00')],
      '2026-10-12',
      null,
      afternoon
    );
    expect(logged.wakes.map((wake) => [clock(wake.startedAt), clock(wake.resumedAt)])).toEqual([
      ['20:00', '20:45'],
      ['00:50', '01:35']
    ]);
  });

  it('joins two wakes with too little between them to count as sleep', () => {
    const night = getBabyNight([feed('2026-10-13T01:00', 15), feed('2026-10-13T01:50', 15)], '2026-10-12', null, afternoon);

    expect(night.wakes.map((wake) => [clock(wake.startedAt), clock(wake.resumedAt), wake.entries])).toEqual([['01:00', '02:20', 2]]);
  });

  it('takes a logged resettle over the settling allowance', () => {
    const night = getBabyNight([feed('2026-10-13T01:00'), sleep('2026-10-13T01:25', '2026-10-13T05:00')], '2026-10-12', null, afternoon);

    expect(clock(night.wakes[0].resumedAt)).toBe('01:25');
    expect(night.sleeps.find((stretch) => clock(stretch.startedAt) === '01:25')?.source).toBe('mixed');
  });

  it('runs a night still under way up to now', () => {
    const events = [sleep('2026-10-12T19:30'), feed('2026-10-13T01:00')];
    const night = getBabyNight(events, '2026-10-12', null, new Date('2026-10-13T02:30'));

    expect(night.inProgress).toBe(true);
    expect(clock(night.bedtime as string)).toBe('19:30');
    expect(night.sleeps.map((stretch) => [clock(stretch.startedAt), clock(stretch.endedAt)])).toEqual([
      ['19:30', '01:00'],
      ['01:35', '02:30']
    ]);
    // Twenty-five minutes back down is not yet a stretch.
    expect(getBabyNight(events, '2026-10-12', null, new Date('2026-10-13T02:00')).sleeps).toHaveLength(1);
  });

  it('says nothing about a night nobody logged around', () => {
    const night = getBabyNight([], '2026-10-12', nursery, afternoon);

    expect(night.tracked).toBe(false);
    expect(night.sleeps).toEqual([]);
    expect(night.sensor).not.toBeNull();
  });
});

describe('nights over a span', () => {
  it('averages finished, tracked nights only, and counts logged naps by day', () => {
    const events = [
      ...loggedNight,
      sleep('2026-10-12T09:30', '2026-10-12T11:00'),
      sleep('2026-10-12T13:00', '2026-10-12T14:00'),
      feed('2026-10-11T23:00'),
      feed('2026-10-12T03:00'),
      // Tonight is under way, and must not be averaged in.
      feed('2026-10-13T19:30')
    ];
    const report = getBabyNightsReport(events, null, 7, new Date('2026-10-13T21:00'));

    expect(report.nights.map((night) => night.dateKey)).toEqual(['2026-10-11', '2026-10-12']);
    expect(report.wakes).toEqual({ average: 3, max: 4, min: 2 });
    expect(report.longestStretchMinutes?.max).toBe(Math.max(...report.nights.map((night) => night.longestStretchMinutes)));
    expect(report.napMinutes).toEqual({ average: 150, max: 150, min: 150 });
    expect(report.estimatedNights).toBe(2);
  });

  it('has no averages without a tracked night', () => {
    const report = getBabyNightsReport([], null, 7, afternoon);

    expect(report.nights).toEqual([]);
    expect(report.sleepMinutes).toBeNull();
    expect(report.wakes).toBeNull();
  });
});

describe('night keys', () => {
  it('is last night until 7pm, then tonight', () => {
    expect(getCurrentNightKey(new Date('2026-10-13T05:00'))).toBe('2026-10-12');
    expect(getCurrentNightKey(new Date('2026-10-13T18:59'))).toBe('2026-10-12');
    expect(getCurrentNightKey(new Date('2026-10-13T19:00'))).toBe('2026-10-13');
  });

  it('steps by calendar day across a month end', () => {
    expect(shiftNightKey('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftNightKey('2026-11-01', -1)).toBe('2026-10-31');
  });
});
