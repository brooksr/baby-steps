// @vitest-environment node
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrokerHandler } from './token-broker.mjs';

const ORIGIN = 'https://pi.example.ts.net:8443';
let server;

async function start(googleFetch) {
  const handle = createBrokerHandler({
    allowedOrigins: [ORIGIN],
    clientId: 'client-id',
    clientSecret: 'shh',
    fetch: googleFetch
  });
  server = createServer((request, response) => void handle(request, response));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}/api/token`;
}

function google(status, body) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

function post(url, body, origin = ORIGIN) {
  return fetch(url, {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    method: 'POST'
  });
}

afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve));
  server = undefined;
});

describe('token broker', () => {
  it('redeems a code with the secret and returns only the tokens', async () => {
    const googleFetch = google(200, { access_token: 'at', expires_in: 3599, id_token: 'jwt', refresh_token: 'rt', scope: 'x' });
    const base = await start(googleFetch);
    const response = await post(`${base}/exchange`, { code: 'c', codeVerifier: 'v', redirectUri: `${ORIGIN}/` });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(await response.json()).toEqual({ access_token: 'at', expires_in: 3599, refresh_token: 'rt' });

    const [url, init] = googleFetch.mock.calls[0];
    const sent = new URLSearchParams(init.body);
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(sent)).toEqual({
      client_id: 'client-id',
      client_secret: 'shh',
      code: 'c',
      code_verifier: 'v',
      grant_type: 'authorization_code',
      redirect_uri: `${ORIGIN}/`
    });
  });

  it('refreshes, and reports a dead grant as a 400 the app can act on', async () => {
    const base = await start(google(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }));
    const response = await post(`${base}/refresh`, { refreshToken: 'rt' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_grant' });
  });

  it('reads a Google outage as a 502, not a dead grant', async () => {
    const base = await start(google(503, {}));
    expect((await post(`${base}/refresh`, { refreshToken: 'rt' })).status).toBe(502);

    await new Promise((resolve) => server.close(resolve));
    const offline = await start(vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect((await post(`${offline}/refresh`, { refreshToken: 'rt' })).status).toBe(502);
  });

  it('refuses callers that are not the app', async () => {
    const googleFetch = google(200, {});
    const base = await start(googleFetch);

    expect((await post(`${base}/refresh`, { refreshToken: 'rt' }, 'https://evil.example')).status).toBe(403);
    expect((await post(`${base}/refresh`, { refreshToken: 'rt' }, null)).status).toBe(403);
    expect(googleFetch).not.toHaveBeenCalled();
  });

  it('rejects malformed, oversized and unknown requests', async () => {
    const base = await start(google(200, {}));

    expect((await post(`${base}/refresh`, 'not json')).status).toBe(400);
    expect((await post(`${base}/refresh`, {})).status).toBe(400);
    expect((await post(`${base}/refresh`, { refreshToken: 'x'.repeat(10_000) })).status).toBe(413);
    expect((await post(`${base}/constructor`, {})).status).toBe(404);
    expect((await fetch(`${base}/refresh`)).status).toBe(405);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it('treats revoking an already-dead token as signed out', async () => {
    const base = await start(google(400, { error: 'invalid_token' }));
    const response = await post(`${base}/revoke`, { token: 'rt' });

    expect(response.status).toBe(200);
  });
});
