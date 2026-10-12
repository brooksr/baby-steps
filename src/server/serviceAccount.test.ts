// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createServiceAccountTokenSource, parseServiceAccountKey } from './serviceAccount';

async function makeKey() {
  const pair = await crypto.subtle.generateKey(
    { hash: 'SHA-256', modulusLength: 2048, name: 'RSASSA-PKCS1-v1_5', publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify']
  );
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey: pair.publicKey };
}

function fromBase64Url(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
}

describe('service account tokens', () => {
  it('signs a JWT Google can verify, and caches the token it gets back', async () => {
    const { pem, publicKey } = await makeKey();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: 'at', expires_in: 3599 })));
    const getToken = createServiceAccountTokenSource({ client_email: 'logger@family.iam.gserviceaccount.com', private_key: pem }, fetchImpl);

    expect(await getToken()).toBe('at');
    expect(await getToken()).toBe('at');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const params = new URLSearchParams(String(init.body));
    const [header, claims, signature] = params.get('assertion')!.split('.');

    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(header)))).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(claims)))).toMatchObject({
      aud: 'https://oauth2.googleapis.com/token',
      iss: 'logger@family.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/spreadsheets'
    });
    expect(
      await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, fromBase64Url(signature), new TextEncoder().encode(`${header}.${claims}`))
    ).toBe(true);

    await getToken(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('surfaces a refused grant rather than handing back nothing', async () => {
    const { pem } = await makeKey();
    const getToken = createServiceAccountTokenSource(
      { client_email: 'x@y', private_key: pem },
      vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 }))
    );

    await expect(getToken()).rejects.toThrow(/400/);
  });

  it('requires the two fields that matter in a key file', () => {
    expect(() => parseServiceAccountKey('{"client_email":"x@y"}')).toThrow();
    expect(parseServiceAccountKey('{"client_email":"x@y","private_key":"k","type":"service_account"}')).toEqual({
      client_email: 'x@y',
      private_key: 'k',
      token_uri: undefined
    });
  });
});
