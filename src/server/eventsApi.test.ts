// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { BabyProfile, CareEvent, CreateCareEventInput } from '../domain/types';
import { createEventsHandler } from './eventsApi';

const NOW = new Date('2026-10-12T21:40:00.000Z');
const ada: BabyProfile = {
  createdAt: '2026-08-01T00:00:00.000Z',
  id: 'ada-example',
  kind: 'child',
  name: 'Ada Example',
  syncState: 'synced',
  timezone: 'America/Los_Angeles',
  updatedAt: '2026-08-01T00:00:00.000Z'
};

function setup(profiles: BabyProfile[] = [ada]) {
  const store = {
    addEvent: vi.fn(async (input: CreateCareEventInput) => ({ ...input, createdAt: NOW.toISOString(), id: 'event_1', syncState: 'synced', updatedAt: NOW.toISOString() }) as CareEvent),
    listProfiles: vi.fn(async () => profiles)
  };
  const onError = vi.fn();
  const handle = createEventsHandler({ apiToken: 'tok', now: () => NOW, onError, store });
  return { handle, onError, store };
}

function post(body: unknown, token: string | null = 'tok', path = '/api/events') {
  return new Request(`http://pi${path}`, {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    method: 'POST'
  });
}

describe('events API', () => {
  it('logs a feed through the store and says what it logged', async () => {
    const { handle, store } = setup();
    const response = await handle(post({ amount: 4, source: 'voice', timestamp: '2026-10-12T14:32:00-07:00', type: 'feed', unit: 'oz' }));

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(store.addEvent).toHaveBeenCalledWith({
      amountOz: 4,
      babyId: 'ada-example',
      method: 'bottle',
      startedAt: '2026-10-12T21:32:00.000Z',
      type: 'feed'
    });
    expect(await response.json()).toMatchObject({ event: { id: 'event_1', type: 'feed' }, message: 'Logged a 4 oz bottle for Ada at 2:32 PM.', ok: true });
  });

  it('refuses a caller without the token before reading anything', async () => {
    const { handle, store } = setup();

    expect((await handle(post({ diaperType: 'wet', type: 'diaper' }, null))).status).toBe(401);
    expect((await handle(post({ diaperType: 'wet', type: 'diaper' }, 'nope'))).status).toBe(401);
    expect((await handle(post({ diaperType: 'wet', type: 'diaper' }, ''))).status).toBe(401);
    expect(store.listProfiles).not.toHaveBeenCalled();
    expect(store.addEvent).not.toHaveBeenCalled();
  });

  it('explains a bad request and writes nothing', async () => {
    const { handle, store } = setup();
    const invalid = await handle(post({ amount: 4, type: 'feed' }));

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'invalid_event', errors: ['unit is required with an amount (oz or ml).'] });
    expect((await handle(post('not json'))).status).toBe(400);
    expect((await handle(post({ notes: 'x'.repeat(9000), type: 'diaper' }))).status).toBe(413);
    expect(store.addEvent).not.toHaveBeenCalled();
  });

  it('asks which child rather than guessing between two', async () => {
    const { handle, store } = setup([ada, { ...ada, id: 'ben-example', name: 'Ben' }]);
    const response = await handle(post({ diaperType: 'wet', type: 'diaper' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'unknown_child', errors: ['Name the child: Ada, Ben.'] });
    expect((await handle(post({ child: 'Ben', diaperType: 'wet', type: 'diaper' }))).status).toBe(201);
    expect(store.addEvent).toHaveBeenCalledWith(expect.objectContaining({ babyId: 'ben-example', kind: 'wet' }));
  });

  it('reports a sheet failure as one, not as saved', async () => {
    const { handle, onError, store } = setup();
    store.addEvent.mockRejectedValueOnce(new Error('Google Sheets request failed (403)'));
    const response = await handle(post({ durationMinutes: 45, type: 'sleep' }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'sheet_unavailable' });
    expect(onError).toHaveBeenCalled();
  });

  it('answers health without a token, and nothing else', async () => {
    const { handle } = setup();
    const health = await handle(new Request('http://pi/api/events/health'));

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, types: ['diaper', 'feed', 'sleep'] });
    expect((await handle(new Request('http://pi/api/events'))).status).toBe(405);
    expect((await handle(post({}, 'tok', '/api/other'))).status).toBe(404);
  });

  it('will not start without a token to check', () => {
    expect(() => createEventsHandler({ apiToken: '', store: setup().store })).toThrow();
  });
});
