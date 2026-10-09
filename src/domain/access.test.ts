import { describe, expect, it } from 'vitest';
import { CAREGIVER_EVENT_TYPES, getAccess, getClaimableParents, isFamilyMember } from './access';
import { getActiveProfiles, getCaregiverAccounts, sortProfiles } from './family';
import type { BabyProfile, ProfileKind } from './types';

function person(id: string, kind: ProfileKind, email?: string, extra: Partial<BabyProfile> = {}): BabyProfile {
  return {
    createdAt: '2026-06-20T16:15:00.000Z',
    email,
    id,
    kind,
    name: id,
    syncState: 'synced',
    timezone: 'America/Los_Angeles',
    updatedAt: '2026-06-20T16:15:00.000Z',
    ...extra
  };
}

const baby = person('baby', 'child');
const mom = person('mom', 'parent', 'mom@example.com');
const dad = person('dad', 'parent');
const grandma = person('grandma', 'caregiver', 'grandma@example.com');

describe('getAccess', () => {
  it('lets in nobody without a profile, whatever the family has set up', () => {
    expect(getAccess([baby, dad], 'anyone@example.com')).toEqual({ role: 'none' });
    expect(getAccess([baby, mom], 'stranger@example.com')).toEqual({ role: 'none' });
  });

  it('opens the full app when no email is known on this device', () => {
    expect(getAccess([baby, mom, grandma], undefined).role).toBe('full');
  });

  it('matches a parent by email, ignoring case and spacing', () => {
    expect(getAccess([baby, mom, grandma], '  Mom@Example.com ')).toEqual({ account: mom, role: 'full' });
  });

  it('opens the caregiver view for a caregiver account', () => {
    expect(getAccess([baby, mom, grandma], 'grandma@example.com')).toEqual({ account: grandma, role: 'caregiver' });
  });

  it('does not match an archived account', () => {
    const archived = { ...grandma, archivedAt: '2026-07-01T00:00:00.000Z' };
    expect(getAccess([baby, mom, archived], 'grandma@example.com')).toEqual({ role: 'none' });
  });

  it('does not let a child profile stand in for an account', () => {
    expect(getAccess([person('kid', 'child', 'kid@example.com')], 'kid@example.com')).toEqual({ role: 'none' });
  });
});

describe('family membership', () => {
  it('is a current parent or caregiver with that email', () => {
    expect(isFamilyMember([baby, mom, grandma], 'grandma@example.com')).toBe(true);
    expect(isFamilyMember([baby, mom], 'grandma@example.com')).toBe(false);
    expect(isFamilyMember([baby, mom], undefined)).toBe(false);
  });

  it('offers the parents to claim only while no parent has an email', () => {
    expect(getClaimableParents([baby, dad]).map((p) => p.id)).toEqual(['dad']);
    expect(getClaimableParents([baby, dad, mom])).toEqual([]);
    expect(getClaimableParents([baby])).toEqual([]);
  });
});

describe('caregiver entries', () => {
  it('cover every child entry but the birth', () => {
    expect(CAREGIVER_EVENT_TYPES).toContain('sleep');
    expect(CAREGIVER_EVENT_TYPES).toContain('medication');
    expect(CAREGIVER_EVENT_TYPES).not.toContain('birth');
  });
});

describe('caregiver accounts', () => {
  it('stay out of the switcher and sort after the parents', () => {
    expect(getActiveProfiles([grandma, mom, baby]).map((p) => p.id)).toEqual(['baby', 'mom']);
    expect(getCaregiverAccounts([grandma, mom, baby]).map((p) => p.id)).toEqual(['grandma']);
    expect(sortProfiles([grandma, mom, baby]).map((p) => p.id)).toEqual(['baby', 'mom', 'grandma']);
  });
});
