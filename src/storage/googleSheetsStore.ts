import { createDefaultBabyProfile } from '../domain/dates';
import { DEFAULT_PROFILE_ID, type BabyProfile, type CareInfo, type CareEvent, type CareEventType, type CreateCareEventInput, type TrackerExport } from '../domain/types';
import { requestGoogleSheetsAccessToken } from './googleSheetsAuth';
import type { BabyTrackerStore, EventQuery, ImportOptions } from './store';

export const GOOGLE_SHEET_ID = '1VG9px1j-KF29i2J6AG_PP57hOM8V-wLPgP-9VTdURUc';
export const GOOGLE_SHEET_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit`;

const PROFILE_RANGE = 'Profile!A1:I2';
const PROFILE_ROW_RANGE = 'Profile!A2:I2';
const EVENTS_RANGE = 'Events!A:AE';
const EVENTS_BODY_RANGE = 'Events!A2:AE1000';
const EVENTS_APPEND_RANGE = 'Events!A:AE';
const EVENTS_SHEET_ID = 0;

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
  'refId'
] as const;

type EventColumn = (typeof eventHeaders)[number];

const profileHeaders = ['id', 'name', 'dueDate', 'birthDate', 'timezone', 'createdAt', 'updatedAt', 'syncState', 'careInfo'] as const;

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
    dueDate: optionalString(record.dueDate) ?? fallback.dueDate,
    birthDate: optionalString(record.birthDate),
    timezone: optionalString(record.timezone) ?? fallback.timezone,
    createdAt: optionalString(record.createdAt) ?? fallback.createdAt,
    updatedAt: optionalString(record.updatedAt) ?? fallback.updatedAt,
    syncState: 'synced',
    careInfo
  };
}

function eventFromRow(row: unknown[]): CareEvent | null {
  const record = rowRecord(eventHeaders, row);
  const type = optionalString(record.type) as CareEventType | undefined;
  const id = optionalString(record.id);
  const startedAt = optionalString(record.startedAt);

  if (!id || !type || !startedAt) {
    return null;
  }

  const base = {
    babyId: optionalString(record.babyId) ?? DEFAULT_PROFILE_ID,
    createdAt: optionalString(record.createdAt) ?? startedAt,
    endedAt: optionalString(record.endedAt),
    id,
    notes: optionalString(record.notes),
    startedAt,
    syncState: 'synced' as const,
    updatedAt: optionalString(record.updatedAt) ?? startedAt
  };

  switch (type) {
    case 'breastfeed':
      return {
        ...base,
        durationMinutes: optionalNumber(record.durationMinutes) ?? 0,
        side: (optionalString(record.side) ?? 'left') as 'left' | 'right' | 'both',
        type
      };
    case 'birth':
      return {
        ...base,
        headCircumferenceIn: optionalNumber(record.headCircumferenceIn),
        lengthIn: optionalNumber(record.lengthIn),
        type,
        weightOz: optionalNumber(record.weightOz)
      };
    case 'bottle':
      return {
        ...base,
        amountOz: optionalNumber(record.amountOz) ?? 0,
        contents: (optionalString(record.contents) ?? 'breastmilk') as 'breastmilk' | 'formula' | 'mixed' | 'other',
        type
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
    case 'sleep':
      return {
        ...base,
        type
      };
    case 'medication':
      return {
        ...base,
        dose: optionalString(record.dose) ?? '',
        givenAt: optionalString(record.givenAt),
        medicationName: optionalString(record.medicationName) ?? '',
        scheduledAt: optionalString(record.scheduledAt),
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
    case 'breastfeed':
      values.durationMinutes = event.durationMinutes;
      values.side = event.side;
      break;
    case 'birth':
      values.headCircumferenceIn = event.headCircumferenceIn ?? '';
      values.lengthIn = event.lengthIn ?? '';
      values.weightOz = event.weightOz ?? '';
      break;
    case 'bottle':
      values.amountOz = event.amountOz;
      values.contents = event.contents;
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
  constructor(private readonly getAccessToken: () => Promise<string>) {}

  private async request<T>(path: string, init: RequestInit = {}) {
    const token = await this.getAccessToken();
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers
      }
    });

    if (!response.ok) {
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

  async updateValues(range: string, values: unknown[][]) {
    await this.request(`/values/${encodeRange(range)}?valueInputOption=USER_ENTERED`, {
      body: JSON.stringify({ majorDimension: 'ROWS', values }),
      method: 'PUT'
    });
  }

  async appendValues(range: string, values: unknown[][]) {
    await this.request(`/values/${encodeRange(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
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

export function createGoogleSheetsBabyTrackerStore(api = new GoogleSheetsApi(() => requestGoogleSheetsAccessToken(false))): BabyTrackerStore {
  let headersWritten = false;

  async function listRows() {
    const values = await api.getValues(EVENTS_RANGE);
    const [, ...rows] = values;
    return rows
      .map((row, index) => ({
        event: eventFromRow(row),
        rowNumber: index + 2
      }))
      .filter((row): row is { event: CareEvent; rowNumber: number } => Boolean(row.event));
  }

  async function getProfile() {
    const values = await api.getValues(PROFILE_RANGE);
    return profileFromRow(values[1]);
  }

  async function initialize() {
    const profile = await getProfile();
    await api.updateValues(PROFILE_ROW_RANGE, [profileToRow(profile)]);
    if (!headersWritten) {
      await api.updateValues('Events!A1:AD1', [[...eventHeaders]]);
      headersWritten = true;
    }
    return profile;
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
    const profile = await initialize();
    const babyId = query.babyId ?? profile.id;
    const rows = await listRows();

    return rows
      .map((row) => row.event)
      .filter((event) => event.babyId === babyId)
      .filter((event) => (query.type ? event.type === query.type : true))
      .filter((event) => (query.from ? event.startedAt >= query.from : true))
      .filter((event) => (query.to ? event.startedAt <= query.to : true))
      .sort((a, b) => {
        const result = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
        return query.sort === 'asc' ? result : -result;
      });
  }

  async function exportData(): Promise<TrackerExport> {
    const profile = await initialize();
    const events = await listEvents({ sort: 'asc' });

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

    if (options.mode === 'replace') {
      await api.clearValues(EVENTS_BODY_RANGE);
      if (data.events.length > 0) {
        await api.updateValues('Events!A2:AE', data.events.map((event) => eventToRow({ ...event, syncState: 'synced' })));
      }
      return;
    }

    const current = await listRows();
    const currentIds = new Set(current.map((row) => row.event.id));
    const newEvents = data.events.filter((event) => !currentIds.has(event.id));

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
    updateEvent
  };
}
