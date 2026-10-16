// @vitest-environment node
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NURSERY_SCHEMAS } from '../../domain/nurserySensor';
import { openInternalDatabase } from './database';
import { createAccountService, digest } from './accounts';
import { createInternalHandler } from './httpApi';

let db: ReturnType<typeof openInternalDatabase>;
let time: number;
let auth: ReturnType<typeof createAccountService>;
const config = { origin:'https://babysteps.example.test',registrationOpen:true,rpId:'babysteps.example.test' };
beforeEach(() => { db = openInternalDatabase(':memory:'); time = Date.parse('2026-10-16T12:00:00Z'); auth = createAccountService(db,config,() => time);
  db.prepare('INSERT INTO accounts VALUES (?, ?, NULL)').run('account',new Date(time).toISOString()); });
afterEach(() => { db.close(); vi.unstubAllGlobals(); });
function owner() { const token = auth.issueSession('account'); return { principal:auth.session(token.token,'browser',token.csrf),token }; }

describe('internal accounts and HTTP boundary',() => {
  it('sets the flow cookie only at ceremony starts and refreshes its lifetime',async () => {
    const api = createInternalHandler(db,config,() => time);
    const read = await api.handle(new Request(config.origin+'/api/v1/config'));
    expect(read.headers.getSetCookie()).toEqual([]);
    const start = (cookie?: string) => api.handle(new Request(config.origin+'/api/v1/auth/login/options',{
      method:'POST',headers:{ 'Content-Type':'application/json',Origin:config.origin,...(cookie ? { Cookie:cookie } : {}) },body:'{}'
    }));
    const first = await start();
    const flow = first.headers.getSetCookie().find(cookie => cookie.startsWith('__Host-babysteps-flow='))!;
    expect(flow).toContain('Max-Age=600');
    time += 599_000;
    const next = await start(flow.split(';')[0]);
    expect(next.headers.getSetCookie()).toContain(flow);
    const challenge = await next.json() as { challengeId:string };
    time += 120_000;
    expect(() => api.auth.consume(challenge.challengeId,flow.split(';')[0].split('=')[1],'login')).not.toThrow();
    const unrelated = await api.handle(new Request(config.origin+'/api/v1/config'));
    expect(unrelated.headers.getSetCookie()).toEqual([]);
  });
  it('allows only the first account through a private setup token with public signup closed',async () => {
    const fresh = openInternalDatabase(':memory:');
    try {
      const setup = createAccountService(fresh,{ ...config,bootstrapTokenHash:digest('private-setup'),registrationOpen:false });
      await expect(setup.registrationOptions('browser')).rejects.toThrow('forbidden');
      await expect(setup.registrationOptions('browser',undefined,undefined,'wrong')).rejects.toThrow('forbidden');
      const challenge = await setup.registrationOptions('browser',undefined,undefined,'private-setup');
      expect(() => setup.consume(challenge.challengeId,'browser','register')).toThrow('unauthorized');
      fresh.prepare('INSERT INTO accounts VALUES (?, ?, NULL)').run('first',new Date(time).toISOString());
      await expect(setup.registrationOptions('browser',undefined,undefined,'private-setup')).rejects.toThrow('forbidden');
    } finally { fresh.close(); }
  });
  it('uses hashed, expiring, revocable browser sessions and checks CSRF and transport kind',() => {
    const { principal,token } = owner();
    expect(db.prepare('SELECT token_hash FROM sessions').get()!.token_hash).not.toBe(token.token);
    expect(() => auth.session(token.token,'browser','wrong')).toThrow('forbidden');
    expect(() => auth.session(token.token,'native')).toThrow('unauthorized');
    auth.logout(principal); expect(() => auth.session(token.token,'browser')).toThrow('unauthorized');
    const fresh = auth.issueSession('account'); time += 8 * 24 * 3600_000;
    expect(() => auth.session(fresh.token,'browser')).toThrow('unauthorized');
  });
  it('consumes recovery codes once and revokes existing sessions',() => {
    const { token } = owner(); const codes = auth.recoveryCodes('account');
    expect(codes).toHaveLength(10); expect(db.prepare('SELECT code_hash FROM recovery_codes').all().some((row) => row.code_hash === codes[0])).toBe(false);
    const recovered = auth.recover('account',codes[0]); expect(auth.session(recovered.token,'browser').accountId).toBe('account');
    expect(() => auth.session(token.token,'browser')).toThrow('unauthorized'); expect(() => auth.recover('account',codes[0])).toThrow('unauthorized');
  });
  it('binds expiring, single-use challenges to their browser and purpose',() => {
    const id = auth.challenge('login','browser','challenge');
    expect(() => auth.consume(id,'other-browser','login')).toThrow('unauthorized');
    expect(() => auth.consume(id,'browser','register')).toThrow('unauthorized');
    expect(auth.consume(id,'browser','login').challenge).toBe('challenge');
    expect(() => auth.consume(id,'browser','login')).toThrow('unauthorized');
    const expired = auth.challenge('login','browser','challenge'); time += 6 * 60_000;
    expect(() => auth.consume(expired,'browser','login')).toThrow('unauthorized');
  });
  it('makes family ownership explicit and invitations one-use, with no email claims',() => {
    const { principal } = owner(); const { familyId } = auth.createFamily(principal,{ childName:'Baby Example',parentName:'Alex Example' });
    const parent = db.prepare('SELECT profile_id FROM memberships WHERE family_id=?').get(familyId)!.profile_id;
    const invite = auth.invite(principal,familyId,String(parent));
    db.prepare('INSERT INTO accounts VALUES (?, ?, NULL)').run('other',new Date(time).toISOString());
    const other = auth.issueSession('other'); const joiner = auth.session(other.token,'browser');
    // A profile already linked to another account cannot be claimed with an invite.
    expect(() => auth.acceptInvite(joiner,invite.token)).toThrow();
    expect(auth.listFamilies(joiner)).toEqual([]);
    time += 11 * 60_000; expect(() => auth.createFamily(principal,{ parentName:'Again' })).toThrow('unauthorized');
  });
  it('rotates native refresh credentials and revokes an installation on token reuse',() => {
    const { principal } = owner(); const { familyId } = auth.createFamily(principal,{ parentName:'Alex Example' });
    const start = auth.startDevice('watch'); expect(auth.exchangeDevice(start.deviceCode,start.deviceSecret)).toEqual({ pending:true });
    auth.approveDevice(principal,familyId,start.userCode);
    const result = auth.exchangeDevice(start.deviceCode,start.deviceSecret);
    if (!('token' in result)) throw new Error('Expected issued credentials');
    const native = auth.session(result.token,'native'); expect(auth.checkNativeFamily(native,familyId)).toEqual(['watch']);
    expect(() => auth.checkNativeFamily(native,'foreign-family')).toThrow('forbidden');
    expect(() => auth.exchangeDevice(start.deviceCode,start.deviceSecret)).toThrow('unauthorized');
    const next = auth.refreshNative(result.refreshToken); expect(next.refreshToken).not.toBe(result.refreshToken);
    expect(() => auth.session(result.token,'native')).toThrow('unauthorized');
    expect(() => auth.refreshNative(result.refreshToken)).toThrow('unauthorized');
    expect(() => auth.session(next.token,'native')).toThrow('unauthorized');
  });
  it('enforces watch capabilities in the HTTP API and filters its bootstrap',async () => {
    const api = createInternalHandler(db,config,() => time);
    const token = api.auth.issueSession('account'); const principal = api.auth.session(token.token,'browser');
    const first = api.auth.createFamily(principal,{ childName:'Baby Example',parentName:'Alex Example' });
    api.auth.createFamily(principal,{ childName:'Another Baby',parentName:'Alex Example' });
    const start = api.auth.startDevice('watch'); api.auth.approveDevice(principal,first.familyId,start.userCode);
    const native = api.auth.exchangeDevice(start.deviceCode,start.deviceSecret);
    if (!('token' in native)) throw new Error('Expected credentials');
    const get = (path: string) => api.handle(new Request(`${config.origin}/api/v1${path}`,{ headers:{ Authorization:`Bearer ${native.token}` } }));
    const result = await get(`/families/${first.familyId}/bootstrap`); const bootstrap = await result.json();
    expect(result.status).toBe(200); expect(bootstrap.data.profiles.every((p: { kind:string }) => p.kind === 'child')).toBe(true);
    expect(bootstrap.data.profile.careInfo).toBeUndefined();
    expect((await (await get('/session')).json()).families).toHaveLength(1);
    expect((await get('/account/sessions')).status).toBe(403);
    const denied = await api.handle(new Request(`${config.origin}/api/v1/families/${first.familyId}/mutations`,{ body:JSON.stringify({ action:'save',collection:'tasks',expectedRevision:0,id:'task',operationId:'task',patch:{ status:'open',title:'No' } }),headers:{ Authorization:`Bearer ${native.token}`,'Content-Type':'application/json' },method:'POST' }));
    expect(denied.status).toBe(403);
  });

  it('keeps nursery delivery scoped, validated and idempotent across re-enrollment',async () => {
    const api = createInternalHandler(db,config,() => time); const session = api.auth.issueSession('account');
    const principal = api.auth.session(session.token,'browser'); const { familyId } = api.auth.createFamily(principal,{ childName:'Baby Example',parentName:'Alex Example' });
    const enroll = () => { const start = api.auth.startDevice('nursery','sensor-a'); api.auth.approveDevice(principal,familyId,start.userCode); const issued = api.auth.exchangeDevice(start.deviceCode,start.deviceSecret); if (!('token' in issued)) throw new Error('Expected issued token'); return issued; };
    const first = enroll();
    const data = { ...Object.fromEntries(NURSERY_SCHEMAS.interval.columns.map((key) => [key,null])),clippedWindows:0,coveragePercent:100,durationMs:1000,endUtc:'2026-10-16T12:00:01Z',peakDbfs:-20,sessionId:1,soundLevelDbfs:-40,sourceDeviceId:'sensor-a',startUtc:'2026-10-16T12:00:00Z',validMs:1000 };
    const payload = { deviceId:'sensor-a',records:[{ data,key:'sensor-a:interval:1',kind:'interval',schemaVersion:2 }],schemaVersion:2 };
    const post = (token: string,body: unknown = payload) => api.handle(new Request(`${config.origin}/api/v1/families/${familyId}/nursery-delivery`,{ body:JSON.stringify(body),headers:{ Authorization:`Bearer ${token}`,'Content-Type':'application/json' },method:'POST' }));
    expect((await post(first.token)).status).toBe(200); expect((await post(first.token)).status).toBe(200);
    const second = enroll(); expect((await post(first.token)).status).toBe(401); expect((await post(second.token)).status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS n FROM records WHERE collection='nursery'").get()!.n).toBe(1);
    expect((await post(second.token,{ ...payload,records:[{ ...payload.records[0],data:{ ...data,pcm:'forbidden' } }] })).status).toBe(400);
  });

  it('verifies OIDC signatures/audience/nonce and explicitly links a Google subject without email merging',async () => {
    const { privateKey,publicKey } = await generateKeyPair('RS256');
    const jwk = { ...await exportJWK(publicKey),alg:'RS256',kid:'test-key',use:'sig' };
    vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify({ keys:[jwk] }),{ headers:{ 'Content-Type':'application/json' } })));
    const configured = createInternalHandler(db,{ ...config,googleClientId:'test-client.apps.googleusercontent.com' });
    const issued = configured.auth.issueSession('account');
    const cookie = `__Host-babysteps-session=${issued.token}; __Host-babysteps-csrf=${issued.csrf}; __Host-babysteps-flow=test-flow`;
    const post = (path: string,body: unknown) => configured.handle(new Request(`${config.origin}/api/v1${path}`,{ body:JSON.stringify(body),headers:{ Cookie:cookie,'Content-Type':'application/json',Origin:config.origin,'X-Babysteps-CSRF':issued.csrf },method:'POST' }));
    const options = await (await post('/auth/google/options',{})).json();
    const token = await new SignJWT({ email:'contact@example.test',nonce:options.nonce }).setProtectedHeader({ alg:'RS256',kid:'test-key' }).setSubject('verified-sub').setIssuer('https://accounts.google.com').setAudience('test-client.apps.googleusercontent.com').setIssuedAt().setExpirationTime('5m').sign(privateKey);
    expect(token.length).toBeGreaterThan(200);
    const linked = await post('/auth/google/finish',{ challengeId:options.challengeId,token }); expect(linked.status).toBe(200);
    expect(db.prepare("SELECT account_id FROM identities WHERE provider='google' AND subject='verified-sub'").get()!.account_id).toBe('account');
    const badOptions = await configured.auth.googleOptions('other-flow');
    const bad = await new SignJWT({ nonce:badOptions.nonce }).setProtectedHeader({ alg:'RS256',kid:'test-key' }).setSubject('verified-sub').setIssuer('https://accounts.google.com').setAudience('wrong-client').setExpirationTime('5m').sign(privateKey);
    await expect(configured.auth.googleFinish('other-flow',badOptions.challengeId,bad)).rejects.toThrow();
    expect(db.prepare("SELECT COUNT(*) AS n FROM identities WHERE provider='google'").get()!.n).toBe(1);
  });

  it('refuses cross-origin writes, missing CSRF, malformed JWTs and bearer/cookie confusion',async () => {
    const handler = createInternalHandler(db,config,() => time).handle;
    const { token } = owner();
    const call = (path: string,headers: Record<string,string>,body: unknown = {}) => handler(new Request(`${config.origin}/api/v1${path}`,{ body:JSON.stringify(body),headers:{ 'Content-Type':'application/json',...headers },method:'POST' }));
    expect((await call('/families',{ Origin:'https://evil.example.test' })).status).toBe(403);
    const cookie = `__Host-babysteps-session=${token.token}; __Host-babysteps-csrf=${token.csrf}`;
    expect((await call('/families',{ Cookie:cookie,Origin:config.origin },{ parentName:'Alex' })).status).toBe(403);
    expect((await call('/families',{ Cookie:cookie,Origin:config.origin,'X-Babysteps-CSRF':token.csrf },{ parentName:'Alex' })).status).toBe(201);
    expect((await call('/families',{ Authorization:`Bearer ${token.token}` },{ parentName:'Alex' })).status).toBe(401);
    expect((await call('/auth/login/finish',{ Origin:config.origin },{ challengeId:'forged',response:{} })).status).toBe(401);
    expect(db.prepare('SELECT COUNT(*) AS n FROM identities').get()!.n).toBe(0);
  });
});
