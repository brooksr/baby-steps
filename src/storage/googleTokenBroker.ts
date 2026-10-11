// One-time sign-in through the token broker (`server/token-broker.mjs`).
//
// Only builds with `VITE_GOOGLE_TOKEN_BROKER` set use this — the Raspberry Pi
// build, served from the same origin as the broker. Everywhere else (GitHub
// Pages) the app keeps Google's browser-only token flow and its hourly renewal.
//
// Sign-in is a full-page redirect rather than a popup: an installed PWA on a
// phone is exactly where popups misbehave, and a redirect needs no user gesture
// to survive. Google sends the user back to the app root with a code, which the
// broker redeems for an access token and a refresh token. The refresh token is
// what makes sign-in one-time — it stays on this device and the broker swaps it
// for a fresh access token whenever one runs low, with no Google UI at all.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const PENDING_STORAGE_KEY = 'babysteps.google.pending';
const REFRESH_STORAGE_KEY = 'babysteps.google.refresh';
const BROKER_TIMEOUT_MS = 15_000;

export interface BrokerTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
}

/** The broker answered, and the grant is dead (revoked, expired): sign in again. */
export class BrokerGrantError extends Error {
  constructor(message = 'Google sign-in has expired.') {
    super(message);
    this.name = 'BrokerGrantError';
  }
}

/** The broker could not be reached, or Google could not: try again later. */
export class BrokerUnavailableError extends Error {
  constructor(message = 'Sign-in service unreachable.') {
    super(message);
    this.name = 'BrokerUnavailableError';
  }
}

interface PendingSignIn {
  codeVerifier: string;
  redirectUri: string;
  /** The URL's query and hash before leaving, so an invite link survives the trip. */
  returnTo: string;
  state: string;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getTokenBrokerUrl(): string | undefined {
  const value = (import.meta.env.VITE_GOOGLE_TOKEN_BROKER as string | undefined)?.trim();
  return value ? value.replace(/\/$/, '') : undefined;
}

export function isTokenBrokerConfigured() {
  return Boolean(getTokenBrokerUrl());
}

/**
 * True inside an iframe (the Home Assistant sidebar panel). Google will not
 * render its sign-in in a frame, and a framed page's storage is partitioned
 * from the top-level site's anyway, so a framed app keeps the popup flow.
 */
export function isFramed() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function getStoredRefreshToken(): string | undefined {
  return safeStorage()?.getItem(REFRESH_STORAGE_KEY) ?? undefined;
}

export function clearStoredRefreshToken() {
  safeStorage()?.removeItem(REFRESH_STORAGE_KEY);
}

function storeRefreshToken(token: string) {
  safeStorage()?.setItem(REFRESH_STORAGE_KEY, token);
}

/** Google sends the user back to the app root; it must be listed on the OAuth client as a redirect URI. */
export function getRedirectUri() {
  return new URL(import.meta.env.BASE_URL || '/', window.location.origin).href;
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomToken(byteLength = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function codeChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function buildAuthUrl(options: {
  clientId: string;
  codeChallenge: string;
  loginHint?: string;
  pickAccount: boolean;
  redirectUri: string;
  scope: string;
  state: string;
}) {
  const params = new URLSearchParams({
    // offline + consent is what makes Google issue a refresh token. Without
    // `consent`, an account that already granted these scopes gets none.
    access_type: 'offline',
    client_id: options.clientId,
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
    include_granted_scopes: 'true',
    prompt: options.pickAccount ? 'consent select_account' : 'consent',
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: options.scope,
    state: options.state
  });

  if (options.loginHint && !options.pickAccount) {
    params.set('login_hint', options.loginHint);
  }

  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * Send the page to Google's sign-in. The returned promise never settles — the
 * page is leaving — so a caller awaiting a token simply waits it out.
 */
export async function beginBrokerSignIn(
  options: { clientId: string; loginHint?: string; pickAccount: boolean; scope: string },
  navigate = (url: string) => window.location.assign(url)
): Promise<never> {
  const codeVerifier = randomToken(48);
  const pending: PendingSignIn = {
    codeVerifier,
    redirectUri: getRedirectUri(),
    returnTo: `${window.location.search}${window.location.hash}`,
    state: randomToken(24)
  };

  safeStorage()?.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending));
  navigate(
    buildAuthUrl({
      ...options,
      codeChallenge: await codeChallenge(codeVerifier),
      redirectUri: pending.redirectUri,
      state: pending.state
    })
  );

  return new Promise<never>(() => {});
}

async function callBroker(path: string, body: Record<string, string>) {
  const base = getTokenBrokerUrl();

  if (!base) {
    throw new BrokerUnavailableError('No token broker configured.');
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), BROKER_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(`${base}/${path}`, {
      body: JSON.stringify(body),
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal
    });
  } catch {
    throw new BrokerUnavailableError();
  } finally {
    window.clearTimeout(timer);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    expires_in?: number;
    refresh_token?: string;
  };

  if (response.ok && payload.access_token) {
    return {
      accessToken: payload.access_token,
      expiresIn: payload.expires_in ?? 3600,
      refreshToken: payload.refresh_token
    } satisfies BrokerTokens;
  }

  // 400 is the broker relaying Google's "no" (a dead grant, a spent code);
  // anything else is the Pi or Google being unwell, which a retry can fix.
  if (response.status === 400) {
    throw new BrokerGrantError(payload.error);
  }

  throw new BrokerUnavailableError(payload.error);
}

/** Swap this device's refresh token for a fresh access token. */
export async function refreshWithBroker(): Promise<BrokerTokens> {
  const refreshToken = getStoredRefreshToken();

  if (!refreshToken) {
    throw new BrokerGrantError('No refresh token on this device.');
  }

  try {
    return await callBroker('refresh', { refreshToken });
  } catch (error) {
    if (error instanceof BrokerGrantError) {
      clearStoredRefreshToken();
    }

    throw error;
  }
}

/** Revoke this device's grant on sign-out. Best effort: it must not hold up the reload. */
export function revokeWithBroker() {
  const base = getTokenBrokerUrl();
  const token = getStoredRefreshToken();
  clearStoredRefreshToken();

  if (!base || !token) {
    return;
  }

  // keepalive lets the request outlive the reload that follows a sign-out.
  void fetch(`${base}/revoke`, {
    body: JSON.stringify({ token }),
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    method: 'POST'
  }).catch(() => {});
}

export type RedirectResult =
  | { status: 'none' }
  | { status: 'denied'; error: string }
  | { status: 'failed'; error: unknown }
  | { status: 'signed-in'; tokens: BrokerTokens };

/**
 * Finish a sign-in Google just sent the page back from. Runs before the app
 * renders: takes the code out of the URL (putting back whatever query the page
 * left with), and redeems it. A URL that carries no sign-in this device started
 * is left alone.
 */
export async function completeBrokerRedirect(): Promise<RedirectResult> {
  if (!isTokenBrokerConfigured()) {
    return { status: 'none' };
  }

  const url = new URL(window.location.href);
  const state = url.searchParams.get('state');
  const raw = safeStorage()?.getItem(PENDING_STORAGE_KEY);

  if (!state || !raw) {
    return { status: 'none' };
  }

  let pending: PendingSignIn;

  try {
    pending = JSON.parse(raw) as PendingSignIn;
  } catch {
    safeStorage()?.removeItem(PENDING_STORAGE_KEY);
    return { status: 'none' };
  }

  if (pending.state !== state) {
    return { status: 'none' };
  }

  safeStorage()?.removeItem(PENDING_STORAGE_KEY);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  // The code is single-use, but it still has no business in the history stack.
  window.history.replaceState(null, '', `${url.pathname}${pending.returnTo}`);

  if (!code) {
    return { error: error || 'no_code', status: 'denied' };
  }

  try {
    const tokens = await callBroker('exchange', { code, codeVerifier: pending.codeVerifier, redirectUri: pending.redirectUri });

    if (tokens.refreshToken) {
      storeRefreshToken(tokens.refreshToken);
    }

    return { status: 'signed-in', tokens };
  } catch (failure) {
    return { error: failure, status: 'failed' };
  }
}
