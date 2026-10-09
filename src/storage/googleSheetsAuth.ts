const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
// The email scope is how the app knows *who* signed in — a parent or a
// caregiver (`domain/access.ts`). Adding it asks a device that granted the
// Sheets scope alone to consent once more. `drive.file` reaches only the files
// this app created — how a new family's spreadsheet is made, found again on
// another device, and shared with the people it adds (`familyDirectory.ts`).
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
/** Treat a token as spent slightly early so an in-flight request can't expire mid-call. */
const EXPIRY_SKEW_MS = 120_000;
/** Renew this far ahead of expiry so the session never lapses while the app is open. */
const REFRESH_LEAD_MS = 300_000;
const MIN_REFRESH_DELAY_MS = 30_000;
const TOKEN_STORAGE_KEY = 'babysteps.google.token';
const GRANT_STORAGE_KEY = 'babysteps.google.granted';
const EMAIL_STORAGE_KEY = 'babysteps.google.email';
/** Set after a sign-out or a refused sign-in: the next interactive request shows Google's account chooser. */
const PICK_ACCOUNT_STORAGE_KEY = 'babysteps.google.pickAccount';
const SILENT_TIMEOUT_MS = 20_000;

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  expires_in?: number;
}

interface GoogleTokenClient {
  callback?: (response: GoogleTokenResponse) => void;
  requestAccessToken(options?: { prompt?: string }): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(options: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
          }): GoogleTokenClient;
        };
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;
let tokenClient: GoogleTokenClient | null = null;
let accessToken: string | null = null;
let expiresAt = 0;
/** Only one token request may be in flight — the GIS client has a single callback slot. */
let pendingRequest: Promise<string> | null = null;
let refreshTimer: number | null = null;
let keepAliveAttached = false;

export class GoogleAuthRequiredError extends Error {
  constructor(message = 'Connect Google Sheets before using sheet storage.') {
    super(message);
    this.name = 'GoogleAuthRequiredError';
  }
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function persistToken() {
  if (!accessToken) {
    return;
  }
  safeStorage()?.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ accessToken, expiresAt }));
}

function markGranted() {
  safeStorage()?.setItem(GRANT_STORAGE_KEY, '1');
}

/** True once the user has completed the Google consent on this device. */
export function hasStoredGoogleGrant() {
  return safeStorage()?.getItem(GRANT_STORAGE_KEY) === '1';
}

/** Forget the cached token + grant (used by an explicit disconnect). */
export function signOutGoogle() {
  accessToken = null;
  expiresAt = 0;
  cancelSilentRefresh();
  const storage = safeStorage();
  storage?.removeItem(TOKEN_STORAGE_KEY);
  storage?.removeItem(GRANT_STORAGE_KEY);
  storage?.removeItem(EMAIL_STORAGE_KEY);
  // Otherwise the next sign-in silently reuses the account just signed out of —
  // which is how an account Google refused leaves no way to pick another.
  storage?.setItem(PICK_ACCOUNT_STORAGE_KEY, '1');
}

/**
 * The signed-in Google account's email, as last seen on this device. Kept so
 * the right view opens offline and before the first read of a session.
 */
export function getStoredGoogleEmail(): string | undefined {
  return safeStorage()?.getItem(EMAIL_STORAGE_KEY) ?? undefined;
}

/**
 * Ask Google who the current token belongs to. Falls back to the stored email
 * when the lookup fails — a token minted before the email scope was added, or
 * a dropped connection, should not change which view a device is on.
 */
export async function fetchGoogleEmail(): Promise<string | undefined> {
  try {
    const token = await requestGoogleSheetsAccessToken(false);
    const response = await fetch(USERINFO_URL, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });

    if (!response.ok) {
      return getStoredGoogleEmail();
    }

    const email = ((await response.json()) as { email?: string }).email?.trim().toLowerCase();

    if (email) {
      safeStorage()?.setItem(EMAIL_STORAGE_KEY, email);
    }

    return email || getStoredGoogleEmail();
  } catch {
    return getStoredGoogleEmail();
  }
}

/**
 * Drop the cached token but keep the grant, so the next request mints a fresh
 * one. Used when Google rejects a token before its stated expiry.
 */
export function invalidateGoogleToken() {
  accessToken = null;
  expiresAt = 0;
  cancelSilentRefresh();
  safeStorage()?.removeItem(TOKEN_STORAGE_KEY);
}

function hydrateToken() {
  const raw = safeStorage()?.getItem(TOKEN_STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw) as { accessToken?: string; expiresAt?: number };
    if (parsed.accessToken && parsed.expiresAt && Date.now() < parsed.expiresAt - EXPIRY_SKEW_MS) {
      accessToken = parsed.accessToken;
      expiresAt = parsed.expiresAt;
    } else {
      safeStorage()?.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    safeStorage()?.removeItem(TOKEN_STORAGE_KEY);
  }
}

hydrateToken();

export function getGoogleClientId() {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
}

export function hasGoogleClientId() {
  return Boolean(getGoogleClientId());
}

function hasFreshToken() {
  return Boolean(accessToken) && Date.now() < expiresAt - EXPIRY_SKEW_MS;
}

/** True when the cached token is close enough to expiry to be worth renewing. */
function needsRenewal() {
  return !accessToken || Date.now() > expiresAt - REFRESH_LEAD_MS;
}

function cancelSilentRefresh() {
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * Retry a renewal that just failed. Without this the timer chain ends on the
 * first hiccup (a cold network, a tab waking mid-request) and the token quietly
 * lapses — which is what sends someone back to the sign-in screen.
 */
function scheduleRenewalRetry() {
  cancelSilentRefresh();

  if (typeof window === 'undefined' || !hasStoredGoogleGrant()) {
    return;
  }

  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void requestGoogleSheetsAccessToken(false).catch(scheduleRenewalRetry);
  }, MIN_REFRESH_DELAY_MS);
}

/** Renew shortly before the current token lapses so the user is never bounced. */
function scheduleSilentRefresh() {
  cancelSilentRefresh();

  if (!expiresAt || typeof window === 'undefined') {
    return;
  }

  const delay = Math.max(MIN_REFRESH_DELAY_MS, expiresAt - REFRESH_LEAD_MS - Date.now());
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void requestGoogleSheetsAccessToken(false).catch(scheduleRenewalRetry);
  }, delay);
}

/**
 * Keep the Google session warm for the life of the app: renew when the tab
 * comes back to the foreground (timers don't fire reliably in a backgrounded
 * PWA) and when the device comes back online. Returns a cleanup function.
 */
export function keepGoogleSessionAlive() {
  if (keepAliveAttached || typeof window === 'undefined') {
    return () => {};
  }

  const renew = () => {
    if (!hasStoredGoogleGrant() || document.visibilityState === 'hidden' || !needsRenewal()) {
      return;
    }

    void requestGoogleSheetsAccessToken(false).catch(() => {
      // Ignore — an interactive reconnect is offered if a real request fails.
    });
  };

  keepAliveAttached = true;
  document.addEventListener('visibilitychange', renew);
  window.addEventListener('focus', renew);
  window.addEventListener('online', renew);
  scheduleSilentRefresh();

  return () => {
    keepAliveAttached = false;
    document.removeEventListener('visibilitychange', renew);
    window.removeEventListener('focus', renew);
    window.removeEventListener('online', renew);
    cancelSilentRefresh();
  };
}

function loadGoogleIdentityScript() {
  if (scriptPromise) {
    return scriptPromise;
  }

  scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = GOOGLE_IDENTITY_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('Unable to load Google Identity Services.'));
    };
    document.head.append(script);
  });

  return scriptPromise;
}

async function getTokenClient() {
  const clientId = getGoogleClientId();

  if (!clientId) {
    throw new GoogleAuthRequiredError('Missing VITE_GOOGLE_CLIENT_ID.');
  }

  await loadGoogleIdentityScript();

  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services did not initialize.');
  }

  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: () => {}
    });
  }

  return tokenClient;
}

async function fetchToken(interactive: boolean) {
  const client = await getTokenClient();

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (!settled) {
        settled = true;
        action();
      }
    };

    // Guard the silent path so a blocked popup can't hang the boot sequence.
    const timer = interactive
      ? undefined
      : window.setTimeout(() => finish(() => reject(new GoogleAuthRequiredError('Silent Google sign-in timed out.'))), SILENT_TIMEOUT_MS);

    client.callback = (response) => {
      if (timer) {
        window.clearTimeout(timer);
      }

      if (response.error || !response.access_token) {
        if (interactive) {
          safeStorage()?.setItem(PICK_ACCOUNT_STORAGE_KEY, '1');
        }

        finish(() => reject(new GoogleAuthRequiredError(response.error || 'Google authorization was not completed.')));
        return;
      }

      accessToken = response.access_token;
      expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
      persistToken();
      markGranted();
      safeStorage()?.removeItem(PICK_ACCOUNT_STORAGE_KEY);
      scheduleSilentRefresh();
      finish(() => resolve(accessToken as string));
    };

    // prompt:'' reuses an existing grant silently and only shows UI when Google
    // actually needs it (e.g. the very first consent), so returning users on
    // this device aren't sent back to a login screen each launch.
    // After a sign-out or a refusal, ask which account instead.
    const pickAccount = interactive && safeStorage()?.getItem(PICK_ACCOUNT_STORAGE_KEY) === '1';
    client.requestAccessToken({ prompt: pickAccount ? 'select_account' : '' });
  });
}

export async function requestGoogleSheetsAccessToken(interactive: boolean) {
  if (hasFreshToken()) {
    return accessToken as string;
  }

  // Share one in-flight request: the GIS client keeps a single callback, so
  // overlapping requests would clobber each other and hang.
  if (pendingRequest) {
    try {
      return await pendingRequest;
    } catch (error) {
      if (!interactive) {
        throw error;
      }
    }

    if (hasFreshToken()) {
      return accessToken as string;
    }
  }

  // A silent (non-interactive) refresh is only attempted once the user has
  // granted consent on this device — otherwise we'd surprise them with a popup.
  if (!interactive && !hasStoredGoogleGrant()) {
    throw new GoogleAuthRequiredError();
  }

  const request = fetchToken(interactive);
  pendingRequest = request;

  try {
    return await request;
  } finally {
    if (pendingRequest === request) {
      pendingRequest = null;
    }
  }
}

/**
 * Token getter for Sheets API calls: reuse or silently renew the grant, and
 * only fall back to an interactive prompt when Google really needs the user.
 */
export async function getGoogleSheetsAccessToken(forceRefresh = false) {
  if (forceRefresh) {
    invalidateGoogleToken();
  }

  try {
    return await requestGoogleSheetsAccessToken(false);
  } catch (error) {
    if (!hasStoredGoogleGrant()) {
      throw error;
    }

    return requestGoogleSheetsAccessToken(true);
  }
}
