import { describe, expect, it, vi } from 'vitest';
import { createGoogleSheetsBabyTrackerStore, type GoogleSheetsApi } from './googleSheetsStore';

function makeApi() {
  const getValues = vi.fn(async (range: string) => {
    if (range.startsWith('Profile')) {
      return [
        ['id', 'name', 'dueDate', 'birthDate', 'timezone', 'createdAt', 'updatedAt', 'syncState'],
        ['theo-roche', 'Theo Roche', '2026-09-01', '', 'America/Los_Angeles', '2026-06-20T16:15:00.000Z', '2026-06-20T16:15:00.000Z', 'synced']
      ];
    }

    return [
      [
        'id',
        'babyId',
        'type',
        'startedAt',
        'endedAt',
        'notes',
        'createdAt',
        'updatedAt',
        'syncState',
        'side',
        'durationMinutes',
        'amountOz',
        'contents',
        'kind',
        'color',
        'medicationName',
        'dose',
        'scheduledAt',
        'givenAt',
        'status',
        'provider',
        'location',
        'reason',
        'weightOz',
        'lengthIn',
        'headCircumferenceIn',
        'title'
      ],
      ['seed_bottle_1', 'theo-roche', 'bottle', '2026-09-02T09:05:00.000Z', '', 'Supplement', '2026-06-20T16:15:00.000Z', '2026-06-20T16:15:00.000Z', 'synced', '', '', 2.5, 'breastmilk']
    ];
  });

  return {
    appendValues: vi.fn().mockResolvedValue(undefined),
    clearValues: vi.fn().mockResolvedValue(undefined),
    deleteEventRow: vi.fn().mockResolvedValue(undefined),
    getValues,
    updateValues: vi.fn().mockResolvedValue(undefined)
  } as unknown as GoogleSheetsApi & {
    appendValues: ReturnType<typeof vi.fn>;
    getValues: ReturnType<typeof vi.fn>;
    updateValues: ReturnType<typeof vi.fn>;
  };
}

describe('Google Sheets tracker store', () => {
  it('maps sheet rows into care events', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    const events = await store.listEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      amountOz: 2.5,
      contents: 'breastmilk',
      id: 'seed_bottle_1',
      notes: 'Supplement',
      type: 'bottle'
    });
  });

  it('appends new events to the Events tab', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    await store.addEvent({
      kind: 'wet',
      startedAt: '2026-09-02T11:00:00.000Z',
      type: 'diaper'
    });

    expect(api.appendValues).toHaveBeenCalledWith(
      'Events!A:AE',
      [
        expect.arrayContaining([
          expect.stringMatching(/^event_/),
          'theo-roche',
          'diaper',
          '2026-09-02T11:00:00.000Z'
        ])
      ]
    );
  });

  it('maps birth rows into birth events', async () => {
    const api = makeApi();
    api.getValues.mockImplementation(async (range: string) => {
      if (range.startsWith('Profile')) {
        return [
          ['id', 'name', 'dueDate', 'birthDate', 'timezone', 'createdAt', 'updatedAt', 'syncState'],
          ['theo-roche', 'Theo Roche', '2026-09-01', '2026-09-02T06:30:00.000Z', 'America/Los_Angeles', '2026-06-20T16:15:00.000Z', '2026-06-20T16:15:00.000Z', 'synced']
        ];
      }

      return [
        [
          'id',
          'babyId',
          'type',
          'startedAt',
          'endedAt',
          'notes',
          'createdAt',
          'updatedAt',
          'syncState',
          'side',
          'durationMinutes',
          'amountOz',
          'contents',
          'kind',
          'color',
          'medicationName',
          'dose',
          'scheduledAt',
          'givenAt',
          'status',
          'provider',
          'location',
          'reason',
          'weightOz',
          'lengthIn',
          'headCircumferenceIn',
          'title'
        ],
        ['birth-1', 'theo-roche', 'birth', '2026-09-02T06:30:00.000Z', '', 'Welcome Theo', '2026-09-02T06:30:00.000Z', '2026-09-02T06:30:00.000Z', 'synced', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 118, 20, 13.5]
      ];
    });

    const store = createGoogleSheetsBabyTrackerStore(api);
    const events = await store.listEvents();

    expect(events[0]).toMatchObject({
      headCircumferenceIn: 13.5,
      lengthIn: 20,
      type: 'birth',
      weightOz: 118
    });
  });
});
