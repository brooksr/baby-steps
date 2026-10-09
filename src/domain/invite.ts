import { getFirstName, isCaregiverAccount } from './family';
import type { BabyProfile } from './types';

/**
 * The message a parent sends someone they have added: the link that opens this
 * family, and the few steps between tapping it and seeing the children. Pure,
 * so the copy is testable; `App`/Settings decide whether it goes out through
 * the share sheet or as a `mailto:`.
 */
export interface Invite {
  body: string;
  mailto: string;
  subject: string;
}

export function buildInvite(invitee: Pick<BabyProfile, 'email' | 'kind' | 'name'>, inviter: Pick<BabyProfile, 'name'> | undefined, link: string): Invite {
  const from = inviter ? getFirstName(inviter) : 'Your family';
  const what = isCaregiverAccount(invitee)
    ? 'log feeds, diapers, naps and the rest, and see Key info and the Emergency guide'
    : 'see and log everything the family tracks';
  const account = invitee.email ? `the Google account ${invitee.email}` : 'the Google account they added for you';
  const subject = `${from} added you to BabySteps`;
  const body = [
    `Hi ${getFirstName(invitee)},`,
    '',
    `${from} added you to the family on BabySteps, so you can ${what}.`,
    '',
    `1. Open this link: ${link}`,
    `2. Tap "Continue with Google" and sign in with ${account}. Any other account won't see the family.`,
    '3. If Google says it hasn\'t verified the app, tap "Advanced", then "Go to BabySteps". It is a small family app, not a public one.',
    '4. Allow access to Google Sheets and Drive. That is where the family\'s log is kept.',
    '',
    'On a phone, use "Add to Home Screen" to keep it like an app.'
  ].join('\n');

  return {
    body,
    mailto: `mailto:${encodeURIComponent(invitee.email ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    subject
  };
}
