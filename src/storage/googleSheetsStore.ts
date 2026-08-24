import { createDefaultBabyProfile } from '../domain/dates';
import { migrateStoredEvent, migrateStoredEvents, type StoredCareEventType } from '../domain/legacyEvents';
import { DEFAULT_PROFILE_ID, type BabyGender, type BabyProfile, type BottleContents, type CareInfo, type CareEvent, type CreateCareEventInput, type FeedMethod, type NursingSide, type TrackerExport, type TrackerSnapshot } from '../domain/types';
import { requestGoogleSheetsAccessToken } from './googleSheetsAuth';
import type { BabyTrackerStore, EventQuery, ImportOptions } from './store';

export const GOOGLE_SHEET_ID = '1VG9px1j-KF29i2J6AG_PP57hOM8V-wLPgP-9VTdURUc';
export const GOOGLE_SHEET_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit`;

// Widen these together with `profileHeaders` — a new profile field is a new
// column, and the range has to reach it.
const PROFILE_RANGE = 'Profile!A1:J2';
const PROFILE_ROW_RANGE = 'Profile!A2:J2';
const EVENTS_RANGE = 'Events!A:AE';
const EVENTS_BODY_RANGE = 'Events!A2:AE1000';
const EVENTS_APPEND_RANGE = 'Events!A:AE';
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
  'method'
] as const;

type EventColumn = (typeof eventHeaders)[number];

// New columns append here so existing sheet rows keep their positions.
const profileHeaders = ['id', 'name', 'dueDate', 'birthDate', 'timezone', 'createdAt', 'updatedAt', 'syncState', 'careInfo', 'gender'] as const;

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

function rowRecord<T extends readonly string[]>(headers: T, row: unknown[]) {
  const record = {} as Record<T[number], unknown>;

  headers.forEach((header, index) => {
    record[header as T[number]] = row[index];
  });

  return record;
}

function profileFromRow(row: unknown[] | undefined): BabyProfile {
  if (!row || row.length === 0) {
    return createDefaultBabyProfile();
  }

  const record = rowRecord(profileHeaders, row);
  const fallback = createDefaultBabyProfile();

  let careInfo: CareInfo | undefined;
  const careInfoStr = optionalString(record.careInfo);
  if (careInfoStr) {
    try { careInfo = JSON.parse(careInfoStr) as CareInfo; } catch { /* ignore malformed JSON */ }
  }

  return {
    id: optionalString(record.id) ?? DEFAULT_PROFILE_ID,
    name: optionalString(record.name) ?? fallback.name,
    dueDate: optionalDateString(record.dueDate) ?? fallback.dueDate,
    birthDate: optionalDateString(record.birthDate),
    gender: optionalString(record.gender) as BabyGender | undefined,
    timezone: optionalString(record.timezone) ?? fallback.timezone,
    createdAt: optionalDateString(record.createdAt) ?? fallback.createdAt,
    updatedAt: optionalDateString(record.updatedAt) ?? fallback.updatedAt,
    syncState: 'synced',
    careInfo
  };
}

function eventFromRow(row: unknown[]): CareEvent | null {
  const record = rowRecord(eventHeaders, row);
  const type = optionalString(record.type) as StoredCareEventType | undefined;
  const id = optionalString(record.id);
  const startedAt = optionalDateString(record.startedAt);

  if (!id || !type || !startedAt) {
    return null;
  }

  const base = {
    babyId: optionalString(record.babyId) ?? DEFAULT_PROFILE_ID,
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
    case 'diaper':
      return {
        ...base,
        color: optionalString(record.color),
        kind: (optionalString(record.kind) ?? 'wet') as 'wet' | 'dirty' | 'both',
        type
      };
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
    celsius: '',
    color: '',
    contents: '',
    createdAt: event.createdAt,
    dose: '',
    durationMinutes: '',
    endedAt: event.endedAt ?? '',
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
    refId: '',
    provider: '',
    reason: '',
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
    if (header === 'careInfo') {
      return profile.careInfo ? JSON.stringify(profile.careInfo) : '';
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
  const [, ...rows] = values;

  return rows
    .map((row, index) => ({
      event: eventFromRow(row),
      rowNumber: index + 2
    }))
    .filter((row): row is { event: CareEvent; rowNumber: number } => Boolean(row.event));
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

  async function getProfile() {
    const values = await api.getValues(PROFILE_RANGE);
    return profileFromRow(values[1]);
  }

  async function initialize() {
    const values = await api.getValues(PROFILE_RANGE);
    const row = values[1];
    const profile = profileFromRow(row);

    // Seed the row only when the sheet has none. Writing it back on every read
    // would clobber a profile edit another device made since we read it — and
    // reads happen on every poll now.
    if (!row || row.length === 0) {
      await api.updateValues(PROFILE_ROW_RANGE, [profileToRow(profile)]);
    }

    if (!headersWritten) {
      await api.updateValues('Events!A1:AE1', [[...eventHeaders]]);
      await api.updateValues('Profile!A1:J1', [[...profileHeaders]]);
      headersWritten = true;
    }

    return profile;
  }

  /**
   * Profile + events in a single request, so a background poll costs one round
   * trip and can't read the two halves from different versions of the sheet.
   */
  async function snapshot(query: EventQuery = {}): Promise<TrackerSnapshot> {
    const [profileValues, eventValues] = await api.batchGetValues([PROFILE_RANGE, EVENTS_RANGE]);
    const profile = profileFromRow(profileValues[1]);

    return {
      events: selectEvents(rowsFromValues(eventValues).map((row) => row.event), query.babyId ?? profile.id, query),
      profile
    };
  }

  async function saveProfile(profilePatch: Partial<BabyProfile>) {
    const existing = await initialize();
    const timestamp = new Date().toISOString();
    const profile: BabyProfile = {
      ...existing,
      ...profilePatch,
      id: profilePatch.id ?? existing.id,
      createdAt: profilePatch.createdAt ?? existing.createdAt,
      syncState: 'synced',
      updatedAt: timestamp
    };

    await api.updateValues(PROFILE_ROW_RANGE, [profileToRow(profile)]);
    return profile;
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

    await api.updateValues(`Events!A${match.rowNumber}:AE${match.rowNumber}`, [eventToRow(updated)]);
    return updated;
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

  async function exportData(): Promise<TrackerExport> {
    const { events, profile } = await snapshot({ sort: 'asc' });

    return {
      events,
      exportedAt: new Date().toISOString(),
      profile,
      version: 1
    };
  }

  async function importData(data: TrackerExport, options: ImportOptions = {}) {
    assertTrackerExport(data);
    await saveProfile(data.profile);

    // An export taken before the feeding merge still carries breastfeed/bottle.
    const incoming = migrateStoredEvents(data.events);

    if (options.mode === 'replace') {
      await api.clearValues(EVENTS_BODY_RANGE);
      if (incoming.length > 0) {
        await api.updateValues('Events!A2:AE', incoming.map((event) => eventToRow({ ...event, syncState: 'synced' })));
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
    clear,
    close: () => {},
    deleteEvent,
    exportData,
    getProfile,
    importData,
    initialize,
    listEvents,
    saveProfile,
    snapshot,
    updateEvent
  };
}
