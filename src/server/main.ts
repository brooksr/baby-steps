/// <reference types="node" />
// BabySteps events API — `POST /api/events` for voice assistants and other
// integrations. Bundled into one dependency-free file (`npm run build:server`
// → dist-server/events-api.mjs) so the Pi runs it on a stock node image.
//
// Environment:
//   BABYSTEPS_SHEET_ID              the family's spreadsheet id
//   EVENTS_API_TOKEN                the bearer token callers must send
//   GOOGLE_SERVICE_ACCOUNT_FILE     path to the service account's JSON key
//     (or GOOGLE_SERVICE_ACCOUNT_JSON, the key itself)
//   PORT                            default 8788

import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createGoogleSheetsBabyTrackerStore, GoogleSheetsApi } from '../storage/googleSheetsStore';
import { createEventsHandler } from './eventsApi';
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
  const store = createGoogleSheetsBabyTrackerStore(new GoogleSheetsApi(createServiceAccountTokenSource(key), sheetId));
  const handle = createEventsHandler({
    apiToken,
    onError: (error) => console.error('events-api:', error instanceof Error ? error.message : error),
    store
  });

  createServer((request, response) => {
    serve(handle, request, response).catch((error) => {
      console.error('events-api:', error);

      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'internal' }));
      }
    });
  }).listen(port, () => {
    console.log(`events-api: listening on ${port} as ${key.client_email}`);
  });
}

async function serve(handle: (request: Request) => Promise<Response>, request: IncomingMessage, response: ServerResponse) {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    size += (chunk as Buffer).length;

    // Keep draining so the 413 reaches the caller instead of a reset socket.
    if (size <= MAX_BODY_BYTES) {
      chunks.push(chunk as Buffer);
    }
  }

  if (size > MAX_BODY_BYTES) {
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
