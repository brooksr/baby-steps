import { describe, expect, it } from 'vitest';
import { describeLoggedEvent, parseEventRequest, resolveChild, SUPPORTED_EVENT_TYPES, type EventInput } from './eventRequest';
import type { BabyProfile } from './types';

const NOW = new Date('2026-10-12T21:40:00.000Z');

const ada: BabyProfile = {
  createdAt: '2026-08-01T00:00:00.000Z',
  id: 'ada-example',
  kind: 'child',
  name: 'Ada Example',
  syncState: 'synced',
  timezone: 'America/Los_Angeles',
  updatedAt: '2026-08-01T00:00:00.000Z'
};
const ben: BabyProfile = { ...ada, createdAt: '2026-08-01T00:00:01.000Z', id: 'ben-example', name: 'Ben Example' };
const mom: BabyProfile = { ...ada, id: 'mom', kind: 'parent', name: 'Mom', parentRole: 'mom' };

function parse(body: unknown) {
  return parseEventRequest(body, NOW);
}

function value(body: unknown): EventInput {
  const result = parse(body);

  if (!result.ok) {
    throw new Error(result.errors.join(' '));
  }

  return result.value;
}

function errors(body: unknown) {
  const result = parse(body);
  return result.ok ? [] : result.errors;
}

describe('parseEventRequest', () => {
  it('lists the types it can log', () => {
    expect(SUPPORTED_EVENT_TYPES).toEqual(['diaper', 'feed', 'sleep']);
    expect(errors({ type: 'nap' })).toEqual(['type must be one of: diaper, feed, sleep.']);
    expect(errors(null)).toEqual(['The request body must be a JSON object.']);
    expect(errors([])).toEqual(['The request body must be a JSON object.']);
  });

  it('reads an amount as a bottle in canonical ounces, stamped now by default', () => {
    expect(value({ amount: 4, source: 'voice', type: 'feed', unit: 'oz' })).toEqual({
      amountOz: 4,
      method: 'bottle',
      startedAt: NOW.toISOString(),
      type: 'feed'
    });
    expect(value({ amount: '2.5', type: 'Feed', unit: 'Ounces' })).toMatchObject({ amountOz: 2.5 });
    expect(value({ amount: 3, type: 'feed', unit: 'ounce' })).toMatchObject({ amountOz: 3 });
  });

  it('converts millilitres with the app’s own conversion', () => {
    const feed = value({ amount: 120, type: 'feed', unit: 'ml' });
    expect(feed.type === 'feed' && feed.amountOz).toBeCloseTo(4.0577, 3);
  });

  it('refuses an amount it would have to guess about', () => {
    expect(errors({ amount: 4, type: 'feed' })).toEqual(['unit is required with an amount (oz or ml).']);
    expect(errors({ amount: 4, type: 'feed', unit: 'cups' })).toEqual(['unit is required with an amount (oz or ml).']);
    expect(errors({ amount: 'four', type: 'feed', unit: 'oz' })).toEqual(['amount must be a number.']);
    expect(errors({ amount: 0, type: 'feed', unit: 'oz' })[0]).toMatch(/more than 0/);
    expect(errors({ amount: -2, type: 'feed', unit: 'oz' })[0]).toMatch(/more than 0/);
    expect(errors({ amount: 40, type: 'feed', unit: 'oz' })[0]).toMatch(/at most 16 oz/);
    expect(errors({ type: 'feed' })).toEqual(['A feed needs an amount (with a unit) or a durationMinutes.']);
    expect(errors({ type: 'feed', unit: 'oz' })).toEqual(['unit was given without an amount.']);
  });

  it('reads a timed feed with no amount as nursing, and keeps fields to their method', () => {
    expect(value({ durationMinutes: 20, side: 'Left', type: 'feed' })).toMatchObject({ durationMinutes: 20, method: 'nursing', side: 'left' });
    expect(value({ amount: 3, contents: 'formula', type: 'feed', unit: 'oz' })).toMatchObject({ contents: 'formula', method: 'bottle' });
    expect(errors({ amount: 3, side: 'left', type: 'feed', unit: 'oz' })).toEqual(['side only applies to a nursing feed.']);
    expect(errors({ contents: 'formula', durationMinutes: 10, type: 'feed' })).toEqual(['contents only applies to a bottle feed.']);
    expect(errors({ durationMinutes: 600, type: 'feed' })[0]).toMatch(/at most 240/);
  });

  it('maps diaper words onto the diaper kinds', () => {
    expect(value({ diaperType: 'wet', type: 'diaper' })).toEqual({ kind: 'wet', startedAt: NOW.toISOString(), type: 'diaper' });
    expect(value({ diaperType: 'DIRTY', poopSize: 'large', type: 'diaper' })).toMatchObject({ kind: 'dirty', poopSize: 'large' });
    expect(value({ kind: 'both', type: 'diaper' })).toMatchObject({ kind: 'both' });
    expect(value({ diaperType: 'poop', type: 'diaper' })).toMatchObject({ kind: 'dirty' });
    expect(errors({ type: 'diaper' })[0]).toMatch(/^diaperType is required/);
    expect(errors({ diaperType: 'damp', type: 'diaper' })[0]).toMatch(/^diaperType must be one of/);
    expect(errors({ diaperType: 'wet', poopSize: 'small', type: 'diaper' })).toEqual(['poopSize only applies to a dirty or both diaper.']);
  });

  it('ends a sleep given as a duration at the timestamp, or now', () => {
    expect(value({ durationMinutes: 45, type: 'sleep' })).toEqual({
      endedAt: NOW.toISOString(),
      startedAt: '2026-10-12T20:55:00.000Z',
      type: 'sleep'
    });
    expect(value({ durationMinutes: 30, timestamp: '2026-10-12T13:00:00-07:00', type: 'sleep' })).toMatchObject({
      endedAt: '2026-10-12T20:00:00.000Z',
      startedAt: '2026-10-12T19:30:00.000Z'
    });
    expect(value({ durationMinutes: 60, startedAt: '2026-10-12T12:00:00-07:00', type: 'sleep' })).toMatchObject({
      endedAt: '2026-10-12T20:00:00.000Z',
      startedAt: '2026-10-12T19:00:00.000Z'
    });
  });

  it('takes a sleep as explicit start and end, or as a start still running', () => {
    expect(value({ end: '2026-10-12T14:00:00-07:00', start: '2026-10-12T12:30:00-07:00', type: 'sleep' })).toEqual({
      endedAt: '2026-10-12T21:00:00.000Z',
      startedAt: '2026-10-12T19:30:00.000Z',
      type: 'sleep'
    });
    expect(value({ startedAt: '2026-10-12T14:00:00-07:00', type: 'sleep' })).toEqual({ startedAt: '2026-10-12T21:00:00.000Z', type: 'sleep' });
  });

  it('refuses a sleep that is not a real span', () => {
    expect(errors({ type: 'sleep' })).toEqual(['A sleep needs a durationMinutes or a startedAt.']);
    expect(errors({ endedAt: '2026-10-12T12:00:00-07:00', startedAt: '2026-10-12T13:00:00-07:00', type: 'sleep' })).toEqual(['A sleep must end after it starts.']);
    expect(errors({ durationMinutes: 20 * 60, type: 'sleep' })[0]).toMatch(/at most 960/);
    expect(errors({ endedAt: '2026-10-12T14:00:00-07:00', startedAt: '2026-10-11T14:00:00-07:00', type: 'sleep' })[0]).toMatch(/timer left running/);
    expect(errors({ durationMinutes: 600, startedAt: '2026-10-12T12:00:00-07:00', type: 'sleep' })).toEqual(['A sleep cannot end in the future.']);
    expect(errors({ durationMinutes: 30, endedAt: '2026-10-12T14:00:00-07:00', startedAt: '2026-10-12T13:00:00-07:00', type: 'sleep' })[0]).toMatch(/not all three/);
  });

  it('only accepts timestamps that name their offset and are plausibly recent', () => {
    expect(value({ diaperType: 'wet', timestamp: '2026-10-12T14:32:00-07:00', type: 'diaper' }).startedAt).toBe('2026-10-12T21:32:00.000Z');
    expect(value({ diaperType: 'wet', timestamp: '2026-10-12T21:32:00Z', type: 'diaper' }).startedAt).toBe('2026-10-12T21:32:00.000Z');
    expect(errors({ diaperType: 'wet', timestamp: '2026-10-12T14:32:00', type: 'diaper' })[0]).toMatch(/with an offset/);
    expect(errors({ diaperType: 'wet', timestamp: 'yesterday', type: 'diaper' })[0]).toMatch(/with an offset/);
    expect(errors({ diaperType: 'wet', timestamp: '2026-10-12T23:00:00Z', type: 'diaper' })).toEqual(['timestamp is in the future.']);
    expect(errors({ diaperType: 'wet', timestamp: '2026-08-01T12:00:00Z', type: 'diaper' })).toEqual(['timestamp is more than 30 days ago.']);
  });

  it('keeps notes, and reports every problem at once', () => {
    expect(value({ diaperType: 'wet', notes: '  rash cream  ', type: 'diaper' })).toMatchObject({ notes: 'rash cream' });
    expect(errors({ diaperType: 'wet', notes: 'x'.repeat(501), type: 'diaper' })[0]).toMatch(/at most 500/);
    expect(errors({ diaperType: 'damp', timestamp: 'soon', type: 'diaper' })).toHaveLength(2);
  });
});

describe('resolveChild', () => {
  it('defaults to the only child, never to a parent', () => {
    expect(resolveChild([mom, ada], undefined)).toEqual({ ok: true, value: ada });
  });

  it('asks which child when there is more than one', () => {
    expect(resolveChild([ada, ben], undefined)).toEqual({ errors: ['Name the child: Ada, Ben.'], ok: false });
    expect(resolveChild([ada, ben], 'ben')).toEqual({ ok: true, value: ben });
    expect(resolveChild([ada, ben], 'Ada Example')).toEqual({ ok: true, value: ada });
    expect(resolveChild([ada, ben], 'ben-example')).toEqual({ ok: true, value: ben });
    expect(resolveChild([ada, ben], 'Cleo')).toEqual({ errors: ['No child named "Cleo".'], ok: false });
    expect(resolveChild([ada, ben], 3)).toEqual({ errors: ['child must be a string.'], ok: false });
  });

  it('does not log against an archived child or a parent', () => {
    const archived = { ...ben, archivedAt: '2026-09-01T00:00:00.000Z' };
    expect(resolveChild([ada, archived], undefined)).toEqual({ ok: true, value: ada });
    expect(resolveChild([ada, archived], 'ben').ok).toBe(false);
    expect(resolveChild([ada, mom], 'mom').ok).toBe(false);
    expect(resolveChild([mom], undefined)).toEqual({ errors: ['This family has no children to log for.'], ok: false });
  });
});

describe('describeLoggedEvent', () => {
  it('reads back in the child’s units and timezone', () => {
    expect(describeLoggedEvent(value({ amount: 4, timestamp: '2026-10-12T14:32:00-07:00', type: 'feed', unit: 'oz' }), ada)).toBe(
      'Logged a 4 oz bottle for Ada at 2:32 PM.'
    );
    expect(describeLoggedEvent(value({ amount: 4, type: 'feed', unit: 'oz' }), { ...ada, preferredUnits: { system: 'metric', weightDisplay: 'ounces' } })).toMatch(
      /^Logged a 118 mL bottle/
    );
    expect(describeLoggedEvent(value({ diaperType: 'both', timestamp: '2026-10-12T09:05:00-07:00', type: 'diaper' }), ada)).toBe(
      'Logged a both diaper for Ada at 9:05 AM.'
    );
    expect(describeLoggedEvent(value({ durationMinutes: 75, type: 'sleep' }), ada)).toBe('Logged 1 hour 15 minutes of sleep for Ada, from 1:25 PM to 2:40 PM.');
    expect(describeLoggedEvent(value({ durationMinutes: 15, type: 'feed' }), ada)).toBe('Logged a nursing feed for 15 minutes for Ada at 2:40 PM.');
  });
});
