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
    expect(SUPPORTED_EVENT_TYPES).toEqual(['bath', 'diaper', 'feed', 'mood', 'note', 'pump', 'sleep', 'tummytime']);
    expect(errors({ type: 'nap' })).toEqual(['type must be one of: bath, diaper, feed, mood, note, pump, sleep, tummytime.']);
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
    expect(errors({ type: 'feed' })).toEqual(['A feed needs an amount (with a unit) or a durationMinutes — or "started": true to fill it in later.']);
    expect(errors({ type: 'feed', unit: 'oz' })).toEqual(['unit was given without an amount.']);
  });

  it('reads a timed feed with no amount as nursing, and keeps fields to their method', () => {
    expect(value({ durationMinutes: 20, side: 'Left', type: 'feed' })).toMatchObject({ durationMinutes: 20, method: 'nursing', side: 'left' });
    // Reported as it ends, so it began 20 minutes ago; a timestamp is the start.
    expect(value({ durationMinutes: 20, type: 'feed' }).startedAt).toBe('2026-10-12T21:20:00.000Z');
    expect(value({ durationMinutes: 20, timestamp: '2026-10-12T21:00:00Z', type: 'feed' }).startedAt).toBe('2026-10-12T21:00:00.000Z');
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
    expect(errors({ type: 'sleep' })).toEqual(['A sleep needs a durationMinutes or a startedAt — or "started": true to fill it in later.']);
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

describe('the types beyond feed, diaper and sleep', () => {
  it('logs a bath with nothing but its time', () => {
    expect(value({ type: 'bath' })).toEqual({ startedAt: NOW.toISOString(), type: 'bath' });
  });

  it('reads mood as a level or as a word', () => {
    expect(value({ level: 3, type: 'mood' })).toMatchObject({ level: 3 });
    expect(value({ level: 'Fussy', type: 'mood' })).toMatchObject({ level: 3 });
    expect(value({ mood: 'happy', type: 'mood' })).toMatchObject({ level: 1 });
    expect(value({ level: 'Inconsolable', type: 'mood' })).toMatchObject({ level: 5 });
    expect(errors({ level: 6, type: 'mood' })[0]).toMatch(/^level must be 1–5/);
    expect(errors({ level: 'grumpy', type: 'mood' })[0]).toMatch(/^level must be 1–5/);
    expect(errors({ type: 'mood' })[0]).toMatch(/^level must be 1–5/);
  });

  it('stores a note as its text', () => {
    expect(value({ text: '  first smile  ', type: 'note' })).toEqual({ notes: 'first smile', startedAt: NOW.toISOString(), type: 'note' });
    expect(value({ notes: 'rolled over', type: 'note' })).toMatchObject({ notes: 'rolled over' });
    expect(errors({ type: 'note' })).toEqual(['A note needs its text (notes or text).']);
    expect(errors({ text: 'x'.repeat(501), type: 'note' })[0]).toMatch(/at most 500/);
  });

  it('logs pumped milk in ounces, both sides unless named', () => {
    expect(value({ amount: 3, type: 'pump', unit: 'oz' })).toEqual({ amountOz: 3, side: 'both', startedAt: NOW.toISOString(), type: 'pump' });
    expect(value({ amount: 90, side: 'right', type: 'pump', unit: 'ml' })).toMatchObject({ side: 'right' });
    expect(errors({ type: 'pump' })).toEqual(['A pump needs an amount with a unit (oz or ml) — or "started": true to fill it in later.']);
    expect(errors({ amount: 3, type: 'pump' })).toEqual(['unit is required with an amount (oz or ml).']);
  });

  it('reads tummy time under any of its names, and starts it that long ago', () => {
    expect(value({ durationMinutes: 10, type: 'tummy' })).toEqual({ durationMinutes: 10, startedAt: '2026-10-12T21:30:00.000Z', type: 'tummytime' });
    expect(value({ durationMinutes: 10, type: 'tummy_time' })).toMatchObject({ type: 'tummytime' });
    expect(errors({ type: 'tummytime' })).toEqual(['Tummy time needs a durationMinutes — or "started": true to fill it in later.']);
    expect(errors({ durationMinutes: 300, type: 'tummytime' })[0]).toMatch(/at most 120/);
  });
});

describe('starting an entry to finish in the app', () => {
  it('starts a feed only when it says which kind', () => {
    expect(value({ method: 'nursing', started: true, type: 'feed' })).toEqual({ method: 'nursing', startedAt: NOW.toISOString(), type: 'feed' });
    expect(value({ method: 'bottle', started: 'true', type: 'feed' })).toEqual({ method: 'bottle', startedAt: NOW.toISOString(), type: 'feed' });
    expect(value({ method: 'nursing', side: 'left', started: true, type: 'feed' })).toMatchObject({ side: 'left' });
    expect(errors({ started: true, type: 'feed' })).toEqual(['A started feed needs a method (bottle or nursing).']);
  });

  it('starts a sleep as one still going, from now or the timestamp', () => {
    expect(value({ started: true, type: 'sleep' })).toEqual({ startedAt: NOW.toISOString(), type: 'sleep' });
    expect(value({ started: true, timestamp: '2026-10-12T21:00:00Z', type: 'sleep' })).toEqual({ startedAt: '2026-10-12T21:00:00.000Z', type: 'sleep' });
  });

  it('starts a pump and tummy time at zero, for the app to fill in', () => {
    expect(value({ side: 'left', started: true, type: 'pump' })).toEqual({ amountOz: 0, side: 'left', startedAt: NOW.toISOString(), type: 'pump' });
    expect(value({ started: true, type: 'tummy' })).toEqual({ durationMinutes: 0, startedAt: NOW.toISOString(), type: 'tummytime' });
  });

  it('ignores the flag once the value is there, and never starts what has no length', () => {
    expect(value({ amount: 4, started: true, type: 'feed', unit: 'oz' })).toMatchObject({ amountOz: 4, method: 'bottle' });
    expect(value({ diaperType: 'wet', started: true, type: 'diaper' })).toMatchObject({ kind: 'wet' });
    expect(errors({ started: true, type: 'mood' })[0]).toMatch(/^level must be 1–5/);
    expect(errors({ started: false, type: 'pump' })[0]).toMatch(/^A pump needs an amount/);
  });

  it('says what to finish in the app', () => {
    expect(describeLoggedEvent(value({ method: 'nursing', started: true, type: 'feed' }), ada)).toBe("Started nursing for Ada at 2:40 PM. Add the length in BabySteps when it's done.");
    expect(describeLoggedEvent(value({ method: 'bottle', started: true, type: 'feed' }), ada)).toBe("Started a bottle for Ada at 2:40 PM. Add the amount in BabySteps when it's done.");
    expect(describeLoggedEvent(value({ started: true, type: 'pump' }), ada)).toBe("Started pumping at 2:40 PM. Add the amount in BabySteps when it's done.");
    expect(describeLoggedEvent(value({ started: true, type: 'tummytime' }), ada)).toBe("Started tummy time for Ada at 2:40 PM. Add the length in BabySteps when it's done.");
    expect(describeLoggedEvent(value({ started: true, type: 'sleep' }), ada)).toBe('Logged Ada asleep since 2:40 PM.');
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
    expect(describeLoggedEvent(value({ durationMinutes: 15, type: 'feed' }), ada)).toBe('Logged a nursing feed for 15 minutes for Ada at 2:25 PM.');
    expect(describeLoggedEvent(value({ type: 'bath' }), ada)).toBe('Logged a bath for Ada at 2:40 PM.');
    expect(describeLoggedEvent(value({ level: 'fussy', type: 'mood' }), ada)).toBe("Logged Ada's mood as fussy at 2:40 PM.");
    expect(describeLoggedEvent(value({ text: 'rolled over', type: 'note' }), ada)).toBe('Saved a note for Ada at 2:40 PM.');
    expect(describeLoggedEvent(value({ amount: 3, side: 'left', type: 'pump', unit: 'oz' }), ada)).toBe('Logged 3 oz pumped on the left side at 2:40 PM.');
    expect(describeLoggedEvent(value({ amount: 5, type: 'pump', unit: 'oz' }), ada)).toBe('Logged 5 oz pumped at 2:40 PM.');
    expect(describeLoggedEvent(value({ durationMinutes: 15, type: 'tummy time' }), ada)).toBe('Logged 15 minutes of tummy time for Ada, starting 2:25 PM.');
  });
});
