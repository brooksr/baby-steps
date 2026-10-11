// BabySteps token broker — the only server-side piece of the app.
//
// Google's browser-only sign-in hands out one-hour access tokens and never a
// refresh token, so a static site has to send everyone back to Google every
// hour. A refresh token needs the OAuth client *secret* to redeem, and a secret
// cannot ship in a bundle anyone can read. This holds the secret and does the
// two calls that need it — redeem a sign-in code, and swap a refresh token for
// a fresh access token — plus revoke on sign-out.
//
// It is stateless: it stores no tokens and keeps no sessions. Each device keeps
// its own refresh token; the sheet stays the database. No dependencies, so the
// Pi runs it on a stock `node:24-alpine` image.
//
// Environment:
//   GOOGLE_CLIENT_ID      the same web client id the app is built with
//   GOOGLE_CLIENT_SECRET  that client's secret — never in the app build
//   ALLOWED_ORIGINS       comma-separated origins allowed to call (the app's)
//   PORT                  default 8787

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const MAX_BODY_BYTES = 8192;
const PREFIX = '/api/token';

/**
 * Build the request handler. Kept apart from `listen` so tests can drive it
 * with a fake `fetch` and no network.
 *
 * @param {{ clientId: string, clientSecret: string, allowedOrigins: string[], fetch?: typeof fetch }} options
 */
export function createBrokerHandler({ allowedOrigins, clientId, clientSecret, fetch: fetchImpl = fetch }) {
  const origins = new Set(allowedOrigins);

  async function callGoogle(url, params) {
    let response;

    try {
      response = await fetchImpl(url, {
        body: new URLSearchParams(params).toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        method: 'POST'
      });
    } catch {
      return { body: { error: 'google_unreachable' }, status: 502 };
    }

    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      return { body, status: 200 };
    }

    // A dead or revoked grant is the caller's to handle (sign in again); a
    // Google outage is not, so it stays a 502 the app reads as "try later".
    return { body: { error: body.error || 'google_error' }, status: response.status >= 500 ? 502 : 400 };
  }

  const routes = {
    async exchange(input) {
      if (!input.code || !input.codeVerifier || !input.redirectUri) {
        return { body: { error: 'invalid_request' }, status: 400 };
      }

      const result = await callGoogle(GOOGLE_TOKEN_URL, {
        client_id: clientId,
        client_secret: clientSecret,
        code: input.code,
        code_verifier: input.codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: input.redirectUri
      });

      return result.status === 200 ? { body: pickTokens(result.body), status: 200 } : result;
    },
    async refresh(input) {
      if (!input.refreshToken) {
        return { body: { error: 'invalid_request' }, status: 400 };
      }

      const result = await callGoogle(GOOGLE_TOKEN_URL, {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken
      });

      return result.status === 200 ? { body: pickTokens(result.body), status: 200 } : result;
    },
    async revoke(input) {
      if (!input.token) {
        return { body: { error: 'invalid_request' }, status: 400 };
      }

      // Revoking an already-dead token is still a successful sign-out.
      await callGoogle(GOOGLE_REVOKE_URL, { token: input.token });
      return { body: { ok: true }, status: 200 };
    }
  };

  return async function handle(request, response) {
    const origin = request.headers.origin;
    const url = new URL(request.url || '/', 'http://broker');

    if (origin && origins.has(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }

    if (url.pathname === `${PREFIX}/health` && request.method === 'GET') {
      return send(response, 200, { ok: true });
    }

    const route = url.pathname.startsWith(`${PREFIX}/`) ? url.pathname.slice(PREFIX.length + 1) : '';

    if (!Object.hasOwn(routes, route)) {
      return send(response, 404, { error: 'not_found' });
    }

    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.setHeader('Access-Control-Allow-Methods', 'POST');
      return send(response, 204);
    }

    if (request.method !== 'POST') {
      return send(response, 405, { error: 'method_not_allowed' });
    }

    // Browsers always send Origin on a cross-origin or POST fetch; anything
    // without one, or from a site that is not ours, is not the app.
    if (!origin || !origins.has(origin)) {
      return send(response, 403, { error: 'origin_not_allowed' });
    }

    let input;

    try {
      input = JSON.parse(await readBody(request));
    } catch (error) {
      return send(response, error instanceof BodyTooLargeError ? 413 : 400, { error: 'invalid_request' });
    }

    if (!input || typeof input !== 'object') {
      return send(response, 400, { error: 'invalid_request' });
    }

    const result = await routes[route](input);
    return send(response, result.status, result.body);
  };
}

/** Only what the app needs — never echo Google's id_token or anything else back. */
function pickTokens(body) {
  const tokens = { access_token: body.access_token, expires_in: body.expires_in };

  if (body.refresh_token) {
    tokens.refresh_token = body.refresh_token;
  }

  return tokens;
}

class BodyTooLargeError extends Error {}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    request.on('data', (chunk) => {
      size += chunk.length;

      // Stop keeping it but let the rest drain, so the 413 still reaches the
      // caller instead of a reset socket.
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0;
        reject(new BodyTooLargeError());
        return;
      }

      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function send(response, status, body) {
  // Tokens must never sit in a proxy or browser cache.
  response.setHeader('Cache-Control', 'no-store');

  if (body === undefined) {
    response.writeHead(status);
    response.end();
    return;
  }

  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const port = Number(process.env.PORT) || 8787;

  if (!clientId || !clientSecret || !allowedOrigins.length) {
    console.error('token-broker: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and ALLOWED_ORIGINS.');
    process.exit(1);
  }

  const handle = createBrokerHandler({ allowedOrigins, clientId, clientSecret });
  createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) {
        send(response, 500, { error: 'internal' });
      }
    });
  }).listen(port, () => {
    console.log(`token-broker: listening on ${port} for ${allowedOrigins.join(', ')}`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
