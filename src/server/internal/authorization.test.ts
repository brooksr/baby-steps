import { describe, expect, it } from 'vitest';
import type { BabyProfile } from '../../domain/types';
import { canPerformFamilyAction, resolveFamilyMembership, type FamilyAuthorizationInput } from './authorization';
import type { FamilyAction } from './types';

const actor: BabyProfile = {
  createdAt: '2026-10-16T12:00:00Z',
  familyId: 'family-a',
  id: 'parent-a',
  kind: 'parent',
  name: 'Alex Example',
  timezone: 'America/Los_Angeles',
  updatedAt: '2026-10-16T12:00:00Z'
};
const child: BabyProfile = { ...actor, id: 'child-a', kind: 'child', name: 'Baby Example' };
const input: FamilyAuthorizationInput = {
  account: { id: 'account-a' },
  actor,
  familyId: 'family-a',
  membership: { accountId: 'account-a', familyId: 'family-a', profileId: actor.id, role: 'parent' },
  principal: { accountId: 'account-a', sessionId: 'verified-session' }
};

function caregiver(): FamilyAuthorizationInput {
  return { ...input, actor: { ...actor, kind: 'caregiver' }, membership: { ...input.membership!, role: 'caregiver' } };
}

describe('internal family authorization foundation', () => {
  it('denies anonymous access rather than using the PWA offline full-view fallback', () => {
    expect(canPerformFamilyAction({ ...input, principal: undefined }, 'family:read')).toBe(false);
    expect(canPerformFamilyAction({ ...input, membership: undefined }, 'family:read')).toBe(false);
  });

  it('uses stable account ids; matching email cannot supply missing membership', () => {
    expect(resolveFamilyMembership(input)).toEqual(input.membership);
    expect(canPerformFamilyAction({ ...input, principal: { accountId: 'another-account', sessionId: 's' } }, 'family:read')).toBe(false);
    expect(canPerformFamilyAction({ ...input, actor: { ...actor, email: 'same@example.test' }, membership: undefined }, 'family:read')).toBe(false);
  });

  it('denies disabled accounts, revoked memberships, archived actors and mismatched roles', () => {
    for (const patch of [
      { account: { id: 'account-a', disabledAt: 'now' } },
      { membership: { ...input.membership!, revokedAt: 'now' } },
      { actor: { ...actor, archivedAt: 'now' } },
      { actor: { ...actor, kind: 'child' as const } },
      { actor: { ...actor, id: 'another-parent' } },
      { actor: { ...actor, familyId: 'family-b' } },
      { familyId: 'family-b' }
    ]) {
      expect(canPerformFamilyAction({ ...input, ...patch }, 'family:read')).toBe(false);
    }
  });

  it('permits parent management but refuses cross-family targets and unknown actions', () => {
    expect(canPerformFamilyAction(input, 'family:manage')).toBe(true);
    expect(canPerformFamilyAction(input, 'family:write', { ...child, familyId: 'family-b' })).toBe(false);
    expect(canPerformFamilyAction(input, 'unknown' as FamilyAction)).toBe(false);
  });

  it('limits caregivers to child home, key info and permitted new entries', () => {
    const care = caregiver();
    expect(canPerformFamilyAction(care, 'child:home', child)).toBe(true);
    expect(canPerformFamilyAction(care, 'child:key-info', child)).toBe(true);
    expect(canPerformFamilyAction(care, 'child:add-event', child, 'feed')).toBe(true);
    for (const action of ['family:read', 'family:export', 'family:manage', 'family:write'] as const) {
      expect(canPerformFamilyAction(care, action, child)).toBe(false);
    }
    expect(canPerformFamilyAction(care, 'child:add-event', child, 'birth')).toBe(false);
    expect(canPerformFamilyAction(care, 'child:add-event', child, 'menses')).toBe(false);
    expect(canPerformFamilyAction(care, 'child:add-event', child)).toBe(false);
    expect(canPerformFamilyAction(care, 'child:home', actor)).toBe(false);
    expect(canPerformFamilyAction(care, 'child:home', { ...child, archivedAt: 'now' })).toBe(false);
    expect(canPerformFamilyAction(care, 'child:home', { ...child, familyId: 'family-b' })).toBe(false);
  });
});
