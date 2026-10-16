import { useEffect, useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { showInternalGoogle } from '../storage/internalGoogle';
import { internalRequest } from '../storage/internalClient';

export function InternalSignIn({ api, onSignedIn, onRecovery }: { api: string; onSignedIn: () => Promise<void>; onRecovery: (codes: string[], accountId: string) => void }) {
  const [configuration,setConfiguration] = useState<{ googleClientId?:string; registrationOpen:boolean }>();
  useEffect(() => { void internalRequest<{ googleClientId?:string; registrationOpen:boolean }>(api,'/config').then(setConfiguration).catch(() => {}); },[api]);
  const [signupLink,setSignupLink] = useState(() => new URLSearchParams(window.location.hash.slice(1)));
  useEffect(() => {
    const changed = () => setSignupLink(new URLSearchParams(window.location.hash.slice(1)));
    window.addEventListener('hashchange',changed);
    return () => window.removeEventListener('hashchange',changed);
  },[]);
  const setupToken = signupLink.get('setup') ?? undefined;
  const invited = Boolean(signupLink.get('invite') || setupToken);
  const [error,setError] = useState(''); const [busy,setBusy] = useState(false);
  const [accountId,setAccountId] = useState(''); const [code,setCode] = useState('');
  const [recover,setRecover] = useState(false);
  async function run(action: () => Promise<void>) { setError(''); setBusy(true); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Sign-in failed'); } finally { setBusy(false); } }
  async function passkey(register: boolean) {
    const result = register ? await internalRequest<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>(api,'/auth/register/options',{ setupToken,inviteToken:new URLSearchParams(window.location.hash.slice(1)).get('invite') ?? undefined }) :
      await internalRequest<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>(api,'/auth/login/options',{});
    const response = register ? await startRegistration({ optionsJSON: result.options as PublicKeyCredentialCreationOptionsJSON }) :
      await startAuthentication({ optionsJSON: result.options as PublicKeyCredentialRequestOptionsJSON });
    const signed = await internalRequest<{ accountId: string; recoveryCodes?: string[] }>(api,`/auth/${register ? 'register':'login'}/finish`,{ challengeId: result.challengeId,response,setupToken,inviteToken:new URLSearchParams(window.location.hash.slice(1)).get('invite') ?? undefined });
    if (setupToken) window.history.replaceState(null,'',window.location.pathname);
    if (signed.recoveryCodes) onRecovery(signed.recoveryCodes,signed.accountId);
    await onSignedIn();
  }
  async function google() {
    await showInternalGoogle(api,document.getElementById('internal-google-button')!,onSignedIn,(error) => setError(error instanceof Error ? error.message : 'Google sign-in failed'));
  }
  return <main className="splash-screen"><section className="splash-panel">
    <p className="eyebrow">BabySteps</p><h1>Your family, together</h1><p>Sign in with a passkey to open your family’s log.</p>
    {error && <p role="alert" className="error-banner">{error}</p>}
    <button type="button" className="primary-button" disabled={busy} onClick={() => void run(() => passkey(false))}>Sign in with a passkey</button>
    <button type="button" className="secondary-button" disabled={busy || (!configuration?.registrationOpen && !invited)} onClick={() => void run(() => passkey(true))}>Create a BabySteps account</button>
    {!configuration?.registrationOpen && !invited && <p>To create an account, open an invitation from a parent.</p>}
    {configuration?.googleClientId && <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(google)}>Use linked Google account</button>}<div id="internal-google-button" />
    <button type="button" className="secondary-button" onClick={() => void run(async () => { await internalRequest(api,'/auth/reset',{}); setError('Choose your sign-in method.'); })}>Use another account</button>
    <button type="button" className="secondary-button" onClick={() => setRecover(!recover)}>Use a recovery code</button>
    {recover && <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void run(async () => {
      await internalRequest(api,'/auth/recover',{ accountId,code }); setCode(''); await onSignedIn();
    }); }}><label>Account ID<input required value={accountId} onChange={(e) => setAccountId(e.target.value)} autoComplete="username" /></label>
      <label>Recovery code<input required value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" /></label><button disabled={busy} className="primary-button">Recover account</button></form>}
  </section></main>;
}
