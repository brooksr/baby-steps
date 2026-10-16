import { internalRequest } from './internalClient';
interface GoogleApi { accounts: { id: { initialize(options: { callback: (result: { credential: string }) => void; client_id: string; nonce: string }): void;
  renderButton(element: HTMLElement, options: { theme: string; size: string }): void } } }
/** Google is linked only to an already authenticated BabySteps account; server verifies OIDC. */
export async function showInternalGoogle(api: string,element: HTMLElement,onComplete: () => Promise<void>,onError: (error: unknown) => void) {
  const options = await internalRequest<{ challengeId:string; clientId:string; nonce:string }>(api,'/auth/google/options',{});
  if (!(window as unknown as { google?:GoogleApi }).google) await new Promise<void>((resolve,reject) => {
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.onload = () => resolve(); script.onerror = () => reject(new Error('Could not load Google sign-in')); document.head.appendChild(script);
  });
  const google = (window as unknown as { google:GoogleApi }).google;
  google.accounts.id.initialize({ client_id:options.clientId,nonce:options.nonce,callback:({ credential }) => {
    void internalRequest(api,'/auth/google/finish',{ challengeId:options.challengeId,token:credential }).then(onComplete).catch(onError);
  } });
  google.accounts.id.renderButton(element,{ size:'large',theme:'outline' });
}
