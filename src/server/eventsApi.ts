import { describeLoggedEvent, parseEventRequest, resolveChild, SUPPORTED_EVENT_TYPES } from '../domain/eventRequest';
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
 * **Every write needs the shared API token.** The Pi is reachable from the
 * internet through the Funnel, so the token — not the network — is what keeps
 * strangers out of the log.
 */

export const EVENTS_PREFIX = '/api/events';
const MAX_BODY_BYTES = 8192;

export interface EventsApiOptions {
  /** The bearer token callers must present. */
  apiToken: string;
  now?: () => Date;
  onError?: (error: unknown) => void;
  store: Pick<BabyTrackerStore, 'addEvent' | 'listProfiles'>;
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
async function isAuthorized(header: string | null, apiToken: string) {
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
