const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const EXPIRY_SKEW_MS = 60_000;
const TOKEN_STORAGE_KEY = 'babysteps.google.token';
const GRANT_STORAGE_KEY = 'babysteps.google.granted';
const SILENT_TIMEOUT_MS = 8_000;

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
  const storage = safeStorage();
  storage?.removeItem(TOKEN_STORAGE_KEY);
  storage?.removeItem(GRANT_STORAGE_KEY);
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
    script.onerror = () => reject(new Error('Unable to load Google Identity Services.'));
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
      scope: SHEETS_SCOPE,
      callback: () => {}
    });
  }

  return tokenClient;
}

export async function requestGoogleSheetsAccessToken(interactive: boolean) {
  if (accessToken && Date.now() < expiresAt - EXPIRY_SKEW_MS) {
    return accessToken;
  }

  // A silent (non-interactive) refresh is only attempted once the user has
  // granted consent on this device — otherwise we'd surprise them with a popup.
  if (!interactive && !hasStoredGoogleGrant()) {
    throw new GoogleAuthRequiredError();
  }

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
        finish(() => reject(new GoogleAuthRequiredError(response.error || 'Google authorization was not completed.')));
        return;
      }

      accessToken = response.access_token;
      expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
      persistToken();
      markGranted();
      finish(() => resolve(accessToken as string));
    };

    // prompt:'' reuses an existing grant silently and only shows UI when Google
    // actually needs it (e.g. the very first consent), so returning users on
    // this device aren't sent back to a login screen each launch.
    client.requestAccessToken({ prompt: '' });
  });
}
