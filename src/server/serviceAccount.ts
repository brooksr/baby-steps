/**
 * Access tokens for a Google service account, so the events API can write to a
 * family's sheet with no one signed in. The sheet is shared with the account's
 * email as an editor, exactly as it is shared with a parent.
 *
 * A service account rather than someone's refresh token: it belongs to no
 * person, so it survives anyone signing out, revoking access or leaving, and it
 * reaches only the sheets someone deliberately shared with it.
 *
 * WebCrypto only — no dependencies, and nothing Node-specific.
 */

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
/** Renew this long before Google's stated expiry. */
const EXPIRY_MARGIN_SECONDS = 60;
const TOKEN_LIFETIME_SECONDS = 3600;

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export function parseServiceAccountKey(text: string): ServiceAccountKey {
  const key = JSON.parse(text) as Partial<ServiceAccountKey>;

  if (typeof key.client_email !== 'string' || typeof key.private_key !== 'string') {
    throw new Error('A service account key needs client_email and private_key.');
  }

  return { client_email: key.client_email, private_key: key.private_key, token_uri: key.token_uri };
}

/** A token getter in the shape `GoogleSheetsApi` takes, caching until near expiry. */
export function createServiceAccountTokenSource(key: ServiceAccountKey, fetchImpl: typeof fetch = fetch) {
  let cached: { expiresAt: number; token: string } | undefined;
  let signingKey: Promise<CryptoKey> | undefined;

  return async function getAccessToken(forceRefresh = false) {
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (cached && !forceRefresh && cached.expiresAt > nowSeconds) {
      return cached.token;
    }

    signingKey ??= importPrivateKey(key.private_key);
    const tokenUri = key.token_uri || DEFAULT_TOKEN_URI;
    const assertion = await signJwt(await signingKey, {
      aud: tokenUri,
      exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
      iat: nowSeconds,
      iss: key.client_email,
      scope: SHEETS_SCOPE
    });
    const response = await fetchImpl(tokenUri, {
      body: new URLSearchParams({ assertion, grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer' }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error(`Service account token request failed (${response.status}): ${await response.text()}`);
    }

    const body = (await response.json()) as { access_token: string; expires_in?: number };
    cached = {
      expiresAt: nowSeconds + (body.expires_in ?? TOKEN_LIFETIME_SECONDS) - EXPIRY_MARGIN_SECONDS,
      token: body.access_token
    };
    return cached.token;
  };
}

function importPrivateKey(pem: string) {
  const base64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { hash: 'SHA-256', name: 'RSASSA-PKCS1-v1_5' }, false, ['sign']);
}

async function signJwt(key: CryptoKey, claims: Record<string, unknown>) {
  const encoder = new TextEncoder();
  const unsigned = `${base64Url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))}.${base64Url(encoder.encode(JSON.stringify(claims)))}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

function base64Url(bytes: Uint8Array) {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
