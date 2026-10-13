import { describe, expect, it } from 'vitest';
import { describeCryContext, getCryContext } from './cryContext';
import type { CareEvent } from './types';

const base = { babyId: 'avery-example', createdAt: '2026-10-01T00:00:00.000Z', syncState: 'synced' as const, updatedAt: '2026-10-01T00:00:00.000Z' };
const at = (local: string) => new Date(local).toISOString();
const feed = (local: string): CareEvent => ({ ...base, durationMinutes: 20, id: `feed_${local}`, method: 'nursing', startedAt: at(local), type: 'feed' }) as CareEvent;
const diaper = (local: string): CareEvent => ({ ...base, id: `diaper_${local}`, kind: 'wet', startedAt: at(local), type: 'diaper' }) as CareEvent;
const sleep = (from: string, to?: string): CareEvent => ({ ...base, endedAt: to ? at(to) : undefined, id: `sleep_${from}`, startedAt: at(from), type: 'sleep' }) as CareEvent;
const temperature = (local: string): CareEvent => ({ ...base, celsius: 37.2, id: `temp_${local}`, startedAt: at(local), type: 'temperature' }) as CareEvent;

// Feeds every 2.5h, changes every 3h.
const events: CareEvent[] = [
  feed('2026-10-13T06:00'),
  feed('2026-10-13T08:30'),
  feed('2026-10-13T11:00'),
  feed('2026-10-13T13:30'),
  feed('2026-10-13T16:00'),
  diaper('2026-10-13T05:00'),
  diaper('2026-10-13T08:00'),
  diaper('2026-10-13T11:00'),
  diaper('2026-10-13T14:00'),
  diaper('2026-10-13T17:00'),
  sleep('2026-10-13T16:30', '2026-10-13T18:00'),
  temperature('2026-10-13T15:00')
];

describe('what the log says around a cry', () => {
  it('reads the last feed and change against this baby’s usual gaps', () => {
    const context = getCryContext(events, at('2026-10-13T18:40'));

    expect(context.feed).toMatchObject({ due: true, minutesBefore: 160, usualMinutes: 150 });
    expect(context.change).toMatchObject({ due: false, minutesBefore: 100, usualMinutes: 180 });
    expect(context.awakeMinutes).toBe(40);
    expect(context.duringSleep).toBe(false);
    expect(context.recentCare.map((care) => care.type)).toEqual(['temperature']);
    // The due clue leads.
    expect(describeCryContext(context).map((phrase) => phrase.text)).toEqual([
      'fed 2h 40m before (usually 2h 30m)',
      'changed 1h 40m before (usually 3h)',
      'awake 40m',
      'temperature taken in the 6h before'
    ]);
  });

  it('names no usual gap off too few, and never calls one due without it', () => {
    const context = getCryContext([feed('2026-10-13T06:00'), feed('2026-10-13T08:30')], at('2026-10-13T12:00'));

    expect(context.feed).toMatchObject({ due: false, usualMinutes: null });
    expect(context.change).toBeNull();
  });

  it('says so when the crying came during a logged sleep', () => {
    const context = getCryContext([sleep('2026-10-13T19:00')], at('2026-10-13T21:00'));

    expect(context.duringSleep).toBe(true);
    expect(context.awakeMinutes).toBeNull();
  });
});
