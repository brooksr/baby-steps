/** Internal identity is independent of a care profile, email or Google Sheet. */
export interface InternalAccount {
  disabledAt?: string;
  id: string;
}

/** Construct only after server-side session verification, never from request JSON. */
export interface AccountPrincipal {
  accountId: string;
  sessionId: string;
}

export type MembershipRole = 'caregiver' | 'parent';

export interface FamilyMembership {
  accountId: string;
  familyId: string;
  profileId: string;
  revokedAt?: string;
  role: MembershipRole;
}

export type FamilyAction =
  | 'child:add-event'
  | 'child:home'
  | 'child:key-info'
  | 'family:export'
  | 'family:manage'
  | 'family:read'
  | 'family:write';

/** Identity provider and record store are separate choices. No email-based linking. */
export type IdentityProvider = 'google' | 'passkey';
export type FamilyStorageProvider = 'google-sheets' | 'internal';
