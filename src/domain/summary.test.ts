import { describe, expect, it } from 'vitest';
import { getDailySummary, getUpcomingMedicationEvents } from './summary';
import type { CareEvent } from './types';

const base = {
  babyId: 'theo-roche',
  createdAt: '2026-09-02T12:00:00.000Z',
  syncState: 'local' as const,
  updatedAt: '2026-09-02T12:00:00.000Z'
};

describe('daily summaries', () => {
  it('totals newborn care events for a day', () => {
    const events: CareEvent[] = [
      {
        ...base,
        durationMinutes: 22,
        endedAt: '2026-09-02T12:22:00.000Z',
        id: 'feed-1',
        side: 'left',
        startedAt: '2026-09-02T12:00:00.000Z',
        type: 'breastfeed'
      },
      {
        ...base,
        amountOz: 2.5,
        contents: 'formula',
        id: 'bottle-1',
        startedAt: '2026-09-02T14:00:00.000Z',
        type: 'bottle'
      },
      {
        ...base,
        amountOz: 3,
        id: 'pump-1',
        side: 'both',
        startedAt: '2026-09-02T15:00:00.000Z',
        type: 'pump'
      },
      {
        ...base,
        id: 'diaper-1',
        kind: 'both',
        startedAt: '2026-09-02T16:00:00.000Z',
        type: 'diaper'
      },
      {
        ...base,
        endedAt: '2026-09-02T18:30:00.000Z',
        id: 'sleep-1',
        startedAt: '2026-09-02T17:00:00.000Z',
        type: 'sleep'
      },
      {
        ...base,
        dose: '1 ml',
        givenAt: '2026-09-02T19:00:00.000Z',
        id: 'med-1',
        medicationName: 'Vitamin D',
        scheduledAt: '2026-09-02T19:00:00.000Z',
        startedAt: '2026-09-02T19:00:00.000Z',
        status: 'given',
        type: 'medication'
      }
    ];

    expect(getDailySummary(events)).toMatchObject({
      bottleOunces: 2.5,
      dirtyDiapers: 1,
      feedCount: 2,
      medicationsGiven: 1,
      nursingMinutes: 22,
      pumpOunces: 3,
      sleepMinutes: 90,
      wetDiapers: 1
    });
  });
});

describe('upcoming medications', () => {
  it('keeps overdue scheduled medications visible first', () => {
    const events: CareEvent[] = [
      {
        ...base,
        dose: '1 ml',
        id: 'later',
        medicationName: 'Vitamin D',
        scheduledAt: '2026-09-02T12:45:00.000Z',
        startedAt: '2026-09-02T12:45:00.000Z',
        status: 'scheduled',
        type: 'medication'
      },
      {
        ...base,
        dose: '1 ml',
        id: 'overdue',
        medicationName: 'Vitamin D',
        scheduledAt: '2026-09-02T11:45:00.000Z',
        startedAt: '2026-09-02T11:45:00.000Z',
        status: 'scheduled',
        type: 'medication'
      }
    ];

    const result = getUpcomingMedicationEvents(events, new Date('2026-09-02T12:00:00.000Z'), 120);

    expect(result.map((event) => event.id)).toEqual(['overdue', 'later']);
  });
});
