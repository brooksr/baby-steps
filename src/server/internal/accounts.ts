/// <reference types="node" />
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON } from '@simplewebauthn/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createFamilyProfile } from '../../domain/family';
import type { AccountPrincipal } from './types';
import { boundedText, fail, text } from './validation';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export interface AuthConfig {
  bootstrapTokenHash?: string;
  googleClientId?: string;
  origin: string;
  registrationOpen: boolean;
  rpId: string;
}
export interface VerifiedSession extends AccountPrincipal {
  authenticatedAt: string;
  kind: 'browser' | 'native';
}
const MAX_AGE = 30 * 24 * 3600_000;
const IDLE_AGE = 7 * 24 * 3600_000;

/** All credential verification is delegated to SimpleWebAuthn/jose. */
export function createAccountService(db: DatabaseSync, config: AuthConfig, clock = () => Date.now()) {
  const iso = () => new Date(clock()).toISOString();
  const expires = (ms: number) => new Date(clock() + ms).toISOString();
  const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  function atomic<T>(work: () => T) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function audit(action: string, accountId?: string, familyId?: string) {
    db.prepare('INSERT INTO audit_log (account_id, family_id, action, created_at) VALUES (?, ?, ?, ?)').run(accountId ?? null, familyId ?? null, action, iso());
  }
  function rate(key: string, maximum = 20, windowMs = 60_000) {
    const hash = digest(key); const start = Math.floor(clock() / windowMs);
    db.prepare(`INSERT INTO rate_limits VALUES (?, ?, 1) ON CONFLICT(key_hash) DO UPDATE SET
      attempts = CASE WHEN window_start = excluded.window_start THEN attempts + 1 ELSE 1 END, window_start = excluded.window_start`).run(hash, start);
    if (Number(db.prepare('SELECT attempts FROM rate_limits WHERE key_hash = ?').get(hash)!.attempts) > maximum) fail('rate-limited');
  }
  function challenge(kind: string, binding: string, value: string, accountId?: string) {
    const id = randomUUID();
    db.prepare('INSERT INTO auth_challenges VALUES (?, ?, ?, ?, ?, ?, NULL)').run(id, kind, accountId ?? null, value, digest(binding), expires(5 * 60_000));
    return id;
  }
  function consume(id: string, binding: string, kind: string) {
    const row = db.prepare(`UPDATE auth_challenges SET consumed_at = ? WHERE id = ? AND kind = ? AND binding_hash = ?
      AND consumed_at IS NULL AND expires_at > ? RETURNING *`).get(iso(), id, kind, digest(binding), iso());
    if (!row) fail('unauthorized'); return row;
  }
  function issueSession(accountId: string, kind: 'browser' | 'native' = 'browser') {
    const token = secret(); const csrf = secret(); const id = randomUUID();
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, NULL)').run(id, accountId, digest(token), iso(), expires(kind === 'native' ? 15 * 60_000 : MAX_AGE));
    db.prepare('INSERT INTO session_details VALUES (?, ?, ?, ?, ?)').run(id, digest(csrf), iso(), iso(), kind);
    audit('session.created', accountId);
    return { accountId, csrf, expiresAt: expires(kind === 'native' ? 15 * 60_000 : MAX_AGE), sessionId: id, token };
  }
  function session(token: string | undefined, kind: 'browser' | 'native', csrf?: string): VerifiedSession {
    if (!token) fail('unauthorized');
    const row = db.prepare(`SELECT s.id, s.account_id, s.expires_at, d.csrf_hash, d.last_seen_at, d.authenticated_at, d.kind
      FROM sessions s JOIN accounts a ON a.id = s.account_id JOIN session_details d ON d.session_id = s.id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND a.disabled_at IS NULL`).get(digest(token));
    if (!row || row.kind !== kind || String(row.expires_at) <= iso() || Date.parse(String(row.last_seen_at)) + IDLE_AGE <= clock()) fail('unauthorized');
    if (csrf !== undefined && digest(csrf) !== row.csrf_hash) fail('forbidden');
    db.prepare('UPDATE session_details SET last_seen_at = ? WHERE session_id = ?').run(iso(), String(row.id));
    return { accountId: String(row.account_id), authenticatedAt: String(row.authenticated_at), kind, sessionId: String(row.id) };
  }
  function recent(principal: VerifiedSession) {
    if (Date.parse(principal.authenticatedAt) + 10 * 60_000 < clock() || !db.prepare(`SELECT 1 FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.id=? AND s.account_id=? AND s.revoked_at IS NULL AND s.expires_at>? AND a.disabled_at IS NULL`).get(principal.sessionId,principal.accountId,iso())) fail('unauthorized');
  }
  function recoveryCodes(accountId: string) {
    const codes = Array.from({ length: 10 }, () => secret());
    db.prepare('DELETE FROM recovery_codes WHERE account_id = ?').run(accountId);
    for (const code of codes) db.prepare('INSERT INTO recovery_codes VALUES (?, ?, NULL)').run(accountId, digest(code));
    return codes;
  }
  function checkSignup(principal?: VerifiedSession, inviteToken?: string, setupToken?: string) {
    if (principal || config.registrationOpen) return;
    if (setupToken && config.bootstrapTokenHash && digest(setupToken) === config.bootstrapTokenHash &&
      !db.prepare('SELECT 1 FROM accounts LIMIT 1').get()) return;
    if (!inviteToken || !db.prepare('SELECT 1 FROM invitations WHERE token_hash=? AND accepted_by IS NULL AND expires_at>?').get(digest(inviteToken),iso())) fail('forbidden');
  }
  async function registrationOptions(binding: string, principal?: VerifiedSession, inviteToken?: string, setupToken?: string) {
    checkSignup(principal,inviteToken,setupToken);
    if (principal) recent(principal);
    const accountId = principal?.accountId ?? randomUUID();
    const existing = db.prepare('SELECT credential_id FROM passkeys WHERE account_id = ? AND revoked_at IS NULL').all(accountId);
    const options = await generateRegistrationOptions({ attestationType: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: existing.map((row) => ({ id: String(row.credential_id) })), rpID: config.rpId, rpName: 'BabySteps',
      supportedAlgorithmIDs: [-7, -257], userID: new TextEncoder().encode(accountId), userName: `BabySteps ${accountId.slice(0,8)}` });
    const kind = principal ? 'add-passkey' : inviteToken ? `register:${digest(inviteToken)}` : setupToken ? `setup:${digest(setupToken)}` : 'register';
    return { challengeId: challenge(kind, binding, options.challenge, accountId), options };
  }
  async function registrationFinish(binding: string, challengeId: string, response: RegistrationResponseJSON, principal?: VerifiedSession, inviteToken?: string, setupToken?: string) {
    if (principal) recent(principal);
    const saved = consume(challengeId, binding, principal ? 'add-passkey' : inviteToken ? `register:${digest(inviteToken)}` : setupToken ? `setup:${digest(setupToken)}` : 'register');
    if (principal && saved.account_id !== principal.accountId) fail('forbidden');
    checkSignup(principal,inviteToken,setupToken);
    const result = await verifyRegistrationResponse({ expectedChallenge: String(saved.challenge), expectedOrigin: config.origin,
      expectedRPID: config.rpId, requireUserVerification: true, response });
    if (!result.verified || !result.registrationInfo) fail('unauthorized');
    const credential = result.registrationInfo.credential;
    return atomic(() => {
      const accountId = String(saved.account_id);
      checkSignup(principal,inviteToken,setupToken);
      if (!principal) db.prepare('INSERT INTO accounts VALUES (?, ?, NULL)').run(accountId, iso());
      else recent(principal);
      db.prepare('INSERT INTO passkeys VALUES (?, ?, ?, ?, ?, ?, NULL)').run(credential.id, accountId, credential.publicKey, credential.counter, JSON.stringify(credential.transports ?? []), iso());
      db.prepare("INSERT OR IGNORE INTO identities VALUES ('passkey', ?, ?, ?)").run(accountId, accountId, iso());
      audit('passkey.registered', accountId);
      const codes = principal ? undefined : recoveryCodes(accountId);
      return { ...issueSession(accountId), ...(codes ? { recoveryCodes: codes } : {}) };
    });
  }
  async function loginOptions(binding: string) {
    const options = await generateAuthenticationOptions({ rpID: config.rpId, userVerification: 'required' });
    return { challengeId: challenge('login', binding, options.challenge), options };
  }
  async function loginFinish(binding: string, challengeId: string, response: AuthenticationResponseJSON) {
    const saved = consume(challengeId, binding, 'login');
    const credential = db.prepare(`SELECT p.* FROM passkeys p JOIN accounts a ON a.id = p.account_id
      WHERE p.credential_id = ? AND p.revoked_at IS NULL AND a.disabled_at IS NULL`).get(boundedText(response.id,2048));
    if (!credential) fail('unauthorized');
    const result = await verifyAuthenticationResponse({ credential: { counter: Number(credential.sign_count), id: String(credential.credential_id),
      publicKey: new Uint8Array(credential.public_key as Uint8Array), transports: JSON.parse(String(credential.transports_json)) },
      expectedChallenge: String(saved.challenge), expectedOrigin: config.origin, expectedRPID: config.rpId, requireUserVerification: true, response });
    if (!result.verified) fail('unauthorized');
    return atomic(() => {
      // Credential revocation during async verification must still win.
      if (!db.prepare(`SELECT 1 FROM passkeys p JOIN accounts a ON a.id=p.account_id
        WHERE p.credential_id=? AND p.revoked_at IS NULL AND a.disabled_at IS NULL`).get(String(credential.credential_id))) fail('unauthorized');
      const updated = db.prepare('UPDATE passkeys SET sign_count = ? WHERE credential_id = ? AND sign_count = ?')
        .run(result.authenticationInfo.newCounter, String(credential.credential_id), Number(credential.sign_count));
      if (!updated.changes) fail('unauthorized');
      return issueSession(String(credential.account_id));
    });
  }
  function recover(accountId: string, code: string) {
    rate(`recover:${accountId}`, 5, 3600_000);
    return atomic(() => {
      if (!db.prepare('SELECT 1 FROM accounts WHERE id = ? AND disabled_at IS NULL').get(accountId)) fail('unauthorized');
      const used = db.prepare('UPDATE recovery_codes SET used_at = ? WHERE account_id = ? AND code_hash = ? AND used_at IS NULL').run(iso(), accountId, digest(code));
      if (!used.changes) fail('unauthorized');
      db.prepare('UPDATE sessions SET revoked_at = ? WHERE account_id = ?').run(iso(), accountId);
      db.prepare('UPDATE passkeys SET revoked_at = ? WHERE account_id = ?').run(iso(),accountId);
      db.prepare("DELETE FROM identities WHERE provider='google' AND account_id=?").run(accountId);
      db.prepare('UPDATE native_installations SET revoked_at=? WHERE account_id=?').run(iso(),accountId);
      // The remaining codes stay usable so one lost reply cannot strand the account.
      audit('account.recovered', accountId);
      return issueSession(accountId);
    });
  }
  function logout(principal: AccountPrincipal) {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND account_id = ?').run(iso(), principal.sessionId, principal.accountId);
    audit('session.revoked', principal.accountId);
  }
  function listFamilies(principal: AccountPrincipal) {
    return db.prepare(`SELECT m.family_id AS familyId, m.role, p.payload FROM memberships m
      JOIN profiles p ON p.family_id = m.family_id AND p.id = m.profile_id WHERE m.account_id = ? AND m.revoked_at IS NULL`).all(principal.accountId)
      .filter((row) => !JSON.parse(String(row.payload)).archivedAt)
      .map((row) => ({ familyId: String(row.familyId), name: String(JSON.parse(String(row.payload)).name), role: row.role }));
  }
  function createFamily(principal: VerifiedSession, input: Record<string,unknown>) {
    recent(principal); text(input.parentName);
    return atomic(() => {
      const familyId = randomUUID();
      const parent = createFamilyProfile({ kind: 'parent', name: String(input.parentName), ...(typeof input.timezone === 'string' ? { timezone:input.timezone } : {}), parentRole: ['dad','mom'].includes(String(input.parentRole)) ? input.parentRole as 'dad' | 'mom' : 'parent' }, []);
      parent.familyId = familyId;
      db.prepare('INSERT INTO families VALUES (?, ?, NULL)').run(familyId, iso());
      db.prepare('INSERT INTO profiles VALUES (?, ?, ?, 1)').run(familyId, parent.id, JSON.stringify(parent));
      db.prepare('INSERT INTO memberships VALUES (?, ?, ?, ?, ?, NULL)').run(familyId, principal.accountId, parent.id, 'parent', iso());
      if (typeof input.childName === 'string' && input.childName.trim()) {
        const child = createFamilyProfile({ kind: 'child', name: input.childName, timezone:parent.timezone, ...(typeof input.dueDate === 'string' && input.dueDate ? { dueDate: input.dueDate } : {}) }, [parent]);
        child.familyId = familyId; db.prepare('INSERT INTO profiles VALUES (?, ?, ?, 1)').run(familyId, child.id, JSON.stringify(child));
      }
      audit('family.created', principal.accountId, familyId); return { familyId };
    });
  }
  async function googleOptions(binding: string, principal?: VerifiedSession) {
    if (!config.googleClientId) fail('not-found');
    if (principal) recent(principal);
    const nonce = secret();
    return { challengeId: challenge(principal ? 'google-link' : 'google-login', binding, nonce, principal?.accountId), clientId: config.googleClientId, nonce };
  }
  async function googleFinish(binding: string, challengeId: string, token: string, principal?: VerifiedSession) {
    if (!config.googleClientId) fail('not-found');
    if (principal) recent(principal);
    const saved = consume(challengeId, binding, principal ? 'google-link' : 'google-login');
    if (principal && saved.account_id !== principal.accountId) fail('forbidden');
    const { payload } = await jwtVerify(token, jwks, { algorithms:['RS256'],audience: config.googleClientId, issuer: ['https://accounts.google.com','accounts.google.com'] });
    if (!payload.sub || payload.nonce !== saved.challenge) fail('unauthorized');
    return atomic(() => {
      const existing = db.prepare("SELECT account_id FROM identities WHERE provider='google' AND subject=?").get(payload.sub!);
      if (principal) {
        recent(principal);
        if (existing && existing.account_id !== principal.accountId) fail('conflict');
        db.prepare("INSERT OR IGNORE INTO identities VALUES ('google', ?, ?, ?)").run(payload.sub!, principal.accountId, iso());
        audit('google.linked', principal.accountId); return issueSession(principal.accountId);
      }
      if (!existing || !db.prepare('SELECT 1 FROM accounts WHERE id=? AND disabled_at IS NULL').get(String(existing.account_id))) fail('unauthorized');
      return issueSession(String(existing.account_id));
    });
  }
  function credentialList(principal: VerifiedSession) {
    return { passkeys: db.prepare('SELECT credential_id AS id, created_at AS createdAt FROM passkeys WHERE account_id=? AND revoked_at IS NULL').all(principal.accountId),
      google: Boolean(db.prepare("SELECT 1 FROM identities WHERE account_id=? AND provider='google'").get(principal.accountId)) };
  }
  function revokeCredential(principal: VerifiedSession, provider: 'passkey' | 'google', id?: string) {
    recent(principal);
    atomic(() => {
      const count = Number(db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE account_id=? AND revoked_at IS NULL').get(principal.accountId)!.n) +
        Number(db.prepare("SELECT COUNT(*) AS n FROM identities WHERE account_id=? AND provider='google'").get(principal.accountId)!.n);
      if (count <= 1) fail('conflict');
      if (provider === 'google') db.prepare("DELETE FROM identities WHERE account_id=? AND provider='google'").run(principal.accountId);
      else db.prepare('UPDATE passkeys SET revoked_at=? WHERE account_id=? AND credential_id=?').run(iso(), principal.accountId, boundedText(id,2048));
      audit('credential.revoked', principal.accountId);
    });
  }
  function invite(principal: VerifiedSession, familyId: string, profileId: string) {
    recent(principal);
    const owner = db.prepare(`SELECT m.role, p.payload FROM memberships m JOIN profiles p ON p.family_id=m.family_id AND p.id=m.profile_id
      WHERE m.family_id=? AND m.account_id=? AND m.revoked_at IS NULL`).get(familyId, principal.accountId);
    if (!owner || owner.role !== 'parent' || JSON.parse(String(owner.payload)).archivedAt) fail('forbidden');
    const target = db.prepare('SELECT payload FROM profiles WHERE family_id=? AND id=?').get(familyId, profileId);
    if (!target) fail('not-found');
    const person = JSON.parse(String(target.payload));
    if (!['parent','caregiver'].includes(person.kind) || person.archivedAt) fail('invalid');
    const token = secret();
    db.prepare('INSERT INTO invitations VALUES (?, ?, ?, ?, ?, NULL, ?)').run(digest(token), familyId, profileId, person.kind, expires(48 * 3600_000), principal.accountId);
    audit('invite.created', principal.accountId, familyId); return { expiresAt: expires(48 * 3600_000), token };
  }
  function acceptInvite(principal: VerifiedSession, token: string) {
    recent(principal);
    return atomic(() => {
      const row = db.prepare('SELECT * FROM invitations WHERE token_hash=? AND accepted_by IS NULL AND expires_at>?').get(digest(token), iso());
      if (!row) fail('not-found');
      const person = db.prepare('SELECT payload FROM profiles WHERE family_id=? AND id=?').get(String(row.family_id), String(row.profile_id));
      if (!person || JSON.parse(String(person.payload)).archivedAt || JSON.parse(String(person.payload)).kind !== row.role) fail('forbidden');
      db.prepare('INSERT INTO memberships VALUES (?, ?, ?, ?, ?, NULL)').run(String(row.family_id), principal.accountId, String(row.profile_id), String(row.role), iso());
      db.prepare('UPDATE invitations SET accepted_by=? WHERE token_hash=?').run(principal.accountId, digest(token));
      audit('invite.accepted', principal.accountId, String(row.family_id)); return { familyId: String(row.family_id) };
    });
  }
  function startDevice(purpose: string = 'phone',sourceDeviceId = randomUUID() as string) {
    if (!['phone','watch','nursery'].includes(purpose) || !/^[a-zA-Z0-9-]{1,80}$/.test(sourceDeviceId)) fail('invalid');
    const id = randomUUID(); const deviceSecret = secret(); const userCode = randomBytes(5).toString('hex').toUpperCase();
    db.prepare('INSERT INTO device_grants (id, secret_hash, user_code_hash, expires_at, purpose, source_device_id) VALUES (?, ?, ?, ?, ?, ?)').run(id, digest(deviceSecret), digest(userCode), expires(10 * 60_000), purpose,sourceDeviceId);
    return { deviceCode: id, deviceSecret, expiresAt: expires(10 * 60_000), userCode };
  }
  function previewDevice(userCode: string) {
    const row = db.prepare('SELECT purpose, expires_at AS expiresAt FROM device_grants WHERE user_code_hash=? AND consumed_at IS NULL AND account_id IS NULL AND expires_at>?').get(digest(userCode.trim().toUpperCase()),iso());
    if (!row) fail('not-found'); return row;
  }
  function approveDevice(principal: VerifiedSession, familyId: string, userCode: string) {
    recent(principal);
    const family = listFamilies(principal).find((f) => f.familyId === familyId);
    if (!family) fail('forbidden');
    const grant = db.prepare('SELECT purpose FROM device_grants WHERE user_code_hash=?').get(digest(userCode.trim().toUpperCase()));
    if (grant?.purpose === 'nursery' && family.role !== 'parent') fail('forbidden');
    const result = db.prepare(`UPDATE device_grants SET account_id=?, family_id=? WHERE user_code_hash=? AND expires_at>? AND account_id IS NULL AND consumed_at IS NULL`)
      .run(principal.accountId, familyId, digest(userCode.trim().toUpperCase()), iso());
    if (!result.changes) fail('not-found');
    audit('device.approved', principal.accountId, familyId);
  }
  function nativeTokens(installationId: string) {
    const installation = db.prepare('SELECT * FROM native_installations WHERE id=? AND revoked_at IS NULL').get(installationId);
    if (!installation) fail('unauthorized');
    const result = issueSession(String(installation.account_id), 'native');
    db.prepare('INSERT INTO native_sessions VALUES (?, ?)').run(result.sessionId, installationId);
    const refreshToken = secret();
    db.prepare('INSERT INTO native_refresh VALUES (?, ?, ?, NULL)').run(digest(refreshToken), installationId, expires(90 * 24 * 3600_000));
    return { ...result, familyId: String(installation.family_id), installationId, refreshToken,sourceDeviceId:String(installation.source_device_id) };
  }
  function exchangeDevice(id: string, deviceSecret: string) {
    return atomic(() => {
      const row = db.prepare('SELECT * FROM device_grants WHERE id=? AND secret_hash=? AND expires_at>? AND consumed_at IS NULL').get(id, digest(deviceSecret), iso());
      if (!row) fail('unauthorized');
      if (!row.account_id || !row.family_id) return { pending: true };
      const installationId = randomUUID();
      const sourceDeviceId = String(row.source_device_id ?? installationId);
      const previous = db.prepare('SELECT account_id FROM native_installations WHERE family_id=? AND source_device_id=?').all(String(row.family_id),sourceDeviceId);
      if (previous.some((device) => device.account_id !== row.account_id)) fail('conflict');
      for (const old of db.prepare('SELECT id FROM native_installations WHERE family_id=? AND source_device_id=?').all(String(row.family_id),sourceDeviceId)) revokeInstallation(String(old.id));
      db.prepare("INSERT INTO native_installations (id,account_id,family_id,capabilities_json,created_at,revoked_at,source_device_id) VALUES (?, ?, ?, ?, ?, NULL, ?)")
        .run(installationId,String(row.account_id),String(row.family_id),JSON.stringify([row.purpose]),iso(),sourceDeviceId);
      db.prepare('UPDATE device_grants SET consumed_at=? WHERE id=?').run(iso(), id);
      return nativeTokens(installationId);
    });
  }
  function refreshNative(refreshToken: string) {
    const row = db.prepare('SELECT * FROM native_refresh WHERE token_hash=?').get(digest(refreshToken));
    if (!row) fail('unauthorized');
    if (row.used_at) { revokeInstallation(String(row.installation_id)); fail('unauthorized'); }
    return atomic(() => {
      if (String(row.expires_at) <= iso()) fail('unauthorized');
      const installation = db.prepare('SELECT * FROM native_installations WHERE id=? AND revoked_at IS NULL').get(String(row.installation_id));
      if (!installation || !db.prepare('SELECT 1 FROM accounts WHERE id=? AND disabled_at IS NULL').get(String(installation.account_id))) fail('unauthorized');
      if (!listFamilies({ accountId: String(installation.account_id), sessionId: '' }).some((f) => f.familyId === installation.family_id)) fail('forbidden');
      db.prepare('UPDATE native_refresh SET used_at=? WHERE token_hash=?').run(iso(), digest(refreshToken));
      db.prepare(`UPDATE sessions SET revoked_at=? WHERE id IN (SELECT session_id FROM native_sessions WHERE installation_id=?)`).run(iso(), String(row.installation_id));
      return nativeTokens(String(row.installation_id));
    });
  }
  function revokeInstallation(id: string) {
    db.prepare('UPDATE native_installations SET revoked_at=? WHERE id=?').run(iso(), id);
    db.prepare('UPDATE sessions SET revoked_at=? WHERE id IN (SELECT session_id FROM native_sessions WHERE installation_id=?)').run(iso(), id);
  }
  function checkNativeFamily(principal: AccountPrincipal, familyId: string) {
    const row = db.prepare(`SELECT i.capabilities_json FROM native_sessions s JOIN native_installations i ON i.id=s.installation_id
      WHERE s.session_id=? AND i.account_id=? AND i.family_id=? AND i.revoked_at IS NULL`).get(principal.sessionId, principal.accountId, familyId);
    if (!row) fail('forbidden');
    return JSON.parse(String(row.capabilities_json)) as string[];
  }
  return { acceptInvite, approveDevice, previewDevice, checkNativeFamily, exchangeDevice, invite, refreshNative, revokeInstallation, startDevice, atomic, audit, challenge, consume, createFamily, credentialList, googleFinish, googleOptions, issueSession, listFamilies, loginFinish, loginOptions,
    logout, rate, recent, recover, recoveryCodes, registrationFinish, registrationOptions, revokeCredential, session };
}
