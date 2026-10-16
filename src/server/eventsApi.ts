import { describeLoggedEvent, parseEventRequest, resolveChild, SUPPORTED_EVENT_TYPES } from '../domain/eventRequest';
import { getFirstName } from '../domain/family';
import type { CareEvent, DiaperEvent, FeedEvent, SleepEvent } from '../domain/types';
import type { BabyTrackerStore } from '../storage/store';

/**
 * `POST /api/events` — log one entry from a voice assistant, Home Assistant or
 * any other integration, without it ever touching the sheet.
 *
 * Written against the Fetch API's `Request`/`Response` so it runs (and is
 * tested) without a Node server; `main.ts` adapts it to `node:http`. Writes go
 * through the same `BabyTrackerStore` the app uses, so a row logged here is
 * indistinguishable from one logged on a phone, and the app picks it up on its
 * next poll.
 *
 * `GET /api/events/status` is the one read: the last feed, change and sleep,
 * for a watch or a glance. Same token, same child rule as a write.
 *
 * **Every write needs the shared API token.** The Pi is reachable from the
 * internet through the Funnel, so the token — not the network — is what keeps
 * strangers out of the log.
 */

export const EVENTS_PREFIX = '/api/events';
export const STATUS_PATH = `${EVENTS_PREFIX}/status`;
const MAX_BODY_BYTES = 8192;

export interface EventsApiOptions {
  /** The bearer token callers must present. */
  apiToken: string;
  now?: () => Date;
  onError?: (error: unknown) => void;
  store: Pick<BabyTrackerStore, 'addEvent' | 'listEvents' | 'listProfiles'>;
}

/** What a watch shows. Times are ISO; each is null when nothing is on file. */
export interface CareStatus {
  child: string;
  lastFeed: { at: string; endedAt: string | null; method: FeedEvent['method']; amountOz: number | null; durationMinutes: number | null; side: FeedEvent['side'] | null } | null;
  lastDiaper: { at: string; kind: DiaperEvent['kind'] } | null;
  /** The latest sleep; `endedAt` null is one still running. */
  lastSleep: { at: string; endedAt: string | null } | null;
}

export function getCareStatus(child: string, events: CareEvent[]): CareStatus {
  const sorted = [...events].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const feed = sorted.find((event): event is FeedEvent => event.type === 'feed');
  const diaper = sorted.find((event): event is DiaperEvent => event.type === 'diaper');
  const sleep = sorted.find((event): event is SleepEvent => event.type === 'sleep');

  return {
    child,
    lastDiaper: diaper ? { at: diaper.startedAt, kind: diaper.kind } : null,
    lastFeed: feed
      ? { amountOz: feed.amountOz ?? null, at: feed.startedAt, durationMinutes: feed.durationMinutes ?? null, endedAt: feed.endedAt ?? null, method: feed.method, side: feed.side ?? null }
      : null,
    lastSleep: sleep ? { at: sleep.startedAt, endedAt: sleep.endedAt ?? null } : null
  };
}

export function createEventsHandler({ apiToken, now = () => new Date(), onError = () => {}, store }: EventsApiOptions) {
  if (!apiToken) {
    throw new Error('The events API needs an API token.');
  }

  return async function handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const path = pathname.replace(/\/+$/, '');

    if (path === `${EVENTS_PREFIX}/health` && request.method === 'GET') {
      return json(200, { ok: true, types: SUPPORTED_EVENT_TYPES });
    }

    if (path === STATUS_PATH) {
      if (request.method !== 'GET') {
        return json(405, { error: 'method_not_allowed' });
      }

      if (!(await isAuthorized(request.headers.get('authorization'), apiToken))) {
        return json(401, { error: 'unauthorized' });
      }

      try {
        const child = resolveChild(await store.listProfiles(), new URL(request.url).searchParams.get('child') ?? undefined);

        if (!child.ok) {
          return json(400, { error: 'unknown_child', errors: child.errors });
        }

        const events = await store.listEvents({ babyId: child.value.id });
        return json(200, { ...getCareStatus(getFirstName(child.value), events), ok: true });
      } catch (error) {
        onError(error);
        return json(502, { error: 'sheet_unavailable' });
      }
    }

    if (path !== EVENTS_PREFIX) {
      return json(404, { error: 'not_found' });
    }

    if (request.method !== 'POST') {
      return json(405, { error: 'method_not_allowed' });
    }

    if (!(await isAuthorized(request.headers.get('authorization'), apiToken))) {
      return json(401, { error: 'unauthorized' });
    }

    let body: unknown;

    try {
      const text = await request.text();

      if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
        return json(413, { error: 'too_large' });
      }

      body = JSON.parse(text);
    } catch {
      return json(400, { error: 'invalid_json', errors: ['The request body must be JSON.'] });
    }

    const at = now();
    const parsed = parseEventRequest(body, at);

    if (!parsed.ok) {
      return json(400, { error: 'invalid_event', errors: parsed.errors });
    }

    try {
      const child = resolveChild(await store.listProfiles(), (body as Record<string, unknown>).child);

      if (!child.ok) {
        return json(400, { error: 'unknown_child', errors: child.errors });
      }

      const event = await store.addEvent({ ...parsed.value, babyId: child.value.id });
      return json(201, { event, message: describeLoggedEvent(parsed.value, child.value), ok: true });
    } catch (error) {
      // The sheet is down or refused us — the caller should say so and retry,
      // not believe the entry was saved.
      onError(error);
      return json(502, { error: 'sheet_unavailable' });
    }
  };
}

/** Compared as digests so the check takes the same time however much of the token matched. */
export async function isAuthorized(header: string | null, apiToken: string) {
  const presented = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
  const [left, right] = await Promise.all([digest(presented), digest(apiToken)]);
  let difference = 0;

  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }

  return presented.length > 0 && difference === 0;
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
    status
  });
}
