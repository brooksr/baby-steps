import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginBrokerSignIn,
  BrokerGrantError,
  BrokerUnavailableError,
  buildAuthUrl,
  completeBrokerRedirect,
  getStoredRefreshToken,
  refreshWithBroker
} from './googleTokenBroker';

const REFRESH_KEY = 'babysteps.google.refresh';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status });
}

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_GOOGLE_TOKEN_BROKER', '/api/token');
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildAuthUrl', () => {
  const base = { clientId: 'cid', codeChallenge: 'chal', redirectUri: 'https://pi.example/', scope: 'a b', state: 'st' };

  it('asks for offline access with consent, so Google issues a refresh token', () => {
    const params = new URL(buildAuthUrl({ ...base, loginHint: 'mom@example.com', pickAccount: false })).searchParams;

    expect(params.get('access_type')).toBe('offline');
    expect(params.get('prompt')).toBe('consent');
    expect(params.get('response_type')).toBe('code');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('login_hint')).toBe('mom@example.com');
  });

  it('offers the account chooser, and no hint, after a sign-out', () => {
    const params = new URL(buildAuthUrl({ ...base, loginHint: 'mom@example.com', pickAccount: true })).searchParams;

    expect(params.get('prompt')).toBe('consent select_account');
    expect(params.has('login_hint')).toBe(false);
  });
});

describe('broker sign-in round trip', () => {
  it('sends the page to Google with a PKCE challenge, then redeems the code it comes back with', async () => {
    window.history.replaceState(null, '', '/?family=fam1#log');
    const navigate = vi.fn();
    void beginBrokerSignIn({ clientId: 'cid', pickAccount: false, scope: 'a' }, navigate);
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());

    const auth = new URL(navigate.mock.calls[0][0] as string).searchParams;
    expect(auth.get('redirect_uri')).toBe(new URL(import.meta.env.BASE_URL, window.location.origin).href);
    const state = auth.get('state') as string;

    const fetchMock = vi.fn(async () => jsonResponse(200, { access_token: 'at', expires_in: 3599, refresh_token: 'rt' }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', `/?state=${state}&code=the-code&scope=a`);

    const result = await completeBrokerRedirect();

    expect(result).toEqual({ status: 'signed-in', tokens: { accessToken: 'at', expiresIn: 3599, refreshToken: 'rt' } });
    expect(getStoredRefreshToken()).toBe('rt');
    // The code is gone and the invite link is back.
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/?family=fam1#log');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as { code: string; codeVerifier: string; redirectUri: string };
    expect(url).toBe('/api/token/exchange');
    expect(sent.code).toBe('the-code');
    expect(sent.redirectUri).toBe(auth.get('redirect_uri'));

    // The verifier sent to the broker is the one the challenge was made from.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sent.codeVerifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(auth.get('code_challenge')).toBe(challenge);
  });

  it('reports a declined sign-in without calling the broker', async () => {
    localStorage.setItem('babysteps.google.pending', JSON.stringify({ codeVerifier: 'v', redirectUri: 'r', returnTo: '', state: 's' }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/?state=s&error=access_denied');

    expect(await completeBrokerRedirect()).toEqual({ error: 'access_denied', status: 'denied' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

  it('leaves a URL alone when this device started no sign-in, or a different one', async () => {
    window.history.replaceState(null, '', '/?state=s&code=c');
    expect(await completeBrokerRedirect()).toEqual({ status: 'none' });

    localStorage.setItem('babysteps.google.pending', JSON.stringify({ codeVerifier: 'v', redirectUri: 'r', returnTo: '', state: 'other' }));
    expect(await completeBrokerRedirect()).toEqual({ status: 'none' });
    expect(window.location.search).toBe('?state=s&code=c');
  });

  it('does nothing on a build without a broker', async () => {
    vi.stubEnv('VITE_GOOGLE_TOKEN_BROKER', '');
    localStorage.setItem('babysteps.google.pending', JSON.stringify({ codeVerifier: 'v', redirectUri: 'r', returnTo: '', state: 's' }));
    window.history.replaceState(null, '', '/?state=s&code=c');

    expect(await completeBrokerRedirect()).toEqual({ status: 'none' });
  });
});

describe('refreshWithBroker', () => {
  it('swaps the stored refresh token for an access token', async () => {
    localStorage.setItem(REFRESH_KEY, 'rt');
    const fetchMock = vi.fn(async () => jsonResponse(200, { access_token: 'fresh', expires_in: 3599 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await refreshWithBroker()).toEqual({ accessToken: 'fresh', expiresIn: 3599, refreshToken: undefined });
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ refreshToken: 'rt' });
    expect(getStoredRefreshToken()).toBe('rt');
  });

  it('drops a refresh token Google has revoked', async () => {
    localStorage.setItem(REFRESH_KEY, 'rt');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(400, { error: 'invalid_grant' })));

    await expect(refreshWithBroker()).rejects.toBeInstanceOf(BrokerGrantError);
    expect(getStoredRefreshToken()).toBeUndefined();
  });

  it('keeps the refresh token when only the Pi or Google is down', async () => {
    localStorage.setItem(REFRESH_KEY, 'rt');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(502, { error: 'google_unreachable' })));
    await expect(refreshWithBroker()).rejects.toBeInstanceOf(BrokerUnavailableError);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(refreshWithBroker()).rejects.toBeInstanceOf(BrokerUnavailableError);
    expect(getStoredRefreshToken()).toBe('rt');
  });
});
