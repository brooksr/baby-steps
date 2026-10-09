import { isArchived, isCaregiverAccount, isParent, normalizeEmail } from './family';
import type { BabyProfile, CareEventType } from './types';

/**
 * What a device opens on. `full` is the whole app; `caregiver` is the
 * babysitting view — the children's Home with `CAREGIVER_EVENT_TYPES` to log,
 * and the Care page's Key info and Emergency tabs. No Log, no Reports, no
 * Settings, and no parent in the switcher. `none` is a signed-in account that
 * belongs to nobody on this family's sheet: it sees none of it.
 *
 * Which family's sheet a device opens is decided first, by `isFamilyMember`
 * over each sheet the account can reach (`storage/familyDirectory.ts`), and a
 * family is its own spreadsheet — so families never share rows. Inside one
 * family this is still **a view, not a lock**: there is no server, and whoever
 * the sheet is shared with can open it directly. Sharing is the real gate.
 */
export type AccessRole = 'full' | 'caregiver' | 'none';

export interface Access {
  /** The profile the signed-in email belongs to, when it matches one. */
  account?: BabyProfile;
  role: AccessRole;
}

/**
 * What a caregiver can log: everything a child's Home offers except the birth,
 * which also rewrites the child's profile.
 */
export const CAREGIVER_EVENT_TYPES: readonly CareEventType[] = [
  'appointment',
  'bath',
  'diaper',
  'feed',
  'growth',
  'medication',
  'mood',
  'note',
  'pump',
  'sleep',
  'temperature',
  'tummytime'
];

/** The current parent or caregiver this email belongs to, if any. */
export function findAccount(profiles: readonly BabyProfile[], email: string | undefined): BabyProfile | undefined {
  const signedIn = normalizeEmail(email);

  if (!signedIn) {
    return undefined;
  }

  return profiles.find(
    (person) => !isArchived(person) && (isParent(person) || isCaregiverAccount(person)) && normalizeEmail(person.email) === signedIn
  );
}

/** Whether this email may open this family at all. */
export function isFamilyMember(profiles: readonly BabyProfile[], email: string | undefined): boolean {
  return Boolean(findAccount(profiles, email));
}

/**
 * The parents someone may say they are, on a family that has never recorded a
 * parent's email — the one-time step that sets up sign-in for a family that
 * predates it. Empty once any current parent has an email: from then on only a
 * parent can add someone, in Settings → Family.
 */
export function getClaimableParents(profiles: readonly BabyProfile[]): BabyProfile[] {
  const parents = profiles.filter((person) => !isArchived(person) && isParent(person));
  return parents.some((parent) => normalizeEmail(parent.email)) ? [] : parents;
}

/**
 * Who the signed-in Google account is, by the email on a parent's or a
 * caregiver's profile.
 *
 * - A parent's email opens the full app; a caregiver's opens the caregiver view.
 * - Any other email is `none` — whatever the family has or has not set up.
 *   An account with no profile here sees nothing of this family.
 * - No email known (a device that has never signed in, working from its own
 *   local data) is the full app.
 */
export function getAccess(profiles: readonly BabyProfile[], email: string | undefined): Access {
  if (!normalizeEmail(email)) {
    return { role: 'full' };
  }

  const account = findAccount(profiles, email);

  if (!account) {
    return { role: 'none' };
  }

  return { account, role: isParent(account) ? 'full' : 'caregiver' };
}
