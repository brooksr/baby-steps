import { createFamilyProfile, getActiveProfiles, isArchived, isChild, isParent, sortProfiles, type NewProfileInput } from '../domain/family';
import { createDefaultBabyProfile } from '../domain/dates';
import { parseIntakeTags, serializeIntakeTags } from '../domain/intakeOutput';
import { DEFAULT_SHOPPING_CATEGORY, getCatalogSeed, isShoppingCategory, normalizeItemName } from '../domain/shopping';
import { migrateStoredEvent, migrateStoredEvents, type StoredCareEventType } from '../domain/legacyEvents';
import { DEFAULT_PROFILE_ID, type BabyGender, type BabyProfile, type BottleContents, type CareInfo, type CareEvent, type CreateCareEventInput, type FeedMethod, type IntakeKind, type IntakePortion, type MensesFlow, type NursingSide, type OutputKind, type ShoppingCategory, type ShoppingItem, type ShoppingStatus, type TaskItem, type TaskStatus, type ParentRole, type PreferredUnits, type TrackerExport, type TrackerSnapshot } from '../domain/types';
import { requestGoogleSheetsAccessToken } from './googleSheetsAuth';
import type { BabyTrackerStore, CaregiverAssignment, EventQuery, ImportOptions, ShoppingItemInput, TaskItemInput } from './store';

export const GOOGLE_SHEET_ID = '1VG9px1j-KF29i2J6AG_PP57hOM8V-wLPgP-9VTdURUc';
export const GOOGLE_SHEET_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit`;

// Widen these together with `profileHeaders` — a new profile field is a new
// column, and the range has to reach it. The range is open-ended down the
// sheet because one row is one child, and there can be any number of them.
const PROFILE_RANGE = 'Profile!A:O';
const PROFILE_HEADER_RANGE = 'Profile!A1:O1';
/** Row 2 is the first child; `profileRowRange` addresses the rest. */
const FIRST_PROFILE_ROW = 2;
const EVENTS_RANGE = 'Events!A:AN';
const EVENTS_BODY_RANGE = 'Events!A2:AN1000';
const EVENTS_APPEND_RANGE = 'Events!A:AN';
const EVENTS_SHEET_ID = 0;

/**
 * The household lists, one tab each. Both are open-ended down the sheet, and
 * **neither is on a sheet written before this feature existed** — `ensureTabs`
 * creates them, and `snapshot` copes with reading a sheet that has not had it
 * run yet rather than failing the whole poll over a missing range.
 */
const SHOPPING_TAB = 'Shopping';
const TASKS_TAB = 'Tasks';
const SHOPPING_RANGE = `${SHOPPING_TAB}!A:K`;
const SHOPPING_BODY_RANGE = `${SHOPPING_TAB}!A2:K1000`;
const SHOPPING_HEADER_RANGE = `${SHOPPING_TAB}!A1:K1`;
const TASKS_RANGE = `${TASKS_TAB}!A:J`;
const TASKS_BODY_RANGE = `${TASKS_TAB}!A2:J1000`;
const TASKS_HEADER_RANGE = `${TASKS_TAB}!A1:J1`;
/** Row 2 is the first list row; row 1 is always the header. */
const FIRST_LIST_ROW = 2;

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
  return `Profile!A${rowNumber}:O${rowNumber}`;
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
  'caregiverId',
  // A parent's inputs and outputs. `kind`, `color` and `amountOz` are shared
  // with the baby's rows above — a stool color is a stool color whoever passed
  // it — and these six are the fields nothing else had a column for.
  'items',
  'tags',
  'portion',
  'caffeineMg',
  'severity',
  'bristol'
] as const;

type EventColumn = (typeof eventHeaders)[number];
type EventColumnIndex = Map<EventColumn, number>;

// New columns append here so existing sheet rows keep their positions.
const shoppingHeaders = [
  'id',
  'name',
  'category',
  'isFood',
  'status',
  'quantity',
  'notes',
  'addedBy',
  'createdAt',
  'updatedAt',
  'completedAt'
] as const;

const taskHeaders = [
  'id',
  'title',
  'notes',
  'status',
  'dueAt',
  'assigneeId',
  'createdBy',
  'createdAt',
  'updatedAt',
  'completedAt'
] as const;

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
  'phone',
  'archivedAt'
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
    archivedAt: optionalDateString(record.archivedAt),
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
    // The parent's own rows. A tag list is one cell, and an id nobody
    // recognises is kept as written rather than dropped.
    case 'intake':
      return {
        ...base,
        amountOz: optionalNumber(record.amountOz),
        caffeineMg: optionalNumber(record.caffeineMg),
        items: optionalString(record.items),
        kind: (optionalString(record.kind) ?? 'food') as IntakeKind,
        portion: optionalString(record.portion) as IntakePortion | undefined,
        tags: parseIntakeTags(optionalString(record.tags)),
        type
      };
    case 'output':
      return {
        ...base,
        bristol: optionalNumber(record.bristol),
        color: optionalString(record.color),
        kind: (optionalString(record.kind) ?? 'pee') as OutputKind,
        severity: optionalNumber(record.severity),
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
    bristol: '',
    caffeineMg: '',
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
    items: '',
    kind: '',
    lengthIn: '',
    location: '',
    medicationName: '',
    method: '',
    moodLevel: '',
    notes: event.notes ?? '',
    poopSize: '',
    portion: '',
    provider: '',
    reason: '',
    refId: '',
    scheduledAt: '',
    severity: '',
    side: '',
    startedAt: event.startedAt,
    status: '',
    syncState: 'synced',
    tags: '',
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
    case 'intake':
      values.amountOz = event.amountOz ?? '';
      values.caffeineMg = event.caffeineMg ?? '';
      values.items = event.items ?? '';
      values.kind = event.kind;
      values.portion = event.portion ?? '';
      values.tags = serializeIntakeTags(event.tags);
      break;
    case 'output':
      values.bristol = event.bristol ?? '';
      values.color = event.color ?? '';
      values.kind = event.kind;
      values.severity = event.severity ?? '';
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

/**
 * A list row, paired with the row number it sits on so a save goes back to
 * exactly that row. A row without an id is a gap left by a removed item and is
 * skipped — row numbers stay put, the way a removed child's row does.
 */
function listRowsFromValues<T>(
  values: unknown[][],
  headers: readonly string[],
  read: (record: Record<string, unknown>) => T | null
) {
  const [headerRow, ...rows] = values;
  const columns = columnIndex(headers, headerRow);

  return rows
    .map((row, index) => ({
      item: read(rowRecord(headers, row ?? [], columns)),
      rowNumber: index + FIRST_LIST_ROW
    }))
    .filter((entry): entry is { item: T; rowNumber: number } => entry.item !== null);
}

function shoppingFromRecord(record: Record<string, unknown>): ShoppingItem | null {
  const id = optionalString(record.id);
  const name = optionalString(record.name);

  if (!id || !name) {
    return null;
  }

  const createdAt = optionalDateString(record.createdAt) ?? new Date(0).toISOString();

  return {
    addedBy: optionalString(record.addedBy),
    category: (isShoppingCategory(optionalString(record.category)) ? record.category : DEFAULT_SHOPPING_CATEGORY) as ShoppingCategory,
    completedAt: optionalDateString(record.completedAt),
    createdAt,
    id,
    // Written as the word, so the column reads as something in the sheet.
    isFood: optionalString(record.isFood) === 'yes',
    name,
    notes: optionalString(record.notes),
    quantity: optionalString(record.quantity),
    status: (optionalString(record.status) ?? 'need') as ShoppingStatus,
    syncState: 'synced',
    updatedAt: optionalDateString(record.updatedAt) ?? createdAt
  };
}

function shoppingToRow(item: ShoppingItem) {
  const values: Record<(typeof shoppingHeaders)[number], unknown> = {
    addedBy: item.addedBy ?? '',
    category: item.category,
    completedAt: item.completedAt ?? '',
    createdAt: item.createdAt,
    id: item.id,
    isFood: item.isFood ? 'yes' : 'no',
    name: item.name,
    notes: item.notes ?? '',
    quantity: item.quantity ?? '',
    status: item.status,
    updatedAt: item.updatedAt
  };

  return shoppingHeaders.map((header) => normalizeCell(values[header]));
}

function taskFromRecord(record: Record<string, unknown>): TaskItem | null {
  const id = optionalString(record.id);
  const title = optionalString(record.title);

  if (!id || !title) {
    return null;
  }

  const createdAt = optionalDateString(record.createdAt) ?? new Date(0).toISOString();

  return {
    assigneeId: optionalString(record.assigneeId),
    completedAt: optionalDateString(record.completedAt),
    createdAt,
    createdBy: optionalString(record.createdBy),
    // Every date column goes through `optionalDateString` — a due date typed as
    // a plain day is exactly the cell Sheets used to hand back as a serial.
    dueAt: optionalDateString(record.dueAt),
    id,
    notes: optionalString(record.notes),
    status: (optionalString(record.status) ?? 'open') as TaskStatus,
    syncState: 'synced',
    title,
    updatedAt: optionalDateString(record.updatedAt) ?? createdAt
  };
}

function taskToRow(task: TaskItem) {
  const values: Record<(typeof taskHeaders)[number], unknown> = {
    assigneeId: task.assigneeId ?? '',
    completedAt: task.completedAt ?? '',
    createdAt: task.createdAt,
    createdBy: task.createdBy ?? '',
    dueAt: task.dueAt ?? '',
    id: task.id,
    notes: task.notes ?? '',
    status: task.status,
    title: task.title,
    updatedAt: task.updatedAt
  };

  return taskHeaders.map((header) => normalizeCell(values[header]));
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

  /** The tab titles this spreadsheet already has — what `ensureTabs` reads. */
  async listSheetTitles() {
    const result = await this.request<{ sheets?: Array<{ properties?: { title?: string } }> }>(
      '?fields=sheets.properties.title'
    );

    return (result.sheets ?? []).map((sheet) => sheet.properties?.title).filter((title): title is string => Boolean(title));
  }

  async addSheets(titles: string[]) {
    if (titles.length === 0) {
      return;
    }

    await this.request(':batchUpdate', {
      body: JSON.stringify({
        requests: titles.map((title) => ({ addSheet: { properties: { title } } }))
      }),
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

/**
 * Who a read is about: the person it named, or the first one still in the
 * switcher. An archived profile is never landed on by default — the device that
 * stored that choice would otherwise open on someone deliberately set aside.
 */
function pickProfile(profiles: BabyProfile[], babyId?: string) {
  const named = profiles.find((profile) => profile.id === babyId);

  if (named && !isArchived(named)) {
    return named;
  }

  return getActiveProfiles(profiles)[0] ?? named ?? profiles[0] ?? createDefaultBabyProfile();
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
  /**
   * Whether the Shopping and Tasks tabs are known to exist. False until
   * `ensureTabs` has run once, which is what keeps `snapshot` from naming a
   * range that would fail the whole batch read on a sheet that predates them.
   */
  let listsReady = false;

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

    await api.updateValues('Events!A1:AN1', [[...eventHeaders]]);
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

  /**
   * Creates the Shopping and Tasks tabs if the spreadsheet has not got them.
   *
   * The shared sheet predates both, and a `values:batchGet` naming a range on a
   * tab that does not exist fails the *whole* request — which would take the
   * poll down with it. So this runs once at connect, and `listsReady` stops the
   * check repeating; `snapshot` copes in the meantime rather than assuming it
   * has run.
   */
  async function ensureTabs() {
    if (listsReady) {
      return;
    }

    const titles = await api.listSheetTitles();
    const missing = [SHOPPING_TAB, TASKS_TAB].filter((title) => !titles.includes(title));

    await api.addSheets(missing);

    if (missing.includes(SHOPPING_TAB)) {
      await api.updateValues(SHOPPING_HEADER_RANGE, [[...shoppingHeaders]]);
    }

    if (missing.includes(TASKS_TAB)) {
      await api.updateValues(TASKS_HEADER_RANGE, [[...taskHeaders]]);
    }

    listsReady = true;
  }

  async function readShopping() {
    await ensureTabs();
    return listRowsFromValues(await api.getValues(SHOPPING_RANGE), shoppingHeaders, shoppingFromRecord);
  }

  async function readTasks() {
    await ensureTabs();
    return listRowsFromValues(await api.getValues(TASKS_RANGE), taskHeaders, taskFromRecord);
  }

  /** The next free row, so a removed row's gap is filled rather than drifting. */
  function nextListRow(rows: Array<{ rowNumber: number }>) {
    return rows.reduce((highest, { rowNumber }) => Math.max(highest, rowNumber + 1), FIRST_LIST_ROW);
  }

  /**
   * Fills the Shopping tab from the shipped catalogue the first time it is
   * empty, and never again — a household that cleared its list meant to.
   */
  async function seedShopping(rows: Array<{ item: ShoppingItem }>) {
    if (rows.length > 0) {
      return [];
    }

    const timestamp = new Date().toISOString();
    const seeded: ShoppingItem[] = getCatalogSeed().map((row) => ({
      ...row,
      createdAt: timestamp,
      id: createId('shop'),
      syncState: 'synced' as const,
      updatedAt: timestamp
    }));

    await api.updateValues(
      `${SHOPPING_TAB}!A${FIRST_LIST_ROW}:K${FIRST_LIST_ROW + seeded.length - 1}`,
      seeded.map(shoppingToRow)
    );

    return seeded;
  }

  async function listShoppingItems() {
    const rows = await readShopping();
    const seeded = await seedShopping(rows);

    return rows.length > 0 ? rows.map((row) => row.item) : seeded;
  }

  async function saveShoppingItem(input: ShoppingItemInput) {
    const rows = await readShopping();
    const timestamp = new Date().toISOString();
    // An add whose name is already on file patches that row rather than making a
    // second one — one item, one row, is what makes the catalogue worth having.
    const match = input.id
      ? rows.find((row) => row.item.id === input.id)
      : input.name
        ? rows.find((row) => normalizeItemName(row.item.name) === normalizeItemName(input.name as string))
        : undefined;
    const item: ShoppingItem = {
      category: DEFAULT_SHOPPING_CATEGORY,
      isFood: false,
      name: '',
      status: 'need',
      ...match?.item,
      ...input,
      createdAt: match?.item.createdAt ?? timestamp,
      id: match?.item.id ?? createId('shop'),
      syncState: 'synced',
      updatedAt: timestamp
    };
    const rowNumber = match?.rowNumber ?? nextListRow(rows);

    await api.updateValues(`${SHOPPING_TAB}!A${rowNumber}:K${rowNumber}`, [shoppingToRow(item)]);
    return item;
  }

  /**
   * Blanks the row rather than deleting it. Row numbers stay put — a concurrent
   * write from the other parent's phone is addressed by row number, and pulling
   * a row out from under it would land their edit on somebody else's item.
   */
  async function removeShoppingItem(id: string) {
    const rows = await readShopping();
    const match = rows.find((row) => row.item.id === id);

    if (match) {
      await api.clearValues(`${SHOPPING_TAB}!A${match.rowNumber}:K${match.rowNumber}`);
    }
  }

  async function listTasks() {
    return (await readTasks()).map((row) => row.item);
  }

  async function saveTask(input: TaskItemInput) {
    const rows = await readTasks();
    const timestamp = new Date().toISOString();
    const match = input.id ? rows.find((row) => row.item.id === input.id) : undefined;
    const task: TaskItem = {
      status: 'open',
      title: '',
      ...match?.item,
      ...input,
      createdAt: match?.item.createdAt ?? timestamp,
      id: match?.item.id ?? createId('task'),
      syncState: 'synced',
      updatedAt: timestamp
    };
    const rowNumber = match?.rowNumber ?? nextListRow(rows);

    await api.updateValues(`${TASKS_TAB}!A${rowNumber}:J${rowNumber}`, [taskToRow(task)]);
    return task;
  }

  async function removeTask(id: string) {
    const rows = await readTasks();
    const match = rows.find((row) => row.item.id === id);

    if (match) {
      await api.clearValues(`${TASKS_TAB}!A${match.rowNumber}:J${match.rowNumber}`);
    }
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
    // Creates the list tabs on a sheet that predates them, so the next poll can
    // read all four ranges in one request.
    await ensureTabs();
    // Initialization is the one write-capable read path. Seed the household's
    // supplied catalogue here so the first batch snapshot can render it; plain
    // snapshots remain read-only.
    await listShoppingItems();
    return profile;
  }

  /**
   * Every child, plus the active one's events, in a single request — so a
   * background poll costs one round trip and can't read the two halves from
   * different versions of the sheet.
   */
  async function snapshot(query: EventQuery = {}): Promise<TrackerSnapshot> {
    // Four ranges once the list tabs exist, two before. A batchGet naming a
    // range on a missing tab fails outright, so a sheet that has not had
    // `ensureTabs` run yet reads the two it certainly has and comes back with
    // empty lists rather than taking the whole poll down.
    const ranges = listsReady
      ? [PROFILE_RANGE, EVENTS_RANGE, SHOPPING_RANGE, TASKS_RANGE]
      : [PROFILE_RANGE, EVENTS_RANGE];
    const [profileValues, eventValues, shoppingValues, taskValues] = await api.batchGetValues(ranges);
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
      profiles: profiles.length > 0 ? profiles : [profile],
      shopping: listRowsFromValues(shoppingValues ?? [], shoppingHeaders, shoppingFromRecord).map((row) => row.item),
      tasks: listRowsFromValues(taskValues ?? [], taskHeaders, taskFromRecord).map((row) => row.item)
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
   * Stamps `archivedAt` on the row and changes nothing else. The row stays, the
   * entries stay, and `restoreProfile` clears the stamp — archiving a person is
   * never a deletion, whatever the reason for it.
   */
  async function setArchived(id: string, archivedAt: string | undefined) {
    const { profiles, rowNumbers } = readProfiles(await api.getValues(PROFILE_RANGE));
    const rowNumber = rowNumbers.get(id);
    const existing = profiles.find((person) => person.id === id);

    if (!rowNumber || !existing) {
      return;
    }

    await api.updateValues(profileRowRange(rowNumber), [
      profileToRow({ ...existing, archivedAt, syncState: 'synced', updatedAt: new Date().toISOString() })
    ]);
  }

  async function archiveProfile(id: string) {
    await setArchived(id, new Date().toISOString());
  }

  async function restoreProfile(id: string) {
    await setArchived(id, undefined);
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
    // An export is the whole tracker, lists included. It goes through
    // `snapshot`, which already knows how to read a sheet whose list tabs have
    // not been created yet.
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
      shopping: listsReady ? await listShoppingItems() : [],
      tasks: listsReady ? await listTasks() : [],
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
      await ensureTabs();
      await api.clearValues(EVENTS_BODY_RANGE);
      await api.clearValues(SHOPPING_BODY_RANGE);
      await api.clearValues(TASKS_BODY_RANGE);
      if (incoming.length > 0) {
        await api.updateValues('Events!A2:AN', incoming.map((event) => eventToRow({ ...event, syncState: 'synced' })));
      }
      if (data.shopping?.length) {
        await api.updateValues('Shopping!A2:K', data.shopping.map(shoppingToRow));
      }
      if (data.tasks?.length) {
        await api.updateValues('Tasks!A2:J', data.tasks.map(taskToRow));
      }
      return;
    }

    const current = await listRows();
    const currentIds = new Set(current.map((row) => row.event.id));
    const newEvents = incoming.filter((event) => !currentIds.has(event.id));

    if (newEvents.length > 0) {
      await api.appendValues(EVENTS_APPEND_RANGE, newEvents.map((event) => eventToRow({ ...event, syncState: 'synced' })));
    }

    await importList(
      data.shopping ?? [],
      readShopping,
      shoppingToRow,
      SHOPPING_TAB,
      'K',
      (item) => normalizeItemName(item.name)
    );
    await importList(data.tasks ?? [], readTasks, taskToRow, TASKS_TAB, 'J');
  }

  /**
   * Adds the list rows this sheet has not got, in one write. Rows already here
   * win: the sheet is what the other parent has been editing, and an import is
   * a merge of what a device brought with it, not a replacement of theirs.
   */
  async function importList<T extends { id: string }>(
    incoming: T[],
    read: () => Promise<Array<{ item: T; rowNumber: number }>>,
    toRow: (item: T) => unknown[],
    tab: string,
    lastColumn: string,
    identity: (item: T) => string = (item) => item.id
  ) {
    if (incoming.length === 0) {
      return;
    }

    const rows = await read();
    const known = new Set(rows.map((row) => identity(row.item)));
    const missing = incoming.filter((item) => !known.has(identity(item)));

    if (missing.length === 0) {
      return;
    }

    const startRow = nextListRow(rows);
    await api.updateValues(
      `${tab}!A${startRow}:${lastColumn}${startRow + missing.length - 1}`,
      missing.map(toRow)
    );
  }

  async function clear() {
    await api.clearValues(EVENTS_BODY_RANGE);
  }

  return {
    addEvent,
    addProfile,
    archiveProfile,
    assignCaregivers,
    clear,
    close: () => {},
    deleteEvent,
    exportData,
    getProfile,
    importData,
    initialize,
    listEvents,
    listProfiles,
    listShoppingItems,
    listTasks,
    removeShoppingItem,
    removeTask,
    restoreProfile,
    saveProfile,
    saveShoppingItem,
    saveTask,
    snapshot,
    updateEvent
  };
}
