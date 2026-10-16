import { afterEach, describe, expect, it, vi } from 'vitest';
import { InternalRequestError } from './internalClient';
import { OtherAccountError, withRecentSignIn } from './internalReauth';

vi.mock('@simplewebauthn/browser',() => ({ startAuthentication:vi.fn(async () => ({ id:'credential' })) }));
const json = (body: unknown) => new Response(JSON.stringify(body),{ headers:{ 'Content-Type':'application/json' } });
function signsInAs(accountId: string) {
  const fetch = vi.fn(async (url: string) => json(url.endsWith('/options') ? { challengeId:'c',options:{ challenge:'x' } } : { accountId }));
  vi.stubGlobal('fetch',fetch); return fetch;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('confirming a stale sign-in',() => {
  it('confirms with a passkey once and retries an action refused for an old sign-in',async () => {
    const fetch = signsInAs('me');
    const action = vi.fn().mockRejectedValueOnce(new InternalRequestError(401,'unauthorized')).mockResolvedValueOnce('approved');
    await expect(withRecentSignIn('/api/v1','me',action)).resolves.toBe('approved');
    expect(action).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/v1/auth/login/options','/api/v1/auth/login/finish']);
  });
  it('leaves every other refusal alone',async () => {
    const fetch = signsInAs('me');
    await expect(withRecentSignIn('/api/v1','me',() => Promise.reject(new InternalRequestError(403,'forbidden')))).rejects.toThrow('forbidden');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not retry under an account that is not the one on screen',async () => {
    signsInAs('someone-else');
    const action = vi.fn().mockRejectedValue(new InternalRequestError(401,'unauthorized'));
    await expect(withRecentSignIn('/api/v1','me',action)).rejects.toBeInstanceOf(OtherAccountError);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
