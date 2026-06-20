const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const EXPIRY_SKEW_MS = 60_000;

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

  if (!interactive) {
    throw new GoogleAuthRequiredError();
  }

  const client = await getTokenClient();

  return new Promise<string>((resolve, reject) => {
    client.callback = (response) => {
      if (response.error || !response.access_token) {
        reject(new GoogleAuthRequiredError(response.error || 'Google authorization was not completed.'));
        return;
      }

      accessToken = response.access_token;
      expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
      resolve(accessToken);
    };

    client.requestAccessToken({ prompt: 'consent' });
  });
}
