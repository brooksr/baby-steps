import { describe, expect, it } from 'vitest';
import { createFamilyProfile } from './family';
import { DEFAULT_NAP_WINDOW, DEFAULT_SLEEP_WINDOW, isWithinShift, planAttribution, planParentSleeps, shiftFor, toMinuteOfDay } from './nightShift';
import type { CareEvent } from './types';

const jenni = createFamilyProfile({ kind: 'parent', name: 'Jenni Roche', parentRole: 'mom' });
const brooks = createFamilyProfile({ kind: 'parent', name: 'Brooks Roche', parentRole: 'dad' }, [jenni]);

const shifts = [
  { caregiverId: jenni.id, end: '05:00', start: '21:30' },
  { caregiverId: brooks.id, end: '09:00', start: '05:00' }
];

function feed(startedAt: string, caregiverId?: string): CareEvent {
  return {
    babyId: 'theo-roche',
    caregiverId,
    createdAt: startedAt,
    id: `feed_${startedAt}`,
    method: 'nursing',
    startedAt,
    syncState: 'synced',
    type: 'feed',
    updatedAt: startedAt
  } as CareEvent;
}

describe('shift windows', () => {
  // A night shift is the one window that has to wrap past midnight.
  it('wraps a window whose end is before its start', () => {
    const night = { end: '05:00', start: '21:30' };

    expect(isWithinShift(toMinuteOfDay('23:00'), night)).toBe(true);
    expect(isWithinShift(toMinuteOfDay('02:00'), night)).toBe(true);
    expect(isWithinShift(toMinuteOfDay('21:30'), night)).toBe(true);
    expect(isWithinShift(toMinuteOfDay('05:00'), night)).toBe(false);
    expect(isWithinShift(toMinuteOfDay('12:00'), night)).toBe(false);
  });

  it('reads a same-day window plainly', () => {
    const morning = { end: '09:00', start: '05:00' };

    expect(isWithinShift(toMinuteOfDay('06:30'), morning)).toBe(true);
    expect(isWithinShift(toMinuteOfDay('09:00'), morning)).toBe(false);
    expect(isWithinShift(toMinuteOfDay('04:59'), morning)).toBe(false);
  });

  // The boundary belongs to the shift that is starting, so 5am is Brooks'.
  it('hands an instant to the shift covering it', () => {
    expect(shiftFor('2026-08-07T23:10:00', shifts)?.caregiverId).toBe(jenni.id);
    expect(shiftFor('2026-08-07T04:59:00', shifts)?.caregiverId).toBe(jenni.id);
    expect(shiftFor('2026-08-07T05:00:00', shifts)?.caregiverId).toBe(brooks.id);
    expect(shiftFor('2026-08-07T14:00:00', shifts)).toBeUndefined();
  });
});

describe('planning an attribution pass', () => {
  const events = [
    feed('2026-08-05T23:00:00'), // before the start date
    feed('2026-08-07T01:00:00'),
    feed('2026-08-07T06:30:00'),
    feed('2026-08-07T14:00:00'), // no shift covers the afternoon
    feed('2026-08-07T22:00:00', brooks.id) // already named
  ];

  it('assigns by the shift the entry falls in', () => {
    const plan = planAttribution(events, shifts, '2026-08-06');

    expect(plan.assignments).toEqual([
      { caregiverId: jenni.id, event: events[1] },
      { caregiverId: brooks.id, event: events[2] }
    ]);
  });

  it('leaves the afternoon and anything before the start date alone', () => {
    const plan = planAttribution(events, shifts, '2026-08-06');

    expect(plan.uncovered).toBe(1);
    expect(plan.assignments.map(({ event }) => event.startedAt)).not.toContain('2026-08-05T23:00:00');
  });

  // A caregiver recorded by hand is better evidence than a rule about the clock.
  it('never overwrites an entry that already names someone', () => {
    const plan = planAttribution(events, shifts, '2026-08-06');

    expect(plan.alreadyAttributed).toBe(1);
    expect(plan.assignments.map(({ event }) => event.id)).not.toContain(events[4].id);
  });
});

describe('planning the parent sleeps', () => {
  it('makes one entry per night across the span', () => {
    const nights = planParentSleeps(jenni, { end: '05:00', start: '21:30' }, '2026-08-06', '2026-08-09');

    expect(nights).toHaveLength(4);
    expect(nights[0]).toMatchObject({
      babyId: jenni.id,
      endedAt: new Date('2026-08-07T05:00:00').toISOString(),
      startedAt: new Date('2026-08-06T21:30:00').toISOString(),
      type: 'sleep'
    });
  });

  // Running it twice must propose the same entries, not a second set.
  it('derives a stable id from the parent and the night', () => {
    const once = planParentSleeps(jenni, { end: '05:00', start: '21:30' }, '2026-08-06', '2026-08-09');
    const twice = planParentSleeps(jenni, { end: '05:00', start: '21:30' }, '2026-08-06', '2026-08-09');

    expect(once.map((night) => night.id)).toEqual(twice.map((night) => night.id));
    expect(new Set(once.map((night) => night.id)).size).toBe(4);
  });

  it('stops before a night that has not finished yet', () => {
    const far = planParentSleeps(jenni, { end: '05:00', start: '21:30' }, '2026-08-06', '2099-01-01');

    expect(far.every((night) => new Date(night.endedAt as string).getTime() <= Date.now())).toBe(true);
  });

  // The shifts say who gets up, not who is asleep — so both parents get the
  // same hours in bed, and the off-duty one sleeps through the night entries.
  it('gives every parent the same window, whatever shift they are on', () => {
    const hers = planParentSleeps(jenni, DEFAULT_SLEEP_WINDOW, '2026-08-06', '2026-08-07');
    const his = planParentSleeps(brooks, DEFAULT_SLEEP_WINDOW, '2026-08-06', '2026-08-07');

    expect(hers[0].startedAt).toBe(his[0].startedAt);
    expect(hers[0].endedAt).toBe(his[0].endedAt);
    expect(hers[0].babyId).toBe(jenni.id);
    expect(his[0].babyId).toBe(brooks.id);
  });

  describe('the morning nap', () => {
    it('makes a same-day entry that does not wrap past midnight', () => {
      const naps = planParentSleeps(jenni, DEFAULT_NAP_WINDOW, '2026-08-06', '2026-08-07');

      expect(naps).toHaveLength(2);
      expect(naps[0]).toMatchObject({
        endedAt: new Date('2026-08-06T08:00:00').toISOString(),
        startedAt: new Date('2026-08-06T06:00:00').toISOString()
      });
    });

    // A nap and the night it follows are two entries for one person on one day,
    // so the id has to carry the window as well as the date.
    it('never collides with the night sleep it belongs to', () => {
      const nights = planParentSleeps(jenni, DEFAULT_SLEEP_WINDOW, '2026-08-06', '2026-08-07');
      const naps = planParentSleeps(jenni, DEFAULT_NAP_WINDOW, '2026-08-06', '2026-08-07');

      expect(new Set([...nights, ...naps].map((entry) => entry.id)).size).toBe(4);
    });
  });
});
