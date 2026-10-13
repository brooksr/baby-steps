import { NURSERY_SCHEMAS } from '../domain/nurserySensor';
import { isAuthorized } from './eventsApi';

export { NURSERY_SCHEMAS };

/**
 * `POST /api/nursery` — numeric summaries from the nursery sensor phone
 * (`oneplus` project, `sync/DeliveryCoordinator.kt`), upserted into four
 * dedicated tabs on the family sheet. It never touches Events: these are
 * experimental sound measurements, not care records. Suggestions built from
 * them (a likely cry, a quiet window) belong in the app, labelled as such.
 *
 * The phone queues records durably and retries, so every write is an upsert
 * by `recordKey`: a retry after a lost reply updates rows rather than adding
 * them. The reply must list exactly the keys it stored; the phone only drops
 * what is acknowledged.
 */

export const NURSERY_PATH = '/api/nursery';
export const NURSERY_SCHEMA_VERSION = 2;
export const MAX_NURSERY_BODY_BYTES = 180_000;

type Kind = keyof typeof NURSERY_SCHEMAS;
type Cell = string | number | null;
export interface NurseryRecord { data: Record<string, Cell>; key: string; kind: Kind }

const TIMESTAMPS = ['startUtc', 'endUtc', 'windowStartUtc', 'windowEndUtc', 'observedThroughUtc'];
const LEVELS = ['soundLevelDbfs', 'peakDbfs'];
const NUMERIC = ['sessionId', 'episodeId', 'durationMs', 'capturedMs', 'validMs', 'silencedMs', 'coveragePercent', ...LEVELS, 'clippedWindows', 'maxScore', 'elapsedMs', 'predictions', 'droppedWindows', 'meanInferenceMs', 'maxInferenceMs', 'expectedMs', 'sessions', 'cryEpisodes', 'cryMs', 'longestCryMs', 'speechEpisodes', 'speechMs', 'snoringEpisodes', 'snoringMs', 'coughEpisodes', 'ambientNoiseMs'];
const EPISODE_LABELS = ['baby_cry', 'speech', 'snoring', 'cough'];

/** The whole batch or nothing: one bad record refuses the request, with the reason. */
export function parseNurseryBatch(body: unknown): { ok: true; records: NurseryRecord[] } | { error: string; ok: false } {
  const fail = (error: string) => ({ error, ok: false as const });

  if (!isObject(body) || body.schemaVersion !== NURSERY_SCHEMA_VERSION) return fail('unsupported_schema');
  const { deviceId, records } = body;
  if (typeof deviceId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(deviceId)) return fail('invalid_device');
  if (!Array.isArray(records) || records.length < 1 || records.length > 100) return fail('invalid_batch');

  const keys = new Set<string>();
  const parsed: NurseryRecord[] = [];

  for (const record of records) {
    if (!isObject(record) || !(typeof record.kind === 'string' && record.kind in NURSERY_SCHEMAS)) return fail('invalid_record');
    const kind = record.kind as Kind;
    const { data, key } = record;
    const columns: readonly string[] = NURSERY_SCHEMAS[kind].columns;
    if (record.schemaVersion !== NURSERY_SCHEMA_VERSION || !isObject(data)) return fail('invalid_record');
    if (typeof key !== 'string' || !/^[a-zA-Z0-9:._-]{1,250}$/.test(key) || keys.has(key)) return fail('invalid_key');
    if (data.sourceDeviceId !== deviceId || !key.startsWith(`${deviceId}:`)) return fail('device_mismatch');
    if (Object.keys(data).some((name) => !columns.includes(name))) return fail('unexpected_field');

    for (const name of columns) {
      const value = data[name];
      if (!(name in data)) return fail('missing_field');
      if (value !== null && typeof value !== 'string' && typeof value !== 'number') return fail('invalid_value');
      if (typeof value === 'number' && !Number.isFinite(value)) return fail('invalid_value');
      if (typeof value === 'string' && value.length > 256) return fail('invalid_value');
      if (value === null) continue;
      if (TIMESTAMPS.includes(name) && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) return fail('invalid_timestamp');
      if (NUMERIC.includes(name) && typeof value !== 'number') return fail('expected_number');
      if (NUMERIC.includes(name) && !LEVELS.includes(name) && (value as number) < 0) return fail('negative_value');
      if (LEVELS.includes(name) && ((value as number) < -120 || (value as number) > 0)) return fail('invalid_level');
    }

    const cells = data as Record<string, Cell>;
    const at = (name: string) => cells[name];
    if ('coveragePercent' in cells && at('coveragePercent') !== null && ((at('coveragePercent') as number) > 100)) return fail('invalid_coverage');
    if ('sessionId' in cells && !(Number.isSafeInteger(at('sessionId')) && (at('sessionId') as number) >= 1)) return fail('invalid_session');
    // The sensor measures sound. It may not claim sleep or movement.
    if ('sleepState' in cells && at('sleepState') !== 'unknown') return fail('unsupported_sleep_state');
    if ('movementState' in cells && at('movementState') !== 'not_measured') return fail('unsupported_movement_state');
    if (kind === 'episode' && (!EPISODE_LABELS.includes(String(at('label'))) || at('source') !== 'model_experimental' || (at('maxScore') as number) > 1)) return fail('invalid_episode');
    if (kind === 'interval' && (at('durationMs') as number) > 15 * 60_000) return fail('invalid_interval');
    if (kind === 'night' && (!/^\d{4}-\d{2}-\d{2}$/.test(String(at('nightOf'))) || !['in_progress', 'complete'].includes(String(at('status'))) || (at('expectedMs') as number) > 25 * 3_600_000)) return fail('invalid_night');

    keys.add(key);
    parsed.push({ data: cells, key, kind });
  }

  return { ok: true, records: parsed };
}

/** The slice of `GoogleSheetsApi` the upsert needs — faked in tests. */
export interface NurserySheets {
  addSheets(titles: string[]): Promise<void>;
  appendColumns(sheetId: number, length: number): Promise<void>;
  appendValues(range: string, values: unknown[][]): Promise<void>;
  batchGetValues(ranges: string[]): Promise<unknown[][][]>;
  batchUpdateValues(data: Array<{ range: string; values: unknown[][] }>): Promise<void>;
  listSheetGrids(): Promise<Array<{ columnCount: number; sheetId: number; title: string }>>;
}

export class NurserySchemaMismatchError extends Error {}

const quote = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

function columnLetter(index: number) {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

/**
 * Upserts by recordKey (column A). Callers serialize: two overlapping batches
 * could both decide a key is new. Values are written RAW, so a string that
 * looks like a formula stays text.
 */
export async function upsertNurseryRecords(sheets: NurserySheets, records: NurseryRecord[]) {
  const kinds = [...new Set(records.map((record) => record.kind))];
  let grids = await sheets.listSheetGrids();
  const missing = kinds.map((kind) => NURSERY_SCHEMAS[kind].tab).filter((tab) => !grids.some((grid) => grid.title === tab));

  if (missing.length > 0) {
    await sheets.addSheets(missing);
    grids = await sheets.listSheetGrids();
  }

  const ranges = kinds.flatMap((kind) => [`${quote(NURSERY_SCHEMAS[kind].tab)}!1:1`, `${quote(NURSERY_SCHEMAS[kind].tab)}!A2:A`]);
  const values = await sheets.batchGetValues(ranges);
  const updates: Array<{ range: string; values: unknown[][] }> = [];
  const appends = new Map<Kind, unknown[][]>();

  for (const [index, kind] of kinds.entries()) {
    const { columns, tab } = NURSERY_SCHEMAS[kind];
    const headers = ['recordKey', 'schemaVersion', ...columns];
    const grid = grids.find((candidate) => candidate.title === tab);
    const header = (values[index * 2][0] ?? []).map(String);
    const rowKeys = values[index * 2 + 1].map((row) => String(row[0] ?? ''));

    if (grid && grid.columnCount < headers.length) await sheets.appendColumns(grid.sheetId, headers.length - grid.columnCount);

    // A new or header-only tab (perhaps made by hand) takes our header; a tab
    // holding rows under a different header is refused, never overwritten.
    if (header.join('\u0000') !== headers.join('\u0000')) {
      if (rowKeys.some(Boolean)) throw new NurserySchemaMismatchError(`${tab} has a different header`);
      updates.push({ range: `${quote(tab)}!A1:${columnLetter(headers.length - 1)}1`, values: [headers] });
    }

    const rowOf = new Map(rowKeys.map((key, offset) => [key, offset + 2]));
    const fresh: unknown[][] = [];

    for (const record of records.filter((candidate) => candidate.kind === kind)) {
      const row = [record.key, NURSERY_SCHEMA_VERSION, ...columns.map((name) => record.data[name] ?? '')];
      const existing = rowOf.get(record.key);
      if (existing) updates.push({ range: `${quote(tab)}!A${existing}:${columnLetter(row.length - 1)}${existing}`, values: [row] });
      else fresh.push(row);
    }

    if (fresh.length > 0) appends.set(kind, fresh);
  }

  if (updates.length > 0) await sheets.batchUpdateValues(updates);
  for (const [kind, rows] of appends) await sheets.appendValues(`${quote(NURSERY_SCHEMAS[kind].tab)}!A1`, rows);
}

export interface NurseryApiOptions {
  apiToken: string;
  onError?: (error: unknown) => void;
  sheets: NurserySheets;
}

export function createNurseryHandler({ apiToken, onError = () => {}, sheets }: NurseryApiOptions) {
  if (!apiToken) throw new Error('The nursery API needs an API token.');
  let queue: Promise<unknown> = Promise.resolve();

  return async function handle(request: Request): Promise<Response> {
    if (new URL(request.url).pathname.replace(/\/+$/, '') !== NURSERY_PATH) return json(404, { error: 'not_found', ok: false });
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed', ok: false });
    if (!(await isAuthorized(request.headers.get('authorization'), apiToken))) return json(401, { error: 'unauthorized', ok: false });

    let body: unknown;
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > MAX_NURSERY_BODY_BYTES) return json(413, { error: 'too_large', ok: false });
      body = JSON.parse(text);
    } catch {
      return json(400, { error: 'invalid_json', ok: false });
    }

    const parsed = parseNurseryBatch(body);
    if (!parsed.ok) return json(400, { error: parsed.error, ok: false });

    // One writer at a time: overlapping batches could both append the same key.
    const write = queue.then(() => upsertNurseryRecords(sheets, parsed.records));
    queue = write.catch(() => {});

    try {
      await write;
      return json(200, { acceptedKeys: parsed.records.map((record) => record.key), ok: true });
    } catch (error) {
      if (error instanceof NurserySchemaMismatchError) return json(409, { error: 'schema_mismatch', message: error.message, ok: false });
      // The phone keeps the batch and retries; it must not drop what did not land.
      onError(error);
      return json(502, { error: 'sheet_unavailable', ok: false });
    }
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
    status
  });
}
