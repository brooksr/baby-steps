import { createFamilyProfile, isChild, isParent, sortProfiles, type NewProfileInput } from '../domain/family';
import { createDefaultBabyProfile } from '../domain/dates';
import { migrateStoredEvent, migrateStoredEvents, type StoredCareEventType } from '../domain/legacyEvents';
import { DEFAULT_PROFILE_ID, type BabyGender, type BabyProfile, type BottleContents, type CareInfo, type CareEvent, type CreateCareEventInput, type FeedMethod, type MensesFlow, type NursingSide, type ParentRole, type PreferredUnits, type TrackerExport, type TrackerSnapshot } from '../domain/types';
import { requestGoogleSheetsAccessToken } from './googleSheetsAuth';
import type { BabyTrackerStore, CaregiverAssignment, EventQuery, ImportOptions } from './store';

export const GOOGLE_SHEET_ID = '1VG9px1j-KF29i2J6AG_PP57hOM8V-wLPgP-9VTdURUc';
export const GOOGLE_SHEET_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit`;

// Widen these together with `profileHeaders` — a new profile field is a new
// column, and the range has to reach it. The range is open-ended down the
// sheet because one row is one child, and there can be any number of them.
const PROFILE_RANGE = 'Profile!A:N';
const PROFILE_HEADER_RANGE = 'Profile!A1:N1';
/** Row 2 is the first child; `profileRowRange` addresses the rest. */
const FIRST_PROFILE_ROW = 2;
const EVENTS_RANGE = 'Events!A:AH';
const EVENTS_BODY_RANGE = 'Events!A2:AH1000';
const EVENTS_APPEND_RANGE = 'Events!A:AH';
const EVENTS_SHEET_ID = 0;

/**
 * RAW, not USER_ENTERED. USER_ENTERED lets Sheets *interpret* what we send:
 * a bare `2026-08-15` becomes a date cell, and reading it back with
 * UNFORMATTED_VALUE returns a serial number rather than the string we wrote —
 * which is how the birth date stopped surviving a round trip. RAW also means a
 * note that starts with `=` stays text instead of becoming a formula.
 */
const VALUE_INPUT_OPTION = 'RAW';

/** Sheets counts days from 1899-12-30, so serial 0 is that date. */
const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/** A1-notation column letter for a zero-based index (0 → A, 26 → AA). */
function columnLetter(index: number) {
  let letter = '';

  for (let remaining = index; remaining >= 0; remaining = Math.floor(remaining / 26) - 1) {
    letter = String.fromCharCode(65 + (remaining % 26)) + letter;
  }

  return letter;
}

function profileRowRange(rowNumber: number) {
  return `Profile!A${rowNumber}:N${rowNumber}`;
}

const eventHeaders = [
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
  'title',
  'celsius',
  'moodLevel',
  'refId',
  // New columns append here so existing sheet rows keep their positions.
  'method',
  'poopSize',
  'flow',
  'caregiverId'
] as const;

type EventColumn = (typeof eventHeaders)[number];
type EventColumnIndex = Map<EventColumn, number>;

// New columns append here so existing sheet rows keep their positions.
const profileHeaders = [
  'id',
  'name',
  'dueDate',
  'birthDate',
  'timezone',
  'createdAt',
  'updatedAt',
  'syncState',
  'careInfo',
  'gender',
  'preferredUnits',
  // New columns append here so existing sheet rows keep their positions.
  'kind',
  'parentRole',
  'phone'
] as const;

type ProfileColumnIndex = Map<(typeof profileHeaders)[number], number>;

function createId(prefix: string) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function encodeRange(range: string) {
  return encodeURIComponent(range);
}

function normalizeCell(value: unknown) {
  return value === undefined || value === null ? '' : value;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * A date column that Sheets parsed comes back as a serial number. Convert it to
 * the string the app expects, so rows written before the switch to RAW still
 * read correctly — we migrate on read rather than rewriting history in place.
 */
function optionalDateString(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return optionalString(value);
  }

  const date = new Date(SHEETS_EPOCH_MS + Math.round(value * MS_PER_DAY));

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  // A whole serial is a plain date; a fraction carries a time of day too.
  return Number.isInteger(value) ? date.toISOString().slice(0, 10) : date.toISOString();
}

function optionalNumber(value: unknown) {
  if (value === '' || value === undefined || value === null) {
    return undefined;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

/**
 * Where each column we know about actually sits in this sheet.
 *
 * The header row is the authority, not our array order. A column inserted by
 * hand, or a stray header duplicated past the end, would otherwise shift every
 * field after it by one and quietly misread the whole row. **First occurrence
 * wins**, so a duplicated header never displaces the real column.
 *
 * A header the sheet does not name falls back to its position in our list —
 * which is what a sheet written by an older build looks like, and is exactly
 * how those rows were laid out.
 */
function columnIndex<T extends readonly string[]>(headers: T, headerRow: unknown[] | undefined): Map<T[number], number> {
  const index = new Map<T[number], number>();
  const sheetHeaders = (headerRow ?? []).map((cell) => (typeof cell === 'string' ? cell.trim() : ''));

  headers.forEach((header, position) => {
    const found = sheetHeaders.indexOf(header);
    index.set(header as T[number], found === -1 ? position : found);
  });

  return index;
}

function rowRecord<T extends readonly string[]>(headers: T, row: unknown[], index?: Map<T[number], number>) {
  const record = {} as Record<T[number], unknown>;

  headers.forEach((header, position) => {
    record[header as T[number]] = row[index?.get(header as T[number]) ?? position];
  });

  return record;
}

function profileFromRow(row: unknown[] | undefined, index?: ProfileColumnIndex): BabyProfile {
  if (!row || row.length === 0) {
    return createDefaultBabyProfile();
  }

  const record = rowRecord(profileHeaders, row, index);
  const fallback = createDefaultBabyProfile();

  let careInfo: CareInfo | undefined;
  const careInfoStr = optionalString(record.careInfo);
  if (careInfoStr) {
    try { careInfo = JSON.parse(careInfoStr) as CareInfo; } catch { /* ignore malformed JSON */ }
  }

  let preferredUnits: PreferredUnits | undefined;
  const preferredUnitsStr = optionalString(record.preferredUnits);
  if (preferredUnitsStr) {
    try { preferredUnits = JSON.parse(preferredUnitsStr) as PreferredUnits; } catch { /* ignore malformed JSON */ }
  }

  return {
    birthDate: optionalDateString(record.birthDate),
    careInfo,
    createdAt: optionalDateString(record.createdAt) ?? fallback.createdAt,
    // No fallback: a parent row carries no due date, and inventing Theo's here
    // would make every parent read as a pregnancy.
    dueDate: optionalDateString(record.dueDate),
    gender: optionalString(record.gender) as BabyGender | undefined,
    id: optionalString(record.id) ?? DEFAULT_PROFILE_ID,
    // A row written before parents existed has no kind, and every one of those
    // is a child.
    kind: optionalString(record.kind) === 'parent' ? 'parent' : 'child',
    name: optionalString(record.name) ?? fallback.name,
    parentRole: optionalString(record.parentRole) as ParentRole | undefined,
    phone: optionalString(record.phone),
    preferredUnits: preferredUnits ?? fallback.preferredUnits,
    syncState: 'synced',
    timezone: optionalString(record.timezone) ?? fallback.timezone,
    updatedAt: optionalDateString(record.updatedAt) ?? fallback.updatedAt
  };
}

function eventFromRow(row: unknown[], index?: EventColumnIndex): CareEvent | null {
  const record = rowRecord(eventHeaders, row, index);
  const type = optionalString(record.type) as StoredCareEventType | undefined;
  const id = optionalString(record.id);
  const startedAt = optionalDateString(record.startedAt);

  if (!id || !type || !startedAt) {
    return null;
  }

  const base = {
    babyId: optionalString(record.babyId) ?? DEFAULT_PROFILE_ID,
    caregiverId: optionalString(record.caregiverId),
    createdAt: optionalDateString(record.createdAt) ?? startedAt,
    endedAt: optionalDateString(record.endedAt),
    id,
    notes: optionalString(record.notes),
    startedAt,
    syncState: 'synced' as const,
    updatedAt: optionalDateString(record.updatedAt) ?? startedAt
  };

  switch (type) {
    case 'feed': {
      const amountOz = optionalNumber(record.amountOz);
      return {
        ...base,
        amountOz,
        contents: optionalString(record.contents) as BottleContents | undefined,
        durationMinutes: optionalNumber(record.durationMinutes),
        // Rows written before `method` existed are inferred from what they carry.
        method: (optionalString(record.method) ?? (amountOz != null ? 'bottle' : 'nursing')) as FeedMethod,
        side: optionalString(record.side) as NursingSide | undefined,
        type
      };
    }
    // Logged before nursing and bottle merged into one feeding entry.
    case 'breastfeed':
      return migrateStoredEvent({
        ...base,
        durationMinutes: optionalNumber(record.durationMinutes),
        side: (optionalString(record.side) ?? 'left') as NursingSide,
        type
      });
    case 'bottle':
      return migrateStoredEvent({
        ...base,
        amountOz: optionalNumber(record.amountOz),
        contents: (optionalString(record.contents) ?? 'breastmilk') as BottleContents,
        type
      });
    case 'birth':
      return {
        ...base,
        headCircumferenceIn: optionalNumber(record.headCircumferenceIn),
        lengthIn: optionalNumber(record.lengthIn),
        type,
        weightOz: optionalNumber(record.weightOz)
      };
    case 'pump':
      return {
        ...base,
        amountOz: optionalNumber(record.amountOz) ?? 0,
        side: (optionalString(record.side) ?? 'both') as 'left' | 'right' | 'both',
        type
      };
    // Color was free text and size is newer than the log, so the row goes
    // through the migration that resolves both (notes included).
    case 'diaper':
      return migrateStoredEvent({
        ...base,
        color: optionalString(record.color),
        kind: (optionalString(record.kind) ?? 'wet') as 'wet' | 'dirty' | 'both',
        poopSize: optionalString(record.poopSize),
        type
      });
    // Neither carries anything beyond the base row.
    case 'bath':
    case 'sleep':
      return {
        ...base,
        type
      };
    case 'medication':
      return {
        ...base,
        dose: optionalString(record.dose) ?? '',
        givenAt: optionalDateString(record.givenAt),
        medicationName: optionalString(record.medicationName) ?? '',
        scheduledAt: optionalDateString(record.scheduledAt),
        status: (optionalString(record.status) ?? 'given') as 'scheduled' | 'given' | 'skipped',
        type
      };
    case 'appointment':
      return {
        ...base,
        location: optionalString(record.location),
        provider: optionalString(record.provider),
        reason: optionalString(record.reason) ?? 'Appointment',
        type
      };
    case 'growth':
      return {
        ...base,
        headCircumferenceIn: optionalNumber(record.headCircumferenceIn),
        lengthIn: optionalNumber(record.lengthIn),
        type,
        weightOz: optionalNumber(record.weightOz)
      };
    case 'note':
      return {
        ...base,
        title: optionalString(record.title),
        type
      };
    case 'temperature':
      return {
        ...base,
        celsius: optionalNumber(record.celsius) ?? 0,
        type
      };
    case 'tummytime':
      return {
        ...base,
        durationMinutes: optionalNumber(record.durationMinutes) ?? 0,
        type
      };
    case 'mood':
      return {
        ...base,
        level: optionalNumber(record.moodLevel) ?? 3,
        type
      };
    case 'menses':
      return {
        ...base,
        flow: (optionalString(record.flow) ?? 'medium') as MensesFlow,
        type
      };
    case 'milestone':
      return {
        ...base,
        refId: optionalString(record.refId) ?? '',
        type
      };
    case 'vaccine':
      return {
        ...base,
        refId: optionalString(record.refId) ?? '',
        type
      };
  }
}

function eventToRow(event: CareEvent) {
  const values: Record<EventColumn, unknown> = {
    amountOz: '',
    babyId: event.babyId,
    caregiverId: event.caregiverId ?? '',
    celsius: '',
    color: '',
    contents: '',
    createdAt: event.createdAt,
    dose: '',
    durationMinutes: '',
    endedAt: event.endedAt ?? '',
    flow: '',
    givenAt: '',
    headCircumferenceIn: '',
    id: event.id,
    kind: '',
    lengthIn: '',
    location: '',
    medicationName: '',
    method: '',
    moodLevel: '',
    notes: event.notes ?? '',
    poopSize: '',
    provider: '',
    reason: '',
    refId: '',
    scheduledAt: '',
    side: '',
    startedAt: event.startedAt,
    status: '',
    syncState: 'synced',
    title: '',
    type: event.type,
    updatedAt: event.updatedAt,
    weightOz: ''
  };

  switch (event.type) {
    case 'feed':
      values.amountOz = event.amountOz ?? '';
      values.contents = event.contents ?? '';
      values.durationMinutes = event.durationMinutes ?? '';
      values.method = event.method;
      values.side = event.side ?? '';
      break;
    case 'birth':
      values.headCircumferenceIn = event.headCircumferenceIn ?? '';
      values.lengthIn = event.lengthIn ?? '';
      values.weightOz = event.weightOz ?? '';
      break;
    case 'pump':
      values.amountOz = event.amountOz;
      values.side = event.side;
      break;
    case 'diaper':
      values.color = event.color ?? '';
      values.kind = event.kind;
      values.poopSize = event.poopSize ?? '';
      break;
    case 'medication':
      values.dose = event.dose;
      values.givenAt = event.givenAt ?? '';
      values.medicationName = event.medicationName;
      values.scheduledAt = event.scheduledAt ?? '';
      values.status = event.status;
      break;
    case 'appointment':
      values.location = event.location ?? '';
      values.provider = event.provider ?? '';
      values.reason = event.reason;
      break;
    case 'growth':
      values.headCircumferenceIn = event.headCircumferenceIn ?? '';
      values.lengthIn = event.lengthIn ?? '';
      values.weightOz = event.weightOz ?? '';
      break;
    case 'note':
      values.title = event.title ?? '';
      break;
    case 'temperature':
      values.celsius = event.celsius;
      break;
    case 'tummytime':
      values.durationMinutes = event.durationMinutes;
      break;
    case 'mood':
      values.moodLevel = event.level;
      break;
    case 'menses':
      values.flow = event.flow;
      break;
    case 'milestone':
      values.refId = event.refId;
      break;
    case 'vaccine':
      values.refId = event.refId;
      break;
    case 'bath':
    case 'sleep':
      break;
  }

  return eventHeaders.map((header) => normalizeCell(values[header]));
}

function profileToRow(profile: BabyProfile) {
  return profileHeaders.map((header) => {
    if (header === 'careInfo' || header === 'preferredUnits') {
      const value = profile[header];
      return value ? JSON.stringify(value) : '';
    }
    return normalizeCell(profile[header as keyof BabyProfile]);
  });
}

function assertTrackerExport(data: TrackerExport) {
  if (data.version !== 1 || !data.profile || !Array.isArray(data.events)) {
    throw new Error('The selected file is not a BabySteps v1 export.');
  }
}

export class GoogleSheetsApi {
  constructor(private readonly getAccessToken: (forceRefresh?: boolean) => Promise<string>) {}

  private async request<T>(path: string, init: RequestInit = {}, forceRefresh = false): Promise<T> {
    const token = await this.getAccessToken(forceRefresh);
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}${path}`, {
      ...init,
      // Polling only helps if every read hits the network — a cached 200 would
      // hand back exactly the rows we already have.
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers
      }
    });

    if (!response.ok) {
      // Google can retire a token before its stated expiry — mint a fresh one
      // and retry once rather than sending the user back to the login screen.
      if (response.status === 401 && !forceRefresh) {
        return this.request<T>(path, init, true);
      }

      const text = await response.text();
      throw new Error(`Google Sheets request failed (${response.status}): ${text}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async getValues(range: string) {
    const result = await this.request<{ values?: unknown[][] }>(`/values/${encodeRange(range)}?valueRenderOption=UNFORMATTED_VALUE`);
    return result.values ?? [];
  }

  /** Read several ranges in one request — the whole app state for one poll. */
  async batchGetValues(ranges: string[]) {
    const query = ranges.map((range) => `ranges=${encodeRange(range)}`).join('&');
    const result = await this.request<{ valueRanges?: Array<{ values?: unknown[][] }> }>(
      `/values:batchGet?${query}&valueRenderOption=UNFORMATTED_VALUE`
    );

    return ranges.map((_, index) => result.valueRanges?.[index]?.values ?? []);
  }

  async updateValues(range: string, values: unknown[][]) {
    await this.request(`/values/${encodeRange(range)}?valueInputOption=${VALUE_INPUT_OPTION}`, {
      body: JSON.stringify({ majorDimension: 'ROWS', values }),
      method: 'PUT'
    });
  }

  async appendValues(range: string, values: unknown[][]) {
    await this.request(`/values/${encodeRange(range)}:append?valueInputOption=${VALUE_INPUT_OPTION}&insertDataOption=INSERT_ROWS`, {
      body: JSON.stringify({ majorDimension: 'ROWS', values }),
      method: 'POST'
    });
  }

  async clearValues(range: string) {
    await this.request(`/values/${encodeRange(range)}:clear`, {
      body: JSON.stringify({}),
      method: 'POST'
    });
  }

  async deleteEventRow(rowNumber: number) {
    await this.request(':batchUpdate', {
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: {
                dimension: 'ROWS',
                endIndex: rowNumber,
                sheetId: EVENTS_SHEET_ID,
                startIndex: rowNumber - 1
              }
            }
          }
        ]
      }),
      method: 'POST'
    });
  }
}

function rowsFromValues(values: unknown[][]) {
  const [headerRow, ...rows] = values;
  const columns = columnIndex(eventHeaders, headerRow);

  return rows
    .map((row, index) => ({
      event: eventFromRow(row, columns),
      rowNumber: index + 2
    }))
    .filter((row): row is { event: CareEvent; rowNumber: number } => Boolean(row.event));
}

/**
 * One row per child, paired with the row it sits on so a save can go back to
 * exactly that row. A row without an id is a gap left by a removed child, and
 * is skipped rather than read as a nameless baby.
 */
function profileRowsFromValues(values: unknown[][]) {
  const [headerRow, ...rows] = values;
  const columns = columnIndex(profileHeaders, headerRow);
  const idColumn = columns.get('id') ?? 0;

  return rows
    .map((row, index) => ({ row: row ?? [], rowNumber: index + FIRST_PROFILE_ROW }))
    .filter(({ row }) => Boolean(optionalString(row[idColumn])))
    .map(({ row, rowNumber }) => ({ profile: profileFromRow(row, columns), rowNumber }));
}

/** The children in switcher order, and where each one's row is. */
function readProfiles(values: unknown[][]) {
  const rows = profileRowsFromValues(values);
  const rowNumbers = new Map(rows.map(({ profile, rowNumber }) => [profile.id, rowNumber]));
  const profiles = sortProfiles(rows.map(({ profile }) => profile));
  const nextRow = rows.reduce((highest, { rowNumber }) => Math.max(highest, rowNumber + 1), FIRST_PROFILE_ROW);

  return { nextRow, profiles, rowNumbers };
}

/** The child a read is about: the one it named, or the first one. */
function pickProfile(profiles: BabyProfile[], babyId?: string) {
  return profiles.find((profile) => profile.id === babyId) ?? profiles[0] ?? createDefaultBabyProfile();
}

function selectEvents(events: CareEvent[], babyId: string, query: EventQuery) {
  return events
    .filter((event) => event.babyId === babyId)
    .filter((event) => (query.type ? event.type === query.type : true))
    .filter((event) => (query.from ? event.startedAt >= query.from : true))
    .filter((event) => (query.to ? event.startedAt <= query.to : true))
    .sort((a, b) => {
      const result = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
      return query.sort === 'asc' ? result : -result;
    });
}

export function createGoogleSheetsBabyTrackerStore(api = new GoogleSheetsApi(() => requestGoogleSheetsAccessToken(false))): BabyTrackerStore {
  let headersWritten = false;

  async function listRows() {
    return rowsFromValues(await api.getValues(EVENTS_RANGE));
  }

  async function listProfiles() {
    const { profiles } = readProfiles(await api.getValues(PROFILE_RANGE));
    return profiles;
  }

  async function getProfile() {
    return (await listProfiles())[0];
  }

  /** Header rows, written once a session rather than on every write. */
  async function ensureHeaders() {
    if (headersWritten) {
      return;
    }

    await api.updateValues('Events!A1:AH1', [[...eventHeaders]]);
    await api.updateValues(PROFILE_HEADER_RANGE, [[...profileHeaders]]);
    headersWritten = true;
  }

  /**
   * A header cell past our last column that repeats one of our own header names
   * is a leftover from an earlier write, and only ever confusing to read in the
   * sheet. Blanked on the once-a-session header pass. A header we do not
   * recognise is somebody's own column and is left exactly alone.
   */
  async function clearStrayHeaders(headerRow: unknown[] | undefined) {
    const extras = (headerRow ?? []).slice(profileHeaders.length);
    const stray = extras.some((cell) => typeof cell === 'string' && (profileHeaders as readonly string[]).includes(cell.trim()));

    if (!stray) {
      return;
    }

    const firstExtra = columnLetter(profileHeaders.length);
    const lastExtra = columnLetter(profileHeaders.length + extras.length - 1);
    await api.clearValues(`Profile!${firstExtra}1:${lastExtra}1`);
  }

  async function initialize() {
    const values = await api.getValues(PROFILE_RANGE);
    const { profiles } = readProfiles(values);
    const profile = profiles[0] ?? createDefaultBabyProfile();

    // Seed the first child only when the sheet has none. Writing it back on
    // every read would clobber a profile edit another device made since we read
    // it — and reads happen on every poll now.
    if (profiles.length === 0) {
      await api.updateValues(profileRowRange(FIRST_PROFILE_ROW), [profileToRow(profile)]);
    }

    await ensureHeaders();
    await clearStrayHeaders(values[0]);
    return profile;
  }

  /**
   * Every child, plus the active one's events, in a single request — so a
   * background poll costs one round trip and can't read the two halves from
   * different versions of the sheet.
   */
  async function snapshot(query: EventQuery = {}): Promise<TrackerSnapshot> {
    const [profileValues, eventValues] = await api.batchGetValues([PROFILE_RANGE, EVENTS_RANGE]);
    const { profiles } = readProfiles(profileValues);
    const profile = pickProfile(profiles, query.babyId);
    const all = rowsFromValues(eventValues).map((row) => row.event);
    // A parent's report is partly about the babies, so their rows come along.
    // The read already returned them; this only decides what to hand back.
    const childIds = new Set(profiles.filter(isChild).map((person) => person.id));

    return {
      childEvents: isParent(profile) ? all.filter((event) => childIds.has(event.babyId)) : undefined,
      events: selectEvents(all, profile.id, query),
      profile,
      profiles: profiles.length > 0 ? profiles : [profile]
    };
  }

  /**
   * Writes one child's row, found by id. A patch for a child this sheet has
   * never seen appends rather than overwriting whoever is on the first row.
   */
  async function saveProfile(profilePatch: Partial<BabyProfile>) {
    // One read, not `initialize()`'s read plus this one: an empty sheet needs no
    // seeding here, since the row this write lands on is the row it would seed.
    await ensureHeaders();
    const { nextRow, profiles, rowNumbers } = readProfiles(await api.getValues(PROFILE_RANGE));
    const existing = pickProfile(profiles, profilePatch.id);
    const targetId = profilePatch.id ?? existing.id;
    const base = existing.id === targetId ? existing : { ...createDefaultBabyProfile(), id: targetId };
    const timestamp = new Date().toISOString();
    const profile: BabyProfile = {
      ...base,
      ...profilePatch,
      id: targetId,
      createdAt: profilePatch.createdAt ?? base.createdAt,
      syncState: 'synced',
      updatedAt: timestamp
    };

    await api.updateValues(profileRowRange(rowNumbers.get(targetId) ?? nextRow), [profileToRow(profile)]);
    return profile;
  }

  async function addProfile(input: NewProfileInput) {
    await ensureHeaders();
    const { nextRow, profiles } = readProfiles(await api.getValues(PROFILE_RANGE));
    const profile = createFamilyProfile(input, profiles);

    // Written to the next free row rather than appended, so a gap left by a
    // removed child is filled instead of drifting down the sheet forever.
    await api.updateValues(profileRowRange(nextRow), [profileToRow({ ...profile, syncState: 'synced' })]);
    return { ...profile, syncState: 'synced' as const };
  }

  /**
   * Blanks the child's row. Its entries stay in the Events sheet — we migrate
   * and leave history alone rather than deleting rows someone else may still be
   * reading — and the blank row is skipped on the way back in.
   */
  async function deleteProfile(id: string) {
    const { rowNumbers } = readProfiles(await api.getValues(PROFILE_RANGE));
    const rowNumber = rowNumbers.get(id);

    if (rowNumber) {
      await api.clearValues(profileRowRange(rowNumber));
    }
  }

  async function addEvent(input: CreateCareEventInput) {
    const profile = await initialize();
    const timestamp = new Date().toISOString();
    const event = {
      ...input,
      babyId: input.babyId ?? profile.id,
      createdAt: input.createdAt ?? timestamp,
      id: input.id ?? createId('event'),
      syncState: 'synced',
      updatedAt: input.updatedAt ?? timestamp
    } as CareEvent;

    await api.appendValues(EVENTS_APPEND_RANGE, [eventToRow(event)]);
    return event;
  }

  async function updateEvent(event: CareEvent) {
    const rows = await listRows();
    const match = rows.find((row) => row.event.id === event.id);

    if (!match) {
      throw new Error(`Event ${event.id} was not found in the Google Sheet.`);
    }

    const updated: CareEvent = {
      ...event,
      syncState: 'synced',
      updatedAt: new Date().toISOString()
    };

    await api.updateValues(`Events!A${match.rowNumber}:AH${match.rowNumber}`, [eventToRow(updated)]);
    return updated;
  }

  /**
   * One write for the whole batch, and only down the caregiver column. Attributing
   * months of history a row at a time would be hundreds of round trips, and
   * rewriting whole rows would clobber whatever another caregiver edited in the
   * meantime — this touches one cell per row and nothing else.
   */
  async function assignCaregivers(assignments: CaregiverAssignment[]) {
    if (assignments.length === 0) {
      return;
    }

    const values = await api.getValues(EVENTS_RANGE);
    const [headerRow, ...rows] = values;

    if (rows.length === 0) {
      return;
    }

    const columns = columnIndex(eventHeaders, headerRow);
    const idColumn = columns.get('id') ?? 0;
    const caregiverColumn = columns.get('caregiverId') ?? eventHeaders.indexOf('caregiverId');
    const wanted = new Map(assignments.map((assignment) => [assignment.id, assignment.caregiverId]));

    const column = rows.map((row) => {
      const id = optionalString(row?.[idColumn]);
      const next = id ? wanted.get(id) : undefined;
      return [next ?? normalizeCell(row?.[caregiverColumn])];
    });

    const letter = columnLetter(caregiverColumn);
    await api.updateValues(`Events!${letter}2:${letter}${column.length + 1}`, column);
  }

  async function deleteEvent(id: string) {
    const rows = await listRows();
    const match = rows.find((row) => row.event.id === id);

    if (match) {
      await api.deleteEventRow(match.rowNumber);
    }
  }

  async function listEvents(query: EventQuery = {}) {
    const { events } = await snapshot(query);
    return events;
  }

  /** Every child and every child's entries — an export is the whole tracker. */
  async function exportData(): Promise<TrackerExport> {
    const [profileValues, eventValues] = await api.batchGetValues([PROFILE_RANGE, EVENTS_RANGE]);
    const { profiles } = readProfiles(profileValues);
    const events = rowsFromValues(eventValues)
      .map((row) => row.event)
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

    return {
      events,
      exportedAt: new Date().toISOString(),
      profile: profiles[0] ?? createDefaultBabyProfile(),
      profiles,
      version: 1
    };
  }

  async function importData(data: TrackerExport, options: ImportOptions = {}) {
    assertTrackerExport(data);

    // An export taken before this app tracked siblings carries one profile.
    for (const profile of data.profiles?.length ? data.profiles : [data.profile]) {
      await saveProfile(profile);
    }

    // An export taken before the feeding merge still carries breastfeed/bottle.
    const incoming = migrateStoredEvents(data.events);

    if (options.mode === 'replace') {
      await api.clearValues(EVENTS_BODY_RANGE);
      if (incoming.length > 0) {
        await api.updateValues('Events!A2:AH', incoming.map((event) => eventToRow({ ...event, syncState: 'synced' })));
      }
      return;
    }

    const current = await listRows();
    const currentIds = new Set(current.map((row) => row.event.id));
    const newEvents = incoming.filter((event) => !currentIds.has(event.id));

    if (newEvents.length > 0) {
      await api.appendValues(EVENTS_APPEND_RANGE, newEvents.map((event) => eventToRow({ ...event, syncState: 'synced' })));
    }
  }

  async function clear() {
    await api.clearValues(EVENTS_BODY_RANGE);
  }

  return {
    addEvent,
    addProfile,
    assignCaregivers,
    clear,
    close: () => {},
    deleteEvent,
    deleteProfile,
    exportData,
    getProfile,
    importData,
    initialize,
    listEvents,
    listProfiles,
    saveProfile,
    snapshot,
    updateEvent
  };
}
