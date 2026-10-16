/// <reference types="node" />
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openInternalDatabase } from './database';
import { createInternalHandler, MAX_INTERNAL_BODY } from './httpApi';

process.umask(0o077);
const path = process.env.BABYSTEPS_DATABASE_PATH;
const origin = process.env.BABYSTEPS_ORIGIN;
const rpId = process.env.BABYSTEPS_RP_ID;
if (!path || !origin || !rpId) throw new Error('Set BABYSTEPS_DATABASE_PATH, BABYSTEPS_ORIGIN and BABYSTEPS_RP_ID.');
mkdirSync(dirname(resolve(path)), { mode: 0o700, recursive: true });
const database = openInternalDatabase(path);
const api = createInternalHandler(database, { googleClientId: process.env.BABYSTEPS_GOOGLE_CLIENT_ID,
  origin, registrationOpen: process.env.BABYSTEPS_REGISTRATION_OPEN === 'true', rpId });
const server = createServer(async (request, response) => {
  let size = 0; const chunks: Buffer[] = [];
  try {
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > MAX_INTERNAL_BODY) { response.writeHead(413, { 'Content-Type':'application/json' }).end('{"error":"too_large"}'); request.resume(); return; }
      chunks.push(chunk as Buffer);
    }
    const method = request.method ?? 'GET';
    const input = new Request(new URL(request.url ?? '/', origin), { body: ['GET','HEAD'].includes(method) ? undefined : Buffer.concat(chunks),
      headers: Object.entries(request.headers).flatMap(([key,value]): Array<[string,string]> => value === undefined ? [] : [[key,String(value)]]), method });
    const result = await api.handle(input, request.socket.remoteAddress);
    const headers = Object.fromEntries(result.headers);
    // Multiple Set-Cookie fields must survive the Node/Fetch adapter.
    const setCookies = result.headers.getSetCookie(); delete headers['set-cookie'];
    response.writeHead(result.status, { ...headers, ...(setCookies.length ? { 'Set-Cookie': setCookies } : {}) });
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch { if (!response.headersSent) response.writeHead(500, { 'Content-Type':'application/json' }).end('{"error":"internal"}'); }
});
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(Number(process.env.PORT ?? 8790), process.env.HOST ?? '127.0.0.1', () => console.log('BabySteps internal API ready'));
function close() { server.close(() => { database.close(); process.exit(0); }); }
process.on('SIGTERM', close); process.on('SIGINT', close);
