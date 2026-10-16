import { careEventLabels, type CareEvent, type CareEventType, type CreateCareEventInput } from '../domain/types';
import type { BabyTrackerStore } from '../storage/store';
import { isAuthorized } from './eventsApi';

/**
 * `/api/events/app` — the whole tracker for the native Android app, which has
 * no Google sign-in of its own and reads and writes the family sheet through the
 * Pi instead.
 *
 * - `GET /api/events/app` is the export: every profile, every entry, and both
 *   household lists, in the shape the web app's store hands its own screens.
 * - `GET /api/events/app/nursery` is the nursery sensor's nights and episodes,
 *   for the Night & Day report. Null when the sheet has no sensor tabs.
 * - `POST /api/events/app` runs one store operation (`{ op, ... }`), the same
 *   ones the web app calls, so an edit made on the phone is a row the web app
 *   cannot tell from its own.
 *
 * **A token of its own** (`APP_API_TOKEN`). The events token only adds entries;
 * this one edits and deletes them, so it is not handed to every voice assistant
 * that can log a feed. Under `/api/events` so nginx's existing prefix proxies it.
 */

export const APP_PATH = '/api/events/app';
export const APP_NURSERY_PATH = `${APP_PATH}/nursery`;
/** A profile carries the whole Key Info card; an entry is a few hundred bytes. */
export const MAX_APP_BODY_BYTES = 65_536;

type AppStore = Pick<
  BabyTrackerStore,
  | 'addEvent'
  | 'addProfile'
  | 'archiveProfile'
  | 'deleteEvent'
  | 'exportData'
  | 'initialize'
  | 'listEvents'
  | 'readNurseryData'
  | 'removeShoppingItem'
  | 'removeTask'
  | 'restoreProfile'
  | 'saveProfile'
  | 'saveShoppingItem'
  | 'saveTask'
  | 'updateEvent'
>;

export interface AppApiOptions {
  apiToken: string;
  onError?: (error: unknown) => void;
  store: AppStore;
}

const EVENT_TYPES = new Set(Object.keys(careEventLabels) as CareEventType[]);

class BadRequest extends Error {}

/**
 * JSON has no `undefined`, so the phone sends `null` for a field it cleared — a
 * bought item put back on the list, a due date taken off a task. The store
 * spreads input over the stored row, where `undefined` is what clears a field.
 */
function dropNulls<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(dropNulls) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, entry === null ? undefined : dropNulls(entry)])) as T;
  }

  return value;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequest(`${name} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new BadRequest('id must be a non-empty string.');
  }

  return value;
}

/** Only what the sheet could not hold sensibly is refused; the store owns the rest of the shape. */
function event(value: unknown, name: string): Record<string, unknown> {
  const body = record(value, name);

  if (!EVENT_TYPES.has(body.type as CareEventType)) {
    throw new BadRequest(`${name}.type is not an entry type.`);
  }

  if (typeof body.startedAt !== 'string' || !Number.isFinite(Date.parse(body.startedAt))) {
    throw new BadRequest(`${name}.startedAt must be a date.`);
  }

  if (body.endedAt != null && (typeof body.endedAt !== 'string' || !Number.isFinite(Date.parse(body.endedAt)))) {
    throw new BadRequest(`${name}.endedAt must be a date.`);
  }

  return body;
}

/** One store call per op, named as the store names it. */
async function run(store: AppStore, body: Record<string, unknown>): Promise<unknown> {
  switch (body.op) {
    case 'addEvent': {
      const input = event(body.input, 'input');

      // The phone names its own entries, so a retry after a reply that never
      // arrived finds the row it already wrote instead of writing it twice.
      if (input.id != null) {
        const existing = (await store.listEvents({ babyId: typeof input.babyId === 'string' ? input.babyId : undefined })).find(
          (row) => row.id === id(input.id)
        );

        if (existing) {
          return existing;
        }
      }

      return store.addEvent(input as unknown as CreateCareEventInput);
    }
    case 'updateEvent': {
      const edited = event(body.event, 'event');
      id(edited.id);
      return store.updateEvent(edited as unknown as CareEvent);
    }
    case 'deleteEvent':
      return store.deleteEvent(id(body.id));
    case 'addProfile': {
      const input = record(body.input, 'input');

      if (typeof input.name !== 'string' || !input.name.trim()) {
        throw new BadRequest('input.name is required.');
      }

      return store.addProfile(input as unknown as Parameters<AppStore['addProfile']>[0]);
    }
    case 'saveProfile': {
      const patch = record(body.profile, 'profile');
      // Without an id the store patches the first child — the wrong person on a
      // family of two — so a patch has to name who it is about.
      id(patch.id);
      return store.saveProfile(patch);
    }
    case 'archiveProfile':
      return store.archiveProfile(id(body.id));
    case 'restoreProfile':
      return store.restoreProfile(id(body.id));
    case 'saveShoppingItem':
      return store.saveShoppingItem(record(body.input, 'input'));
    case 'removeShoppingItem':
      return store.removeShoppingItem(id(body.id));
    case 'saveTask':
      return store.saveTask(record(body.input, 'input'));
    case 'removeTask':
      return store.removeTask(id(body.id));
    default:
      throw new BadRequest('op is not a store operation.');
  }
}

export function createAppHandler({ apiToken, onError = () => {}, store }: AppApiOptions) {
  if (!apiToken) {
    throw new Error('The app API needs an API token.');
  }

  // The tabs the lists live on are checked once, the way the web app does at
  // connect. Retried on the next request if the sheet was unreachable.
  let ready: Promise<unknown> | null = null;
  const initialize = () => {
    ready ??= store.initialize().catch((error) => {
      ready = null;
      throw error;
    });
    return ready;
  };

  return async function handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname.replace(/\/+$/, '');

    if (path !== APP_PATH && path !== APP_NURSERY_PATH) {
      return json(404, { error: 'not_found' });
    }

    const allowed = path === APP_PATH ? ['GET', 'POST'] : ['GET'];

    if (!allowed.includes(request.method)) {
      return json(405, { error: 'method_not_allowed' });
    }

    if (!(await isAuthorized(request.headers.get('authorization'), apiToken))) {
      return json(401, { error: 'unauthorized' });
    }

    if (request.method === 'GET') {
      try {
        await initialize();
        return path === APP_NURSERY_PATH
          ? json(200, { nursery: (await store.readNurseryData?.()) ?? null, ok: true })
          : json(200, { ...(await store.exportData()), ok: true });
      } catch (error) {
        onError(error);
        return json(502, { error: 'sheet_unavailable' });
      }
    }

    let body: Record<string, unknown>;

    try {
      const text = await request.text();

      if (new TextEncoder().encode(text).length > MAX_APP_BODY_BYTES) {
        return json(413, { error: 'too_large' });
      }

      body = dropNulls(record(JSON.parse(text), 'The request body'));
    } catch {
      return json(400, { error: 'invalid_json', errors: ['The request body must be a JSON object.'] });
    }

    try {
      await initialize();
      const result = await run(store, body);
      return json(200, { ok: true, result: result ?? null });
    } catch (error) {
      if (error instanceof BadRequest) {
        return json(400, { error: 'invalid_request', errors: [error.message] });
      }

      // Edited on a phone, deleted on another device meanwhile: retrying will
      // never find it, so say so rather than have the phone try forever.
      if (error instanceof Error && /was not found/i.test(error.message)) {
        return json(409, { error: 'gone', errors: [error.message] });
      }

      // The sheet is down or refused us: the phone keeps the change and retries.
      onError(error);
      return json(502, { error: 'sheet_unavailable' });
    }
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
    status
  });
}
