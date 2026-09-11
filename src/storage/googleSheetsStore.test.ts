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
    expect(api.updateValues).toHaveBeenCalledWith('Events!A1:AH1', [expect.arrayContaining(['id', 'babyId', 'type', 'poopSize'])]);
    expect(api.updateValues).toHaveBeenCalledWith('Profile!A1:N1', [expect.arrayContaining(['id', 'name', 'gender', 'preferredUnits'])]);
    expect(api.updateValues).not.toHaveBeenCalledWith('Profile!A2:N2', expect.anything());
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
    expect(api.updateValues).toHaveBeenCalledWith('Profile!A2:N2', [expect.arrayContaining(['theo-roche', 'Theo Roche', 'girl'])]);
  });

  it('round-trips preferred units through the profile row', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    const saved = await store.saveProfile({ preferredUnits: { system: 'metric', weightDisplay: 'ounces' } });

    expect(saved.preferredUnits).toEqual({ system: 'metric', weightDisplay: 'ounces' });
    expect(api.updateValues).toHaveBeenCalledWith(
      'Profile!A2:N2',
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
      'Events!A:AH',
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

    expect(api.appendValues).toHaveBeenCalledWith('Events!A:AH', [expect.arrayContaining(['diaper', 'dirty', 'large'])]);
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
    await api.updateValues('Profile!A2:N2', [['theo-roche']]);
    await api.appendValues('Events!A:AH', [['event_1']]);

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
    expect(api.updateValues).toHaveBeenCalledWith('Profile!A3:N3', [expect.arrayContaining(['mila-roche', 'Mila Roche', '2028-03-06'])]);
    expect(api.updateValues).not.toHaveBeenCalledWith('Profile!A2:N2', expect.anything());
  });

  it('adds a sibling on the next free row', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    const added = await store.addProfile({ dueDate: '2028-03-04', name: 'Mila Roche' });

    expect(added.id).toBe('mila-roche');
    expect(api.updateValues).toHaveBeenCalledWith('Profile!A3:N3', [expect.arrayContaining(['mila-roche', 'Mila Roche', '2028-03-04'])]);
  });

  // Blanking the row leaves the child's entries where they are: we migrate and
  // leave history alone rather than deleting rows someone else may be reading.
  it('removes a child by clearing their row, never their entries', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    await store.deleteProfile('theo-roche');

    expect(api.clearValues).toHaveBeenCalledWith('Profile!A2:N2');
    expect(api.deleteEventRow).not.toHaveBeenCalled();
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
    expect(api.updateValues).toHaveBeenCalledWith('Profile!A3:N3', [expect.arrayContaining(['sara-roche', 'Sara Roche', 'parent', 'mom'])]);
  });

  it('round-trips a period entry through the flow column', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    await store.addEvent({ babyId: 'sara-roche', flow: 'heavy', startedAt: '2026-09-10T08:00:00.000Z', type: 'menses' });

    expect(api.appendValues).toHaveBeenCalledWith('Events!A:AH', [expect.arrayContaining(['sara-roche', 'menses', 'heavy'])]);
  });

  it('round-trips the caregiver on an event row', async () => {
    const api = makeApi();
    const store = createGoogleSheetsBabyTrackerStore(api);

    await store.addEvent({ caregiverId: 'sara-roche', kind: 'wet', startedAt: '2026-09-10T11:00:00.000Z', type: 'diaper' });

    expect(api.appendValues).toHaveBeenCalledWith('Events!A:AH', [expect.arrayContaining(['diaper', 'wet', 'sara-roche'])]);
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

    const base = ['id', 'name', 'dueDate', 'birthDate', 'timezone', 'createdAt', 'updatedAt', 'syncState', 'careInfo', 'gender', 'preferredUnits', 'kind', 'parentRole', 'phone'];
    const sara = ['sara-roche', 'Sara Roche', '', '1994-05-11', 'America/Los_Angeles', '2026-09-10T16:15:00.000Z', '2026-09-10T16:15:00.000Z', 'synced', '', '', '', 'parent', 'mom', '8053009852'];

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
      expect(duplicated.clearValues).toHaveBeenCalledWith('Profile!O1:O1');

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
    expect(api.updateValues).toHaveBeenCalledWith('Profile!A2:N2', [expect.arrayContaining(['8053009852'])]);
  });
});
