import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { InternalRequestError, internalRequest } from './internalClient';

/** The passkey that confirmed it belongs to another account, which this browser is now signed in to. */
export class OtherAccountError extends Error {
  constructor() { super('That passkey is for a different BabySteps account. Sign out, then sign in with yours.'); this.name = 'OtherAccountError'; }
}

/**
 * Approving a device, inviting someone and changing sign-in methods need a sign-in from the last
 * ten minutes, and the server answers an older one with 401. Confirm with a passkey once and retry,
 * rather than leaving a bare "unauthorized" on the screen.
 */
export async function withRecentSignIn<T>(api: string, accountId: string, action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (error) {
    if (!(error instanceof InternalRequestError) || error.status !== 401) throw error;
  }
  let signed: { accountId: string };
  try {
    const options = await internalRequest<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>(api,'/auth/login/options',{});
    const response = await startAuthentication({ optionsJSON:options.options });
    signed = await internalRequest<{ accountId: string }>(api,'/auth/login/finish',{ challengeId:options.challengeId,response });
  } catch {
    throw new Error('Confirm it’s you to continue: sign out, sign in again, then retry.');
  }
  if (signed.accountId !== accountId) throw new OtherAccountError();
  return action();
}
