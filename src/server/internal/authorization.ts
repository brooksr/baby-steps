import { CAREGIVER_EVENT_TYPES } from '../../domain/access';
import { getProfileKind } from '../../domain/family';
import type { BabyProfile, CareEventType } from '../../domain/types';
import type { AccountPrincipal, FamilyAction, FamilyMembership, InternalAccount } from './types';

export interface FamilyAuthorizationInput {
  account: InternalAccount | undefined;
  /** Resolve from the requested family's database, not the client's cached profiles. */
  actor: BabyProfile | undefined;
  familyId: string;
  membership: FamilyMembership | undefined;
  principal: AccountPrincipal | undefined;
}

/** A policy primitive, not session verification or an HTTP authentication handler. */
export function resolveFamilyMembership(input: FamilyAuthorizationInput): FamilyMembership | undefined {
  const { account, actor, familyId, membership, principal } = input;

  if (!principal || !principal.sessionId || !account || account.disabledAt || account.id !== principal.accountId || !membership || !actor) {
    return undefined;
  }

  if (
    membership.revokedAt || membership.accountId !== account.id || membership.familyId !== familyId ||
    actor.familyId !== familyId || actor.id !== membership.profileId || actor.archivedAt ||
    getProfileKind(actor) !== membership.role
  ) {
    return undefined;
  }

  return membership;
}

export function canPerformFamilyAction(
  input: FamilyAuthorizationInput,
  action: FamilyAction,
  target?: BabyProfile,
  eventType?: CareEventType
): boolean {
  const actions: readonly FamilyAction[] = [
    'child:add-event', 'child:home', 'child:key-info', 'family:export', 'family:manage', 'family:read', 'family:write'
  ];
  const membership = resolveFamilyMembership(input);

  if (!membership || !actions.includes(action)) {
    return false;
  }

  // Explicit targets must belong to this family even for parents.
  if (target && target.familyId !== input.familyId) {
    return false;
  }

  if (membership.role === 'parent') {
    return true;
  }

  if (!target || target.archivedAt || getProfileKind(target) !== 'child') {
    return false;
  }

  return action === 'child:home' || action === 'child:key-info' ||
    (action === 'child:add-event' && eventType !== undefined && CAREGIVER_EVENT_TYPES.includes(eventType));
}
