import { beforeEach, describe, expect, it } from 'vitest';
import { createFamilyProfile, createProfileId, getCaregiverName, getCaregivers, getFirstName, getProfileKind, getStoredActiveProfileId, getStoredCaregiverId, isParent, sortProfiles, storeActiveProfileId, storeCaregiverId, tracksCycle } from './family';
import { createDefaultBabyProfile } from './dates';
import type { BabyProfile } from './types';

function child(id: string, name: string, createdAt: string): BabyProfile {
  return {
    createdAt,
    dueDate: '2026-09-01',
    id,
    kind: 'child',
    name,
    syncState: 'synced',
    timezone: 'America/Los_Angeles',
    updatedAt: createdAt
  };
}

const theo = child('theo-roche', 'Theo Roche', '2026-06-20T16:15:00.000Z');
const mila = child('mila-roche', 'Mila Roche', '2028-01-04T09:00:00.000Z');

describe('child ids', () => {
  // The id is what a caregiver sees in the sheet's `babyId` column, so it reads
  // as the child's name rather than as a UUID.
  it('slugifies the name', () => {
    expect(createProfileId('Mila Roche')).toBe('mila-roche');
    expect(createProfileId('Zoë O’Brien')).toBe('zoe-o-brien');
  });

  it('suffixes only on a collision, so the first of a name stays plain', () => {
    expect(createProfileId('Mila Roche', ['theo-roche'])).toBe('mila-roche');
    expect(createProfileId('Mila Roche', ['mila-roche'])).toBe('mila-roche-2');
    expect(createProfileId('Mila Roche', ['mila-roche', 'mila-roche-2'])).toBe('mila-roche-3');
  });

  it('still produces an id for a name with nothing to slugify', () => {
    expect(createProfileId('🙂')).toBe('child');
  });
});

describe('creating someone new', () => {
  it('starts from the defaults, carrying only the household settings', () => {
    const created = createFamilyProfile(
      { dueDate: '2028-03-04', gender: 'girl', name: '  Mila Roche  ', timezone: 'America/New_York' },
      [theo],
      new Date('2028-01-04T09:00:00.000Z')
    );

    expect(created).toMatchObject({
      createdAt: '2028-01-04T09:00:00.000Z',
      dueDate: '2028-03-04',
      gender: 'girl',
      id: 'mila-roche',
      name: 'Mila Roche',
      timezone: 'America/New_York'
    });
    // Nothing of the first child's history comes along.
    expect(created.birthDate).toBeUndefined();
    expect(created.kind).toBe('child');
  });

  // A parent has no due date, and inventing one would read as a pregnancy.
  it('makes a parent with a role and no due date', () => {
    const mom = createFamilyProfile({ birthDate: '1994-05-11', kind: 'parent', name: 'Sara Roche', parentRole: 'mom' }, [theo]);

    expect(mom).toMatchObject({ birthDate: '1994-05-11', id: 'sara-roche', kind: 'parent', parentRole: 'mom' });
    expect(mom.dueDate).toBeUndefined();
  });
});

describe('choosing who to show', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('sorts oldest first, so every device shows the same order', () => {
    expect(sortProfiles([mila, theo]).map((profile) => profile.id)).toEqual(['theo-roche', 'mila-roche']);
  });

  // This is a baby tracker, so the switcher opens on the babies.
  it('puts children before parents, however recently either was added', () => {
    const mom = createFamilyProfile({ kind: 'parent', name: 'Sara Roche', parentRole: 'mom' }, [], new Date('2025-01-01T00:00:00.000Z'));

    expect(sortProfiles([mom, mila, theo]).map((profile) => profile.id)).toEqual(['theo-roche', 'mila-roche', 'sara-roche']);
  });

  it('remembers the choice per device', () => {
    expect(getStoredActiveProfileId()).toBeUndefined();
    storeActiveProfileId(mila.id);
    expect(getStoredActiveProfileId()).toBe(mila.id);
  });
});

describe('naming a child', () => {
  it('uses the first name, and says Baby when there is none', () => {
    expect(getFirstName(theo)).toBe('Theo');
    expect(getFirstName({ name: '   ' })).toBe('Baby');
    expect(getFirstName(null)).toBe('Baby');
    expect(getFirstName(createDefaultBabyProfile())).toBe('Theo');
  });

});

describe('telling a child from a parent', () => {
  const mom = createFamilyProfile({ kind: 'parent', name: 'Sara Roche', parentRole: 'mom' });
  const dad = createFamilyProfile({ kind: 'parent', name: 'Brooks Roche', parentRole: 'dad' });

  // Every profile row written before parents existed is a child.
  it('reads a profile with no kind as a child', () => {
    expect(getProfileKind({})).toBe('child');
    expect(getProfileKind(theo)).toBe('child');
    expect(isParent(theo)).toBe(false);
    expect(isParent(mom)).toBe(true);
  });

  it('offers cycle tracking to mom only', () => {
    expect(tracksCycle(mom)).toBe(true);
    expect(tracksCycle(dad)).toBe(false);
    expect(tracksCycle(theo)).toBe(false);
  });
});

describe('attributing an entry to a caregiver', () => {
  const mom = createFamilyProfile({ kind: 'parent', name: 'Sara Roche', parentRole: 'mom' });
  const dad = createFamilyProfile({ kind: 'parent', name: 'Brooks Roche', parentRole: 'dad' }, [mom]);

  beforeEach(() => {
    localStorage.clear();
  });

  it('offers the parents, never the children', () => {
    expect(getCaregivers([theo, mom, dad]).map((person) => person.name)).toEqual(['Sara Roche', 'Brooks Roche']);
  });

  it('remembers who this device logs as', () => {
    expect(getStoredCaregiverId()).toBeUndefined();
    storeCaregiverId(mom.id);
    expect(getStoredCaregiverId()).toBe(mom.id);
    // "Not recorded" is a choice, not a blank to be filled in from last time.
    storeCaregiverId('');
    expect(getStoredCaregiverId()).toBeUndefined();
  });

  it('names the caregiver, and stays quiet for one no longer tracked', () => {
    expect(getCaregiverName([theo, mom], mom.id)).toBe('Sara');
    expect(getCaregiverName([theo, mom], undefined)).toBeUndefined();
    // History keeps the id after a removal; there is just no name left to print.
    expect(getCaregiverName([theo, mom], dad.id)).toBeUndefined();
  });
});
