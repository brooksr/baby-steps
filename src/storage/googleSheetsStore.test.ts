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

    if (range.startsWith('Shopping')) {
      return [
        ['id', 'name', 'category', 'isFood', 'status', 'quantity', 'notes', 'addedBy', 'createdAt', 'updatedAt', 'completedAt'],
        ['shop_apples', 'Apples', 'produce', true, 'done', '', '', '', '2026-06-20T16:15:00.000Z', '2026-06-20T16:15:00.000Z', '']
      ];
    }

    if (range.startsWith('Tasks')) {
      return [['id', 'title', 'notes', 'status', 'dueAt', 'assigneeId', 'createdBy', 'createdAt', 'updatedAt', 'completedAt']];
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
    addSheets: vi.fn().mockResolvedValue(undefined),
    appendValues: vi.fn().mockResolvedValue(undefined),
    batchGetValues,
    clearValues: vi.fn().mockResolvedValue(undefined),
    deleteEventRow: vi.fn().mockResolvedValue(undefined),
    getValues,
    listSheetTitles: vi.fn().mockResolvedValue(['Events', 'Profile', 'Shopping', 'Tasks']),
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

  it('updates an event across every column in the current event schema', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);
    const [event] = await store.listEvents();

    await store.updateEvent({ ...event, notes: 'Finished the bottle' });

    expect(api.updateValues).toHaveBeenCalledWith(
      'Events!A2:AN2',
      [expect.arrayContaining(['seed_bottle_1', 'Finished the bottle'])]
    );
    const lastCall = api.updateValues.mock.calls[api.updateValues.mock.calls.length - 1];
    expect(lastCall[1][0]).toHaveLength(40);
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
    expect(api.updateValues).toHaveBeenCalledWith('Events!A1:AN1', [expect.arrayContaining(['id', 'babyId', 'type', 'poopSize'])]);
    expect(api.updateValues).toHaveBeenCalledWith('Profile!A1:O1', [expect.arrayContaining(['id', 'name', 'gender', 'preferredUnits'])]);
    expect(api.updateValues).not.toHaveBeenCalledWith('Profile!A2:O2', expect.anything());
  });

  it('creates missing household tabs and seeds the supplied shopping history', async () => {
    const api = makeApi();
    api.listSheetTitles = vi.fn().mockResolvedValue(['Events', 'Profile']);
    api.getValues.mockImplementation(async (range: string) => {
      if (range.startsWith('Profile')) {
        return [
          ['id', 'name'],
          ['theo-roche', 'Theo Roche']
        ];
      }

      if (range.startsWith('Shopping')) {
        return [['id', 'name', 'category', 'isFood', 'status']];
      }

      return [['id', 'babyId', 'type', 'startedAt']];
    });

    await createGoogleSheetsBabyTrackerStore(api).initialize();

    expect(api.addSheets).toHaveBeenCalledWith(['Shopping', 'Tasks']);
    expect(api.updateValues).toHaveBeenCalledWith('Shopping!A1:K1', [expect.arrayContaining(['name', 'isFood', 'status'])]);
    expect(api.updateValues).toHaveBeenCalledWith(
      expect.stringMatching(/^Shopping!A2:K\d+$/),
      expect.arrayContaining([expect.arrayContaining(['Apples', 'produce', 'yes', 'done'])])
    );
  });

  it('writes shopping items and tasks to their own sheet rows', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    await store.saveShoppingItem({ category: 'produce', isFood: true, name: 'Bananas' });
    await store.saveTask({ title: 'Wash bottles' });

    expect(api.updateValues).toHaveBeenCalledWith(
      'Shopping!A3:K3',
      [expect.arrayContaining(['Bananas', 'produce', 'yes', 'need'])]
    );
    expect(api.updateValues).toHaveBeenCalledWith(
      'Tasks!A2:J2',
      [expect.arrayContaining(['Wash bottles', 'open'])]
    );
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
    expect(api.updateValues).toHaveBeenCalledWith('Profile!A2:O2', [expect.arrayContaining(['theo-roche', 'Theo Roche', 'girl'])]);
  });

  it('round-trips preferred units through the profile row', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    const saved = await store.saveProfile({ preferredUnits: { system: 'metric', weightDisplay: 'ounces' } });

    expect(saved.preferredUnits).toEqual({ system: 'metric', weightDisplay: 'ounces' });
    expect(api.updateValues).toHaveBeenCalledWith(
      'Profile!A2:O2',
      [expect.arrayContaining(['{"system":"metric","weightDisplay":"ounces"}'])]
    );
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
      'Events!A:AN',
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

  it('persists diaper poop size in the appended event column', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    await store.addEvent({
      kind: 'dirty',
      poopSize: 'large',
      startedAt: '2026-09-02T11:00:00.000Z',
      type: 'diaper'
    });

    expect(api.appendValues).toHaveBeenCalledWith('Events!A:AN', [expect.arrayContaining(['diaper', 'dirty', 'large'])]);
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
    await api.updateValues('Profile!A2:O2', [['theo-roche']]);
    await api.appendValues('Events!A:AN', [['event_1']]);

    expect(urls).toHaveLength(2);

    for (const url of urls) {
      expect(url).toContain('valueInputOption=RAW');
      expect(url).not.toContain('USER_ENTERED');
    }
  });

  // One row per child. The Profile tab used to be a single row, so the range is
  // open-ended now and a row without an id is a gap, not a nameless baby.
  it('reads every child from the Profile tab', async () => {
    const api = makeApi();
    api.getValues.mockImplementation(async (range: string) => {
      if (range.startsWith('Profile')) {
        return [
          ['id', 'name', 'dueDate', 'birthDate', 'timezone', 'createdAt', 'updatedAt', 'syncState', 'careInfo', 'gender'],
          ['theo-roche', 'Theo Roche', '2026-09-01', '', 'America/Los_Angeles', '2026-06-20T16:15:00.000Z', '2026-06-20T16:15:00.000Z', 'synced', '', 'boy'],
          [],
          ['mila-roche', 'Mila Roche', '2028-03-04', '', 'America/Los_Angeles', '2028-01-04T09:00:00.000Z', '2028-01-04T09:00:00.000Z', 'synced', '', 'girl']
        ];
      }

      return [['id', 'babyId', 'type', 'startedAt']];
    });

    const store = createGoogleSheetsBabyTrackerStore(api);

    expect((await store.listProfiles()).map((child) => child.name)).toEqual(['Theo Roche', 'Mila Roche']);
  });

  it('snapshots the child the query names, with only that child\'s entries', async () => {
    const api = makeApi();
    api.getValues.mockImplementation(async (range: string) => {
      if (range.startsWith('Profile')) {
        return [
          ['id', 'name', 'dueDate', 'birthDate', 'timezone', 'createdAt', 'updatedAt', 'syncState'],
          ['theo-roche', 'Theo Roche', '2026-09-01', '', 'America/Los_Angeles', '2026-06-20T16:15:00.000Z', '2026-06-20T16:15:00.000Z', 'synced'],
          ['mila-roche', 'Mila Roche', '2028-03-04', '', 'America/Los_Angeles', '2028-01-04T09:00:00.000Z', '2028-01-04T09:00:00.000Z', 'synced']
        ];
      }

      return [
        ['id', 'babyId', 'type', 'startedAt'],
        ['event_1', 'theo-roche', 'sleep', '2026-09-02T11:00:00.000Z'],
        ['event_2', 'mila-roche', 'sleep', '2028-03-05T11:00:00.000Z']
      ];
    });

    const store = createGoogleSheetsBabyTrackerStore(api);
    const snapshot = await store.snapshot({ babyId: 'mila-roche' });

    expect(snapshot.profile.name).toBe('Mila Roche');
    expect(snapshot.profiles).toHaveLength(2);
    expect(snapshot.events.map((event) => event.id)).toEqual(['event_2']);
    // Still one request, however many children the sheet holds.
    expect(api.batchGetValues).toHaveBeenCalledTimes(1);
  });

  it('writes a profile edit to that child\'s own row', async () => {
    const api = makeApi();
    api.getValues.mockImplementation(async (range: string) => {
      if (range.startsWith('Profile')) {
        return [
          ['id', 'name', 'dueDate', 'birthDate', 'timezone', 'createdAt', 'updatedAt', 'syncState'],
          ['theo-roche', 'Theo Roche', '2026-09-01', '', 'America/Los_Angeles', '2026-06-20T16:15:00.000Z', '2026-06-20T16:15:00.000Z', 'synced'],
          ['mila-roche', 'Mila Roche', '2028-03-04', '', 'America/Los_Angeles', '2028-01-04T09:00:00.000Z', '2028-01-04T09:00:00.000Z', 'synced']
        ];
      }

      return [['id', 'babyId', 'type', 'startedAt']];
    });

    const store = createGoogleSheetsBabyTrackerStore(api);
    const saved = await store.saveProfile({ birthDate: '2028-03-06', id: 'mila-roche' });

    expect(saved.name).toBe('Mila Roche');
    expect(api.updateValues).toHaveBeenCalledWith('Profile!A3:O3', [expect.arrayContaining(['mila-roche', 'Mila Roche', '2028-03-06'])]);
    expect(api.updateValues).not.toHaveBeenCalledWith('Profile!A2:O2', expect.anything());
  });

  it('adds a sibling on the next free row', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    const added = await store.addProfile({ dueDate: '2028-03-04', name: 'Mila Roche' });

    expect(added.id).toBe('mila-roche');
    expect(api.updateValues).toHaveBeenCalledWith('Profile!A3:O3', [expect.arrayContaining(['mila-roche', 'Mila Roche', '2028-03-04'])]);
  });

  // Archiving stamps the row and changes nothing else — no cleared row, no
  // deleted entries, and it can be undone.
  it('archives by stamping the row, never by clearing it', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    await store.archiveProfile('theo-roche');

    expect(api.clearValues).not.toHaveBeenCalled();
    expect(api.deleteEventRow).not.toHaveBeenCalled();
    const written = api.updateValues.mock.calls.find((call: unknown[]) => call[0] === 'Profile!A2:O2')?.[1][0];
    expect(written[0]).toBe('theo-roche');
    expect(written[written.length - 1]).toBeTruthy();
  });

  it('brings an archived profile back', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    await store.restoreProfile('theo-roche');

    const written = api.updateValues.mock.calls.find((call: unknown[]) => call[0] === 'Profile!A2:O2')?.[1][0];
    expect(written[written.length - 1]).toBe('');
  });

  // A profile row written before parents existed has no `kind` column at all,
  // and every one of those is a child.
  it('reads a parent row, and a kindless row as a child', async () => {
    const api = makeApi();
    api.getValues.mockImplementation(async (range: string) => {
      if (range.startsWith('Profile')) {
        return [
          ['id', 'name', 'dueDate', 'birthDate', 'timezone', 'createdAt', 'updatedAt', 'syncState', 'careInfo', 'gender', 'preferredUnits', 'kind', 'parentRole'],
          ['theo-roche', 'Theo Roche', '2026-09-01', '', 'America/Los_Angeles', '2026-06-20T16:15:00.000Z', '2026-06-20T16:15:00.000Z', 'synced', '', 'boy'],
          ['sara-roche', 'Sara Roche', '', '1994-05-11', 'America/Los_Angeles', '2026-09-10T16:15:00.000Z', '2026-09-10T16:15:00.000Z', 'synced', '', '', '', 'parent', 'mom']
        ];
      }

      return [['id', 'babyId', 'type', 'startedAt']];
    });

    const profiles = await createGoogleSheetsBabyTrackerStore(api).listProfiles();

    expect(profiles[0]).toMatchObject({ dueDate: '2026-09-01', kind: 'child', name: 'Theo Roche' });
    expect(profiles[1]).toMatchObject({ birthDate: '1994-05-11', kind: 'parent', name: 'Sara Roche', parentRole: 'mom' });
    // A parent has no due date, and inventing one would read as a pregnancy.
    expect(profiles[1].dueDate).toBeUndefined();
  });

  it('writes a parent with their role, in the appended columns', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    const added = await store.addProfile({ birthDate: '1994-05-11', kind: 'parent', name: 'Sara Roche', parentRole: 'mom' });

    expect(added.kind).toBe('parent');
    expect(api.updateValues).toHaveBeenCalledWith('Profile!A3:O3', [expect.arrayContaining(['sara-roche', 'Sara Roche', 'parent', 'mom'])]);
  });

  it('round-trips a period entry through the flow column', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    await store.addEvent({ babyId: 'sara-roche', flow: 'heavy', startedAt: '2026-09-10T08:00:00.000Z', type: 'menses' });

    expect(api.appendValues).toHaveBeenCalledWith('Events!A:AN', [expect.arrayContaining(['sara-roche', 'menses', 'heavy'])]);
  });

  // A parent's own rows. The tag list is one cell, so it has to survive being
  // flattened and split again — that list is the half a later association pass
  // can actually count.
  it('round-trips an input with its food-group tags in one cell', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    await store.addEvent({
      babyId: 'sara-roche',
      items: 'Iced latte',
      kind: 'drink',
      startedAt: '2026-09-10T08:00:00.000Z',
      tags: ['caffeine', 'dairy'],
      type: 'intake'
    });

    expect(api.appendValues).toHaveBeenCalledWith('Events!A:AN', [
      expect.arrayContaining(['intake', 'drink', 'Iced latte', 'caffeine,dairy'])
    ]);
  });

  it('reads an input row back with its tags split again', async () => {
    const api = makeApi();
    api.getValues.mockImplementation(async (range: string) => {
      if (range.startsWith('Profile')) {
        return [['id', 'name', 'timezone'], ['sara-roche', 'Sara Roche', 'America/Los_Angeles']];
      }

      return [
        ['id', 'babyId', 'type', 'startedAt', 'kind', 'items', 'tags', 'portion'],
        ['in_1', 'sara-roche', 'intake', '2026-09-10T08:00:00.000Z', 'food', 'Bean chili', 'legumes, spicy', 'large']
      ];
    });

    const events = await createGoogleSheetsBabyTrackerStore(api).listEvents();

    expect(events[0]).toMatchObject({
      items: 'Bean chili',
      kind: 'food',
      portion: 'large',
      tags: ['legumes', 'spicy'],
      type: 'intake'
    });
  });

  it('round-trips an output with its severity and stool detail', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    await store.addEvent({
      babyId: 'sara-roche',
      bristol: 6,
      color: 'normal',
      kind: 'poo',
      severity: 4,
      startedAt: '2026-09-10T14:00:00.000Z',
      type: 'output'
    });

    expect(api.appendValues).toHaveBeenCalledWith('Events!A:AN', [
      expect.arrayContaining(['output', 'poo', 'normal', 4, 6])
    ]);
  });

  it('round-trips the caregiver on an event row', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    await store.addEvent({ caregiverId: 'sara-roche', kind: 'wet', startedAt: '2026-09-10T11:00:00.000Z', type: 'diaper' });

    expect(api.appendValues).toHaveBeenCalledWith('Events!A:AN', [expect.arrayContaining(['diaper', 'wet', 'sara-roche'])]);
  });

  // Every row logged before the column existed carries no caregiver, and must
  // read as "not recorded" rather than as anything else.
  it('reads a row written before the caregiver column as unattributed', async () => {
    const api = makeApi();
    const events = await createGoogleSheetsBabyTrackerStore(api).listEvents();

    expect(events[0].caregiverId).toBeUndefined();
  });

  // The live sheet grew a duplicate `parentRole` header past the end of the
  // columns we write. Position-based mapping would have been fine here but is
  // one inserted column away from misreading every field, so the header row is
  // the authority and the first occurrence of a name wins.
  describe('columns are found by header name', () => {
    function withHeaders(header: string[], row: unknown[]) {
      const api = makeApi();
      api.getValues.mockImplementation(async (range: string) => {
        if (range.startsWith('Profile')) {
          return [header, row];
        }

        return [['id', 'babyId', 'type', 'startedAt']];
      });

      return api;
    }

    const base = ['id', 'name', 'dueDate', 'birthDate', 'timezone', 'createdAt', 'updatedAt', 'syncState', 'careInfo', 'gender', 'preferredUnits', 'kind', 'parentRole', 'phone', 'archivedAt'];
    const sara = ['sara-roche', 'Sara Roche', '', '1994-05-11', 'America/Los_Angeles', '2026-09-10T16:15:00.000Z', '2026-09-10T16:15:00.000Z', 'synced', '', '', '', 'parent', 'mom', '8053009852', ''];

    it('ignores a duplicate header past the end', async () => {
      const api = withHeaders([...base, 'parentRole'], sara);

      const profiles = await createGoogleSheetsBabyTrackerStore(api).listProfiles();

      expect(profiles[0]).toMatchObject({ kind: 'parent', name: 'Sara Roche', parentRole: 'mom' });
    });

    it('follows a column someone inserted rather than shifting every field', async () => {
      const api = withHeaders(
        ['id', 'nickname', ...base.slice(1)],
        ['sara-roche', 'Sass', ...sara.slice(1)]
      );

      const profiles = await createGoogleSheetsBabyTrackerStore(api).listProfiles();

      expect(profiles[0]).toMatchObject({ birthDate: '1994-05-11', name: 'Sara Roche', parentRole: 'mom' });
    });

    // A sheet written by an older build names fewer columns; those rows are laid
    // out in exactly our order, so position is the right fallback.
    it('falls back to position for a header the sheet does not name', async () => {
      const api = withHeaders(base.slice(0, 11), [...sara.slice(0, 11), 'parent', 'mom']);

      const profiles = await createGoogleSheetsBabyTrackerStore(api).listProfiles();

      expect(profiles[0]).toMatchObject({ kind: 'parent', parentRole: 'mom' });
    });

    it('blanks a stray duplicate header, and leaves an unrecognised one alone', async () => {
      const duplicated = withHeaders([...base, 'parentRole'], sara);
      await createGoogleSheetsBabyTrackerStore(duplicated).initialize();
      expect(duplicated.clearValues).toHaveBeenCalledWith('Profile!P1:P1');

      const theirs = withHeaders([...base, 'nannyPhone'], sara);
      await createGoogleSheetsBabyTrackerStore(theirs).initialize();
      expect(theirs.clearValues).not.toHaveBeenCalled();
    });
  });

  it('round-trips a parent phone number', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    const saved = await store.saveProfile({ id: 'theo-roche', phone: '8053009852' });

    expect(saved.phone).toBe('8053009852');
    expect(api.updateValues).toHaveBeenCalledWith('Profile!A2:O2', [expect.arrayContaining(['8053009852'])]);
  });

  // Attributing months of history a row at a time would be hundreds of round
  // trips, and rewriting whole rows would clobber another caregiver's edit.
  describe('bulk caregiver assignment', () => {
    function makeEventsApi() {
      const api = makeApi();
      api.getValues.mockImplementation(async (range: string) => {
        if (range.startsWith('Profile')) {
          return [['id', 'name'], ['theo-roche', 'Theo Roche']];
        }

        return [
          ['id', 'babyId', 'type', 'startedAt', ...Array(29).fill(''), 'caregiverId'],
          ['event_1', 'theo-roche', 'feed', '2026-08-07T01:00:00.000Z', ...Array(29).fill(''), ''],
          ['event_2', 'theo-roche', 'feed', '2026-08-07T06:30:00.000Z', ...Array(29).fill(''), ''],
          ['event_3', 'theo-roche', 'feed', '2026-08-07T14:00:00.000Z', ...Array(29).fill(''), 'brooks-roche']
        ];
      });

      return api;
    }

    it('writes the whole batch down the caregiver column in one request', async () => {
      const api = makeEventsApi();

      await createGoogleSheetsBabyTrackerStore(api).assignCaregivers([
        { caregiverId: 'jenni-roche', id: 'event_1' },
        { caregiverId: 'brooks-roche', id: 'event_2' }
      ]);

      expect(api.updateValues).toHaveBeenCalledTimes(1);
      // Rows it was not asked about keep whatever they already said.
      expect(api.updateValues).toHaveBeenCalledWith('Events!AH2:AH4', [['jenni-roche'], ['brooks-roche'], ['brooks-roche']]);
    });

    it('writes nothing at all for an empty batch', async () => {
      const api = makeEventsApi();

      await createGoogleSheetsBabyTrackerStore(api).assignCaregivers([]);

      expect(api.updateValues).not.toHaveBeenCalled();
      expect(api.getValues).not.toHaveBeenCalled();
    });
  });
});
