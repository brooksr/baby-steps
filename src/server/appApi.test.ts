// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { BabyProfile, CareEvent, TrackerExport } from '../domain/types';
import { createAppHandler } from './appApi';

const ada: BabyProfile = {
  createdAt: '2026-08-01T00:00:00.000Z',
  id: 'ada-example',
  kind: 'child',
  name: 'Ada Example',
  syncState: 'synced',
  timezone: 'America/Los_Angeles',
  updatedAt: '2026-08-01T00:00:00.000Z'
};

const feed: CareEvent = {
  babyId: 'ada-example',
  createdAt: '2026-10-12T21:00:00.000Z',
  id: 'event_feed',
  method: 'nursing',
  side: 'left',
  startedAt: '2026-10-12T21:00:00.000Z',
  syncState: 'synced',
  type: 'feed',
  updatedAt: '2026-10-12T21:00:00.000Z'
};

function setup(events: CareEvent[] = [feed]) {
  const exported: TrackerExport = { events, exportedAt: '2026-10-12T21:40:00.000Z', profile: ada, profiles: [ada], shopping: [], tasks: [], version: 1 };
  const store = {
    addEvent: vi.fn(async (input: Record<string, unknown>) => ({ ...input, createdAt: 'now', syncState: 'synced', updatedAt: 'now' }) as unknown as CareEvent),
    addProfile: vi.fn(async (input: Record<string, unknown>) => ({ ...ada, ...input, id: 'new-person' })),
    archiveProfile: vi.fn(async () => undefined),
    deleteEvent: vi.fn(async () => undefined),
    exportData: vi.fn(async () => exported),
    initialize: vi.fn(async () => ada),
    listEvents: vi.fn(async () => events),
    readNurseryData: vi.fn(async () => ({ episodes: [], nights: [] })),
    removeShoppingItem: vi.fn(async () => undefined),
    removeTask: vi.fn(async () => undefined),
    restoreProfile: vi.fn(async () => undefined),
    saveProfile: vi.fn(async (patch: Partial<BabyProfile>) => ({ ...ada, ...patch })),
    saveShoppingItem: vi.fn(async (input: Record<string, unknown>) => input),
    saveTask: vi.fn(async (input: Record<string, unknown>) => input),
    updateEvent: vi.fn(async (event: CareEvent) => event)
  };
  const onError = vi.fn();
  const handle = createAppHandler({ apiToken: 'app-token', onError, store: store as never });
  return { handle, onError, store };
}

function request(method: string, path = '/api/events/app', body?: unknown, token: string | null = 'app-token') {
  return new Request(`http://pi${path}`, {
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    method
  });
}

describe('app API', () => {
  it('reads the whole tracker once the sheet is initialized', async () => {
    const { handle, store } = setup();
    const response = await handle(request('GET'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ events: [{ id: 'event_feed' }], ok: true, profiles: [{ id: 'ada-example' }] });
    // Twice in a row initializes once.
    await handle(request('GET'));
    expect(store.initialize).toHaveBeenCalledTimes(1);
  });

  it('refuses every route without its own token', async () => {
    const { handle, store } = setup();

    expect((await handle(request('GET', '/api/events/app', undefined, null))).status).toBe(401);
    expect((await handle(request('GET', '/api/events/app', undefined, 'events-token'))).status).toBe(401);
    expect((await handle(request('POST', '/api/events/app', { id: 'event_feed', op: 'deleteEvent' }, 'nope'))).status).toBe(401);
    expect(store.exportData).not.toHaveBeenCalled();
    expect(store.deleteEvent).not.toHaveBeenCalled();
  });

  it('reads the nursery tabs for the night report', async () => {
    const { handle } = setup();
    const response = await handle(request('GET', '/api/events/app/nursery'));

    expect(await response.json()).toEqual({ nursery: { episodes: [], nights: [] }, ok: true });
    expect((await handle(request('POST', '/api/events/app/nursery', {}))).status).toBe(405);
  });

  it('runs edits and deletes through the store', async () => {
    const { handle, store } = setup();
    const edited = { ...feed, side: 'right' };

    expect((await handle(request('POST', undefined, { event: edited, op: 'updateEvent' }))).status).toBe(200);
    expect(store.updateEvent).toHaveBeenCalledWith(edited);
    expect((await handle(request('POST', undefined, { id: 'event_feed', op: 'deleteEvent' }))).status).toBe(200);
    expect(store.deleteEvent).toHaveBeenCalledWith('event_feed');
    expect((await handle(request('POST', undefined, { op: 'saveTask', input: { status: 'open', title: 'Call the pediatrician' } }))).status).toBe(200);
    expect(store.saveTask).toHaveBeenCalledWith({ status: 'open', title: 'Call the pediatrician' });
  });

  it('does not write an entry twice when a retry finds it already there', async () => {
    const { handle, store } = setup();
    const response = await handle(request('POST', undefined, { input: { ...feed }, op: 'addEvent' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, result: { id: 'event_feed' } });
    expect(store.addEvent).not.toHaveBeenCalled();

    await handle(request('POST', undefined, { input: { ...feed, id: 'event_new' }, op: 'addEvent' }));
    expect(store.addEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'event_new', type: 'feed' }));
  });

  it('refuses what the sheet could not hold, before touching it', async () => {
    const { handle, store } = setup();
    const bad = async (body: unknown) => (await handle(request('POST', undefined, body))).status;

    expect(await bad('not json')).toBe(400);
    expect(await bad({ op: 'dropEverything' })).toBe(400);
    expect(await bad({ input: { startedAt: 'yesterday', type: 'feed' }, op: 'addEvent' })).toBe(400);
    expect(await bad({ input: { startedAt: feed.startedAt, type: 'party' }, op: 'addEvent' })).toBe(400);
    // A profile patch with no id would land on whoever is first.
    expect(await bad({ op: 'saveProfile', profile: { name: 'Ada' } })).toBe(400);
    expect(await bad({ input: { name: ' ' }, op: 'addProfile' })).toBe(400);
    expect(store.addEvent).not.toHaveBeenCalled();
    expect(store.saveProfile).not.toHaveBeenCalled();
  });

  it('reads a null as a cleared field, the way the web app clears one', async () => {
    const { handle, store } = setup();

    await handle(request('POST', undefined, { input: { completedAt: null, id: 'shop_1', status: 'need' }, op: 'saveShoppingItem' }));
    expect(store.saveShoppingItem).toHaveBeenCalledWith({ completedAt: undefined, id: 'shop_1', status: 'need' });
  });

  it('says an entry deleted elsewhere is gone, so the phone stops retrying', async () => {
    const { handle, store } = setup();
    store.updateEvent.mockRejectedValueOnce(new Error('Event event_feed was not found in the Google Sheet.'));

    expect((await handle(request('POST', undefined, { event: feed, op: 'updateEvent' }))).status).toBe(409);
  });

  it('reports the sheet being down as a retryable failure', async () => {
    const { handle, onError, store } = setup();
    store.exportData.mockRejectedValueOnce(new Error('quota'));

    expect((await handle(request('GET'))).status).toBe(502);
    expect(onError).toHaveBeenCalled();
  });
});
