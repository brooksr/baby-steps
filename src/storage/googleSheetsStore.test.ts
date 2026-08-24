import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGoogleSheetsBabyTrackerStore, GoogleSheetsApi } from './googleSheetsStore';

function makeApi() {
  const getValues = vi.fn(async (range: string) => {
    if (range.startsWith('Profile')) {
      return [
        ['id', 'name', 'dueDate', 'birthDate', 'timezone', 'createdAt', 'updatedAt', 'syncState', 'careInfo', 'gender'],
        ['theo-roche', 'Theo Roche', '2026-09-01', '', 'America/Los_Angeles', '2026-06-20T16:15:00.000Z', '2026-06-20T16:15:00.000Z', 'synced', '', 'boy']
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

  const batchGetValues = vi.fn(async (ranges: string[]) => Promise.all(ranges.map((range) => getValues(range))));

  return {
    appendValues: vi.fn().mockResolvedValue(undefined),
    batchGetValues,
    clearValues: vi.fn().mockResolvedValue(undefined),
    deleteEventRow: vi.fn().mockResolvedValue(undefined),
    getValues,
    updateValues: vi.fn().mockResolvedValue(undefined)
  } as unknown as GoogleSheetsApi & {
    appendValues: ReturnType<typeof vi.fn>;
    batchGetValues: ReturnType<typeof vi.fn>;
    getValues: ReturnType<typeof vi.fn>;
    updateValues: ReturnType<typeof vi.fn>;
  };
}

describe('Google Sheets tracker store', () => {
  // The fixture row is a pre-merge `bottle`, which is what the shared sheet
  // still holds for everything logged before nursing and bottle became one feed.
  it('maps legacy bottle rows into feeding events', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    const events = await store.listEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      amountOz: 2.5,
      contents: 'breastmilk',
      id: 'seed_bottle_1',
      method: 'bottle',
      notes: 'Supplement',
      type: 'feed'
    });
  });

  // Polling reads run on a timer, so they must cost one request and must never
  // write — a profile row rewritten on every read would clobber whatever
  // another device saved between our read and our write.
  it('reads profile and events in one request without writing', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    const snapshot = await store.snapshot();

    expect(snapshot.profile.name).toBe('Theo Roche');
    expect(snapshot.profile.gender).toBe('boy');
    expect(snapshot.events).toHaveLength(1);
    expect(api.batchGetValues).toHaveBeenCalledTimes(1);
    expect(api.updateValues).not.toHaveBeenCalled();
  });

  it('leaves an existing profile row alone on initialize', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    await store.initialize();

    // Header rows only — never the profile row itself.
    expect(api.updateValues).toHaveBeenCalledTimes(2);
    expect(api.updateValues).toHaveBeenCalledWith('Events!A1:AE1', [expect.arrayContaining(['id', 'babyId', 'type'])]);
    expect(api.updateValues).toHaveBeenCalledWith('Profile!A1:J1', [expect.arrayContaining(['id', 'name', 'gender'])]);
    expect(api.updateValues).not.toHaveBeenCalledWith('Profile!A2:J2', expect.anything());
  });

  // Regression: the Settings form saves a bare `YYYY-MM-DD`, which USER_ENTERED
  // turned into a date cell — so it read back as a serial number and the birth
  // date vanished from the form. Rows written that way are still in the sheet.
  it('reads a date column Sheets stored as a serial number', async () => {
    const api = makeApi();
    api.getValues.mockImplementation(async (range: string) => {
      if (range.startsWith('Profile')) {
        return [
          ['id', 'name', 'dueDate', 'birthDate', 'timezone', 'createdAt', 'updatedAt', 'syncState', 'careInfo', 'gender'],
          ['theo-roche', 'Theo Roche', 46266, 46264, 'America/Los_Angeles', '2026-06-20T16:15:00.000Z', '2026-06-20T16:15:00.000Z', 'synced', '', 'boy']
        ];
      }

      return [['id', 'babyId', 'type', 'startedAt']];
    });

    const { profile } = await createGoogleSheetsBabyTrackerStore(api).snapshot();

    // 46264 / 46266 are the Sheets serials for these dates (epoch 1899-12-30).
    expect(profile.birthDate).toBe('2026-08-30');
    expect(profile.dueDate).toBe('2026-09-01');
  });

  it('round-trips the profile gender through the sheet row', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    const saved = await store.saveProfile({ gender: 'girl' });

    expect(saved.gender).toBe('girl');
    expect(api.updateValues).toHaveBeenCalledWith('Profile!A2:J2', [expect.arrayContaining(['theo-roche', 'Theo Roche', 'girl'])]);
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

describe('Google Sheets API writes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // USER_ENTERED is what broke the birth date: Sheets parsed the string we sent
  // into a date cell, and reading it back gave a serial number instead.
  it('sends values as RAW so Sheets stores exactly what we wrote', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      urls.push(String(input));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    const api = new GoogleSheetsApi(async () => 'token');
    await api.updateValues('Profile!A2:J2', [['theo-roche']]);
    await api.appendValues('Events!A:AE', [['event_1']]);

    expect(urls).toHaveLength(2);

    for (const url of urls) {
      expect(url).toContain('valueInputOption=RAW');
      expect(url).not.toContain('USER_ENTERED');
    }
  });
});
