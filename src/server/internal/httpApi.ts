/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { NURSERY_SCHEMAS, readNurseryValues } from '../../domain/nurserySensor';
import { parseNurseryBatch } from '../nurseryApi';
import { digest } from './accounts';
import { canonicalJson } from './validation';
import { createAccountService, secret, type AuthConfig, type VerifiedSession } from './accounts';
import { createFamilyRepository, type ChangeCursor } from './familyRepository';
import type { MutationCommand } from '../../domain/internalApi';
import { boundedText, fail, InternalError, object, text } from './validation';

const COOKIE = '__Host-babysteps-session';
const CSRF = '__Host-babysteps-csrf';
const FLOW = '__Host-babysteps-flow';
export const MAX_INTERNAL_BODY = 1_048_576;
function cookies(request: Request) {
  return Object.fromEntries((request.headers.get('cookie') ?? '').split(';').flatMap((entry) => {
    const at = entry.indexOf('='); return at < 0 ? [] : [[entry.slice(0,at).trim(), entry.slice(at+1).trim()]];
  }));
}
function cookie(name: string, value: string, maxAge: number, httpOnly = true) {
  return `${name}=${value}; Path=/; Secure; SameSite=Lax; Max-Age=${maxAge}${httpOnly ? '; HttpOnly' : ''}`;
}
export function validateAuthConfig(config: AuthConfig) {
  const origin = new URL(config.origin);
  if (origin.protocol !== 'https:' || origin.origin !== config.origin || origin.username ||
    !(origin.hostname === config.rpId || origin.hostname.endsWith(`.${config.rpId}`))) throw new Error('Configure a canonical HTTPS origin and matching passkey RP id.');
}

export function createInternalHandler(db: DatabaseSync, config: AuthConfig, clock = () => Date.now()) {
  validateAuthConfig(config);
  const auth = createAccountService(db, config, clock);
  const now = () => new Date(clock()).toISOString();
  async function handle(request: Request, remoteAddress = 'local') {
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { headers, status });
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '');
      const write = !['GET','HEAD'].includes(request.method);
      if (!['GET','POST'].includes(request.method)) return json({ error: 'method' }, 405);
      const nativeBearer = request.headers.get('authorization')?.startsWith('Bearer ') && !request.headers.has('cookie') && !request.headers.has('origin');
      const nativePublic = ['/api/v1/native/start','/api/v1/native/exchange','/api/v1/native/refresh'].includes(path);
      if (write && request.headers.get('origin') !== config.origin && !nativeBearer && !(nativePublic && !request.headers.has('cookie') && !request.headers.has('origin'))) fail('forbidden');
      if (write && !request.headers.get('content-type')?.startsWith('application/json')) fail('invalid');
      auth.rate(`ip:${remoteAddress}`, 180);
      let body: Record<string,unknown> = {};
      if (write) {
        const input = await request.text(); if (Buffer.byteLength(input) > MAX_INTERNAL_BODY) return json({ error: 'too_large' }, 413);
        try { body = object(JSON.parse(input)); } catch { fail('invalid'); }
      }
      const saved = cookies(request);
      const binding = saved[FLOW] ?? secret();
      if (!saved[FLOW]) headers.append('Set-Cookie', cookie(FLOW, binding, 600));
      const bearer = request.headers.get('authorization');
      function principal(): VerifiedSession {
        if (bearer) {
          if (!bearer.startsWith('Bearer ')) fail('unauthorized');
          return auth.session(bearer.slice(7), 'native');
        }
        const csrf = write ? request.headers.get('x-babysteps-csrf') : saved[CSRF];
        if (!csrf) fail('forbidden');
        return auth.session(saved[COOKIE], 'browser', csrf);
      }
      function browser(): VerifiedSession { const user = principal(); if (user.kind !== 'browser') fail('forbidden'); return user; }
      function optionalBrowser() { return saved[COOKIE] ? browser() : undefined; }
      function signedIn(result: ReturnType<typeof auth.issueSession> & { recoveryCodes?: string[] }) {
        headers.append('Set-Cookie', cookie(COOKIE, result.token, 30 * 24 * 3600));
        headers.append('Set-Cookie', cookie(CSRF, result.csrf, 30 * 24 * 3600, false));
        return json({ accountId: result.accountId, csrf: result.csrf, ...(result.recoveryCodes ? { recoveryCodes: result.recoveryCodes } : {}) });
      }
      if (path === '/api/v1/health' && !write) {
        db.prepare('SELECT 1').get(); return json({ ready: true });
      }
      if (path === '/api/v1/config' && !write) return json({ googleClientId: config.googleClientId, registrationOpen: config.registrationOpen });
      if (path.startsWith('/api/v1/auth/') && write) auth.rate(`auth:${remoteAddress}`, 20);
      if (path === '/api/v1/auth/reset' && write) { headers.append('Set-Cookie',cookie(COOKIE,'',0)); headers.append('Set-Cookie',cookie(CSRF,'',0,false)); return json({ reset:true }); }
      if (path === '/api/v1/auth/register/options' && write) return json(await auth.registrationOptions(binding, optionalBrowser(),typeof body.inviteToken === 'string' ? body.inviteToken : undefined));
      if (path === '/api/v1/auth/register/finish' && write) return signedIn(await auth.registrationFinish(binding, text(body.challengeId), body.response as RegistrationResponseJSON, optionalBrowser(),typeof body.inviteToken === 'string' ? body.inviteToken : undefined));
      if (path === '/api/v1/auth/login/options' && write) return json(await auth.loginOptions(binding));
      if (path === '/api/v1/auth/login/finish' && write) return signedIn(await auth.loginFinish(binding, text(body.challengeId), body.response as AuthenticationResponseJSON));
      if (path === '/api/v1/auth/recover' && write) return signedIn(auth.recover(text(body.accountId), text(body.code)));
      if (path === '/api/v1/auth/google/options' && write) return json(await auth.googleOptions(binding, optionalBrowser()));
      if (path === '/api/v1/auth/google/finish' && write) return signedIn(await auth.googleFinish(binding, text(body.challengeId), boundedText(body.token,16384), optionalBrowser()));
      if (path === '/api/v1/native/start' && write) { auth.rate(`pair:${remoteAddress}`, 5); return json(auth.startDevice(typeof body.purpose === 'string' ? body.purpose : undefined,typeof body.sourceDeviceId === 'string' ? body.sourceDeviceId : undefined)); }
      if (path === '/api/v1/native/exchange' && write) return json(auth.exchangeDevice(text(body.deviceCode), text(body.deviceSecret)));
      if (path === '/api/v1/native/refresh' && write) return json(auth.refreshNative(text(body.refreshToken)));
      const user = principal();
      if (request.headers.has('x-babysteps-account') && request.headers.get('x-babysteps-account') !== user.accountId) fail('forbidden');
      auth.rate(`account:${user.accountId}`, 180);
      if (path.startsWith('/api/v1/account/') && user.kind !== 'browser') fail('forbidden');
      function visibleFamilies() {
        return auth.listFamilies(user).filter((family) => { if (user.kind === 'browser') return true; try { auth.checkNativeFamily(user,family.familyId); return true; } catch { return false; } });
      }
      if (path === '/api/v1/session' && !write) return json({ accountId:user.accountId,needsPasskey:user.kind === 'browser' && !auth.credentialList(user).passkeys.length && !auth.credentialList(user).google,csrf:user.kind === 'browser' ? saved[CSRF] : undefined,families:visibleFamilies() });
      if (path === '/api/v1/auth/logout' && write) {
        auth.logout(user); headers.append('Set-Cookie', cookie(COOKIE, '', 0)); headers.append('Set-Cookie', cookie(CSRF, '', 0, false)); return json({ signedOut: true });
      }
      if (path === '/api/v1/account/activity' && !write) return json({ activity:db.prepare('SELECT action, created_at AS createdAt FROM audit_log WHERE account_id=? ORDER BY sequence DESC LIMIT 100').all(user.accountId) });
      if (path === '/api/v1/account/credentials' && !write) return json(auth.credentialList(browser()));
      if (path === '/api/v1/account/credentials/revoke' && write) {
        if (body.provider !== 'google' && body.provider !== 'passkey') fail('invalid');
        auth.revokeCredential(browser(), body.provider, body.id === undefined ? undefined : boundedText(body.id,2048)); return json({ revoked: true });
      }
      if (path === '/api/v1/account/recovery' && write) {
        const owner = browser(); auth.recent(owner); return json({ accountId: owner.accountId, recoveryCodes: auth.atomic(() => auth.recoveryCodes(owner.accountId)) });
      }
      if (path === '/api/v1/account/sessions' && !write) return json({ sessions: db.prepare('SELECT id, created_at AS createdAt, expires_at AS expiresAt FROM sessions WHERE account_id=? AND revoked_at IS NULL').all(user.accountId),
        devices: db.prepare('SELECT id, family_id AS familyId, created_at AS createdAt FROM native_installations WHERE account_id=? AND revoked_at IS NULL').all(user.accountId) });
      if (path === '/api/v1/account/revoke' && write) {
        const owner = browser(); auth.recent(owner);
        if (body.installationId) {
          if (!db.prepare('SELECT 1 FROM native_installations WHERE id=? AND account_id=?').get(text(body.installationId), owner.accountId)) fail('not-found');
          auth.revokeInstallation(text(body.installationId));
        } else {
          const native = db.prepare(`SELECT n.installation_id FROM native_sessions n JOIN sessions s ON s.id=n.session_id WHERE s.id=? AND s.account_id=?`).get(text(body.sessionId),owner.accountId);
          if (native) auth.revokeInstallation(String(native.installation_id));
          else db.prepare('UPDATE sessions SET revoked_at=? WHERE id=? AND account_id=?').run(now(),text(body.sessionId),owner.accountId);
        }
        auth.audit('session.revoked', owner.accountId); return json({ revoked: true });
      }
      if (path === '/api/v1/families' && !write) return json({ families:visibleFamilies() });
      if (path === '/api/v1/families' && write) return json(auth.createFamily(browser(), body), 201);
      if (path === '/api/v1/invitations/accept' && write) return json(auth.acceptInvite(browser(), text(body.token)));
      if (path === '/api/v1/native/preview' && write) { browser(); return json(auth.previewDevice(text(body.userCode))); }
      if (path === '/api/v1/native/approve' && write) { auth.approveDevice(browser(), text(body.familyId), text(body.userCode)); return json({ approved: true }); }
      const match = /^\/api\/v1\/families\/([^/]+)\/(bootstrap|mutations|changes|nursery|nursery-delivery|nursery-status|invitations)$/.exec(path);
      if (!match) return json({ error: 'not-found' }, 404);
      const familyId = decodeURIComponent(match[1]); const route = match[2];
      const capabilities = user.kind === 'native' ? auth.checkNativeFamily(user, familyId) : ['phone'];
      if (capabilities.includes('watch') && route !== 'bootstrap' && !(route === 'mutations' && body.collection === 'events' && body.action === 'save' && body.expectedRevision === 0 && ['feed','diaper'].includes(String(object(body.patch).type)))) fail('forbidden');
      if (capabilities.includes('nursery') && !['nursery-delivery','nursery-status'].includes(route)) fail('forbidden');
      const repository = createFamilyRepository(db, familyId, user, now);
      if (route === 'nursery-delivery' && write) {
        if (user.kind !== 'native' || !capabilities.includes('nursery')) fail('forbidden');
        const batch = parseNurseryBatch(body); if (!batch.ok) fail('invalid');
        const installation = db.prepare('SELECT i.source_device_id FROM native_sessions s JOIN native_installations i ON i.id=s.installation_id WHERE s.session_id=?').get(user.sessionId)!;
        if (body.deviceId !== installation.source_device_id) fail('forbidden');
        const acceptedKeys: string[] = [];
        for (const record of batch.records) {
          const id = digest(`${installation.source_device_id}:${record.key}`);
          const patch = { data:record.data,id,kind:record.kind };
          const operationId = `nursery:${digest(canonicalJson(patch))}`;
          const receipt = db.prepare('SELECT response_json FROM operations WHERE family_id=? AND operation_id=?').get(familyId,operationId);
          const revision = receipt ? Number(JSON.parse(String(receipt.response_json)).revision) - 1 : Number(db.prepare("SELECT revision FROM records WHERE family_id=? AND collection='nursery' AND id=?").get(familyId,id)?.revision ?? 0);
          repository.mutation({ action:'save',collection:'nursery',expectedRevision:revision,id,operationId,patch });
          acceptedKeys.push(record.key);
        }
        return json({ acceptedKeys,ok:true });
      }
      if (route === 'nursery-status' && !write) {
        const data = repository.bootstrap(true).data;
        const children = data.profiles ?? [data.profile];
        const child = children.length === 1 ? children[0] : undefined;
        const events = child ? [...data.events].filter((e) => e.babyId === child.id).sort((a,b) => b.startedAt.localeCompare(a.startedAt)) : [];
        const feed = events.find((e) => e.type === 'feed'); const diaper = events.find((e) => e.type === 'diaper');
        return json({ ok:true,child:child?.name,lastDiaper:diaper ? { at:diaper.startedAt,kind:diaper.type === 'diaper' ? diaper.kind : undefined }:null,
          lastFeed:feed ? { amountOz:feed.type === 'feed' ? feed.amountOz : undefined,at:feed.startedAt,method:feed.type === 'feed' ? feed.method : undefined }:null,lastCry:null });
      }
      if (route === 'bootstrap' && !write) {
        const result = repository.bootstrap(capabilities.includes('watch'));
        if (capabilities.includes('watch')) {
          result.data.profiles = result.data.profiles!.map((p) => ({ createdAt:p.createdAt,familyId:p.familyId,id:p.id,kind:p.kind,name:p.name,timezone:p.timezone,updatedAt:p.updatedAt }));
          result.data.profile = result.data.profiles[0];
          result.data.events = result.data.events.filter((event) => ['feed','diaper','sleep'].includes(event.type));
        }
        return json(result);
      }
      if (route === 'mutations' && write) return json(repository.mutation(body as unknown as MutationCommand));
      if (route === 'changes' && !write) {
        let cursor: ChangeCursor | undefined;
        try { cursor = url.searchParams.has('cursor') ? object(JSON.parse(url.searchParams.get('cursor')!)) as unknown as ChangeCursor : undefined; } catch { fail('invalid'); }
        return json(repository.changes(cursor, Number(url.searchParams.get('limit') ?? 100)));
      }
      if (route === 'nursery' && !write) {
        const records = repository.nurseryData();
        const values = (kind: 'night' | 'episode') => { const columns = NURSERY_SCHEMAS[kind].columns; return [[...columns],...records.filter((r) => r.kind === kind).map((r) => columns.map((key) => object(r.data)[key] ?? null))]; };
        return json({ records,nursery:readNurseryValues(values('night'),values('episode')) });
      }
      if (route === 'invitations' && write) return json(auth.invite(browser(), familyId, text(body.profileId)));
      return json({ error: 'method' }, 405);
    } catch (error) {
      if (error instanceof InternalError) return json({ error: error.code }, {
        conflict: 409, 'expired-cursor': 410, forbidden: 403, invalid: 400, 'not-found': 404, 'rate-limited': 429, unauthorized: 401
      }[error.code]);
      if (error && typeof error === 'object' && 'code' in error && String(error.code).startsWith('ERR_SQLITE')) {
        const constraint = 'errcode' in error && (Number(error.errcode) & 255) === 19;
        return json({ error:constraint ? 'conflict':'unavailable' },constraint ? 409:503);
      }
      // Malformed WebAuthn/JWT responses reveal no verification details.
      return json({ error: 'request_failed' }, 400);
    }
  }
  return { auth, handle };
}
