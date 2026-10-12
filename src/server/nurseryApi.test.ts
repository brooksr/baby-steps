// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createNurseryHandler, NURSERY_SCHEMAS, type NurserySheets } from './nurseryApi';

/** A spreadsheet as tab → rows, with A1 ranges good enough for what the upsert sends. */
function fakeSheets(initial: Record<string, unknown[][]> = {}) {
  const tabs = new Map<string, { columnCount: number; rows: unknown[][]; sheetId: number }>();
  Object.entries(initial).forEach(([title, rows], index) => tabs.set(title, { columnCount: 26, rows, sheetId: index + 1 }));
  const parse = (range: string) => {
    const match = range.match(/^'((?:[^']|'')+)'!(.*)$/);
    if (!match) throw new Error(`unexpected range ${range}`);
    const tab = tabs.get(match[1].replace(/''/g, "'"));
    if (!tab) throw new Error(`no tab ${match[1]}`);
    return { cells: match[2], tab };
  };
  const sheets: NurserySheets = {
    addSheets: vi.fn(async (titles: string[]) => titles.forEach((title) => tabs.set(title, { columnCount: 26, rows: [], sheetId: tabs.size + 1 }))),
    appendColumns: vi.fn(async (sheetId: number, length: number) => {
      const tab = [...tabs.values()].find((candidate) => candidate.sheetId === sheetId)!;
      tab.columnCount += length;
    }),
    appendValues: vi.fn(async (range: string, values: unknown[][]) => {
      const { tab } = parse(range);
      if (values.some((row) => row.length > tab.columnCount)) throw new Error('past the grid');
      tab.rows.push(...values);
    }),
    batchGetValues: vi.fn(async (ranges: string[]) => ranges.map((range) => {
      const { cells, tab } = parse(range);
      return cells === '1:1' ? tab.rows.slice(0, 1) : tab.rows.slice(1).map((row) => [row[0]]);
    })),
    batchUpdateValues: vi.fn(async (data: Array<{ range: string; values: unknown[][] }>) => data.forEach(({ range, values }) => {
      const { cells, tab } = parse(range);
      const row = Number(cells.match(/^A(\d+):/)![1]);
      if (values[0].length > tab.columnCount) throw new Error('past the grid');
      tab.rows[row - 1] = values[0];
    })),
    listSheetGrids: vi.fn(async () => [...tabs.entries()].map(([title, tab]) => ({ columnCount: tab.columnCount, sheetId: tab.sheetId, title })))
  };
  return { rows: (title: string) => tabs.get(title)?.rows, sheets, tabs };
}

const TOKEN = 'nursery-token-0123456789abcdef0123456789abcdef';
const interval = { data: { clippedWindows: 0, coveragePercent: 98.3, durationMs: 900000, endUtc: '2026-10-12T03:15:00Z', peakDbfs: -12, sessionId: 1, soundLevelDbfs: -40, sourceDeviceId: 'device-a', startUtc: '2026-10-12T03:00:00Z', validMs: 885000 }, key: 'device-a:1000:1:interval:1791846000000', kind: 'interval', schemaVersion: 2 };
const night = { data: { ambientNoiseMs: 0, capturedMs: 35000000, coughEpisodes: 0, coveragePercent: 97.2, cryEpisodes: 3, cryMs: 240000, expectedMs: 36000000, longestCryMs: 120000, nightOf: '2026-10-12', observedThroughUtc: '2026-10-13T05:00:00Z', peakDbfs: -8, sessions: 1, snoringEpisodes: 0, snoringMs: 0, soundLevelDbfs: -55, sourceDeviceId: 'device-a', speechEpisodes: 1, speechMs: 4000, status: 'in_progress', timezone: 'America/Los_Angeles', validMs: 35000000, windowEndUtc: '2026-10-13T19:00:00Z', windowStartUtc: '2026-10-12T19:00:00Z' }, key: 'device-a:night:2026-10-12', kind: 'night', schemaVersion: 2 };
const episode = { data: { durationMs: 120000, endUtc: '2026-10-12T03:04:00Z', episodeId: 7, label: 'baby_cry', maxScore: 0.8, sessionId: 1, source: 'model_experimental', sourceDeviceId: 'device-a', startUtc: '2026-10-12T03:02:00Z' }, key: 'device-a:1000:1:episode:7', kind: 'episode', schemaVersion: 2 };
const session = {
  data: { ...Object.fromEntries(NURSERY_SCHEMAS.session.columns.map((name) => [name, null])), movementState: 'not_measured', sessionId: 1, sleepState: 'unknown', sourceDeviceId: 'device-a', startUtc: '2026-10-12T03:00:00Z', status: 'recording' } as Record<string, unknown>,
  key: 'device-a:1000:1:session', kind: 'session', schemaVersion: 2
};

function setup(initial?: Record<string, unknown[][]>) {
  const sheet = fakeSheets(initial);
  const onError = vi.fn();
  const handle = createNurseryHandler({ apiToken: TOKEN, onError, sheets: sheet.sheets });
  const send = async (records: unknown[], { schemaVersion = 2, token = TOKEN as string | null } = {}) => {
    const response = await handle(new Request('http://pi/api/nursery', {
      body: JSON.stringify({ deviceId: 'device-a', records, schemaVersion }),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      method: 'POST'
    }));
    return { body: await response.json(), status: response.status };
  };
  return { ...sheet, handle, onError, send };
}

const clone = <T>(value: T): T => structuredClone(value);

describe('nursery API', () => {
  it('needs the bearer token and writes nothing without it', async () => {
    const { send, tabs } = setup();
    expect((await send([interval], { token: null })).status).toBe(401);
    expect((await send([interval], { token: 'wrong' })).status).toBe(401);
    expect(tabs.size).toBe(0);
  });

  it('creates the tab with a header and acknowledges exactly the keys it stored', async () => {
    const { rows, send } = setup();
    const result = await send([interval, night, episode, session]);
    expect(result).toEqual({ body: { acceptedKeys: [interval.key, night.key, episode.key, session.key], ok: true }, status: 200 });
    expect(rows('Nursery Sound Levels')).toEqual([
      ['recordKey', 'schemaVersion', ...NURSERY_SCHEMAS.interval.columns],
      [interval.key, 2, 'device-a', 1, '2026-10-12T03:00:00Z', '2026-10-12T03:15:00Z', 900000, 885000, 98.3, -40, -12, 0]
    ]);
    // 28 columns: the session tab is widened past the default 26-column grid.
    expect(rows('Nursery Sessions')![1]).toHaveLength(28);
    expect(rows('Nursery Sessions')![1][3]).toBe(1);
    expect(rows('Nursery Sessions')![1][5]).toBe('');
  });

  it('upserts by record key, so a retry or a newer summary never duplicates', async () => {
    const { rows, send } = setup();
    await send([interval, night]);
    await send([interval, night]);
    const finished = clone(night);
    finished.data.status = 'complete';
    finished.data.cryEpisodes = 4;
    const later = clone(interval);
    later.key = 'device-a:1000:1:interval:1791846900000';
    expect((await send([finished, later])).status).toBe(200);
    expect(rows('Nursery Nightly Summaries')).toHaveLength(2);
    expect(rows('Nursery Nightly Summaries')![1][7]).toBe('complete');
    expect(rows('Nursery Sound Levels')!.map((row) => row[0])).toEqual(['recordKey', interval.key, later.key]);
  });

  it('adopts a header-only tab but refuses one holding rows under another header', async () => {
    const adopted = setup({ 'Nursery Nightly Summaries': [['Night', 'Notes']] });
    expect((await adopted.send([night])).status).toBe(200);
    expect(adopted.rows('Nursery Nightly Summaries')![0][0]).toBe('recordKey');

    const kept = setup({ 'Nursery Nightly Summaries': [['Night', 'Notes'], ['Oct 12', 'mine']] });
    expect((await kept.send([night])).body.error).toBe('schema_mismatch');
    expect(kept.rows('Nursery Nightly Summaries')).toEqual([['Night', 'Notes'], ['Oct 12', 'mine']]);
  });

  it('refuses the whole batch on any bad record, naming why', async () => {
    const { send, tabs } = setup();
    const cases: Array<[unknown[], string, number?]> = [
      [[interval], 'unsupported_schema', 1],
      [[{ ...clone(interval), kind: 'minute' }], 'invalid_record'],
      [[{ ...clone(interval), data: { ...interval.data, pcm: [1, 2] } }], 'unexpected_field'],
      [[{ ...clone(interval), data: { ...interval.data, sourceDeviceId: 'someone-else' } }], 'device_mismatch'],
      [[interval, interval], 'invalid_key'],
      [[{ ...clone(session), data: { ...session.data, sleepState: 'asleep' } }], 'unsupported_sleep_state'],
      [[{ ...clone(episode), data: { ...episode.data, label: 'ambient_noise' } }], 'invalid_episode'],
      [[{ ...clone(night), data: { ...night.data, nightOf: 'tonight' } }], 'invalid_night'],
      [[{ ...clone(interval), data: { ...interval.data, durationMs: '900000' } }], 'expected_number'],
      [[{ ...clone(interval), data: { ...interval.data, validMs: -1 } }], 'negative_value'],
      [[{ ...clone(interval), data: { ...interval.data, coveragePercent: 101 } }], 'invalid_coverage'],
      [[{ ...clone(interval), data: { ...interval.data, peakDbfs: 3 } }], 'invalid_level'],
      [[{ ...clone(interval), data: { ...interval.data, startUtc: 'yesterday' } }], 'invalid_timestamp']
    ];
    for (const [records, error, schemaVersion] of cases) {
      expect(await send(records, { schemaVersion })).toEqual({ body: { error, ok: false }, status: 400 });
    }
    expect(tabs.size).toBe(0);
  });

  it('keeps a formula-looking string as text by writing RAW values', async () => {
    const { rows, send } = setup();
    const odd = clone(session);
    odd.data.error = '=IMPORTDATA("x")';
    await send([odd]);
    expect(rows('Nursery Sessions')![1][15]).toBe('=IMPORTDATA("x")');
  });

  it('reports a sheet failure as 502 so the phone keeps and retries the batch', async () => {
    const { onError, sheets, send } = setup();
    vi.mocked(sheets.listSheetGrids).mockRejectedValueOnce(new Error('quota'));
    expect(await send([interval])).toEqual({ body: { error: 'sheet_unavailable', ok: false }, status: 502 });
    expect(onError).toHaveBeenCalled();
    expect((await send([interval])).status).toBe(200);
  });

  it('serializes overlapping batches so the same new key is appended once', async () => {
    const { rows, send } = setup();
    await Promise.all([send([interval]), send([interval]), send([interval])]);
    expect(rows('Nursery Sound Levels')).toHaveLength(2);
  });
});
