/// <reference types="node" />
// BabySteps events API — `POST /api/events` for voice assistants and other
// integrations. Bundled into one dependency-free file (`npm run build:server`
// → dist-server/events-api.mjs) so the Pi runs it on a stock node image.
//
// Environment:
//   BABYSTEPS_SHEET_ID              the family's spreadsheet id
//   EVENTS_API_TOKEN                the bearer token callers must send
//   NURSERY_API_TOKEN               optional: the nursery sensor phone's own
//     bearer token for POST and GET /api/nursery; that route is off without it
//   GOOGLE_SERVICE_ACCOUNT_FILE     path to the service account's JSON key
//     (or GOOGLE_SERVICE_ACCOUNT_JSON, the key itself)
//   PORT                            default 8788

import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createGoogleSheetsBabyTrackerStore, GoogleSheetsApi } from '../storage/googleSheetsStore';
import { createEventsHandler } from './eventsApi';
import { createNurseryHandler, createNurseryStatusReader, MAX_NURSERY_BODY_BYTES, NURSERY_PATH } from './nurseryApi';
import { createServiceAccountTokenSource, parseServiceAccountKey } from './serviceAccount';

const MAX_BODY_BYTES = 8192;

function main() {
  const sheetId = process.env.BABYSTEPS_SHEET_ID?.trim();
  const apiToken = process.env.EVENTS_API_TOKEN?.trim();
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim();
  const keyText = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || (keyFile ? readFileSync(keyFile, 'utf8') : '');
  const port = Number(process.env.PORT) || 8788;

  if (!sheetId || !apiToken || !keyText) {
    console.error('events-api: set BABYSTEPS_SHEET_ID, EVENTS_API_TOKEN and GOOGLE_SERVICE_ACCOUNT_FILE.');
    process.exit(1);
  }

  const key = parseServiceAccountKey(keyText);
  const nurseryToken = process.env.NURSERY_API_TOKEN?.trim();
  const sheets = new GoogleSheetsApi(createServiceAccountTokenSource(key), sheetId);
  const store = createGoogleSheetsBabyTrackerStore(sheets);
  const onError = (error: unknown) => console.error('events-api:', error instanceof Error ? error.message : error);
  const events = createEventsHandler({ apiToken, onError, store });
  // A separate token: the nursery phone can write only its own four tabs, and
  // read back just the last feed, change and cry for its lock screen.
  const nursery = nurseryToken ? createNurseryHandler({ apiToken: nurseryToken, onError, readStatus: createNurseryStatusReader(store), sheets }) : null;

  createServer((request, response) => {
    const isNursery = new URL(request.url || '/', 'http://events-api').pathname.replace(/\/+$/, '') === NURSERY_PATH;
    const handle = isNursery && nursery ? nursery : events;
    serve(handle, isNursery ? MAX_NURSERY_BODY_BYTES : MAX_BODY_BYTES, request, response).catch((error) => {
      console.error('events-api:', error);

      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'internal' }));
      }
    });
  }).listen(port, () => {
    console.log(`events-api: listening on ${port} as ${key.client_email}${nursery ? ' · nursery on' : ''}`);
  });
}

async function serve(handle: (request: Request) => Promise<Response>, maxBodyBytes: number, request: IncomingMessage, response: ServerResponse) {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    size += (chunk as Buffer).length;

    // Keep draining so the 413 reaches the caller instead of a reset socket.
    if (size <= maxBodyBytes) {
      chunks.push(chunk as Buffer);
    }
  }

  if (size > maxBodyBytes) {
    response.writeHead(413, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'too_large' }));
    return;
  }

  const method = request.method || 'GET';
  const result = await handle(
    new Request(new URL(request.url || '/', 'http://events-api'), {
      body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
      headers: Object.entries(request.headers).flatMap(([name, value]): Array<[string, string]> => (value === undefined ? [] : [[name, String(value)]])),
      method
    })
  );

  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(Buffer.from(await result.arrayBuffer()));
}

main();
