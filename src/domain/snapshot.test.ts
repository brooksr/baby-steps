import { describe, expect, it } from 'vitest';
import { eventsSignature, snapshotSignature } from './snapshot';
import type { BabyProfile, CareEvent } from './types';

const profile: BabyProfile = {
  createdAt: '2026-06-20T16:15:00.000Z',
  dueDate: '2026-09-01',
  id: 'theo-roche',
  name: 'Theo Roche',
  syncState: 'synced',
  timezone: 'America/Los_Angeles',
  updatedAt: '2026-06-20T16:15:00.000Z'
};

function diaper(overrides: Partial<CareEvent> = {}): CareEvent {
  return {
    babyId: 'theo-roche',
    createdAt: '2026-09-02T11:00:00.000Z',
    id: 'event_1',
    kind: 'wet',
    startedAt: '2026-09-02T11:00:00.000Z',
    syncState: 'synced',
    type: 'diaper',
    updatedAt: '2026-09-02T11:00:00.000Z',
    ...overrides
  } as CareEvent;
}

describe('snapshot signatures', () => {
  it('is stable across reads of identical data', () => {
    expect(eventsSignature([diaper()])).toBe(eventsSignature([diaper()]));
  });

  // Two reads of the sheet build their objects in whatever order the parser
  // happens to fill them, so key order must not register as a change.
  it('ignores key order', () => {
    const a = { ...diaper(), notes: 'first' } as CareEvent;
    const b = { notes: 'first', ...diaper() } as CareEvent;

    expect(eventsSignature([a])).toBe(eventsSignature([b]));
  });

  it('changes when a field someone else edited changes', () => {
    expect(eventsSignature([diaper()])).not.toBe(eventsSignature([diaper({ kind: 'dirty' } as Partial<CareEvent>)]));
  });

  it('changes when an event is added or removed', () => {
    expect(eventsSignature([diaper()])).not.toBe(eventsSignature([diaper(), diaper({ id: 'event_2' })]));
    expect(eventsSignature([])).not.toBe(eventsSignature([diaper()]));
  });

  it('covers the profile as well as the events', () => {
    expect(snapshotSignature(profile, [diaper()])).toBe(snapshotSignature(profile, [diaper()]));
    expect(snapshotSignature(profile, [diaper()])).not.toBe(
      snapshotSignature({ ...profile, birthDate: '2026-09-02T06:30:00.000Z' }, [diaper()])
    );
  });
});
