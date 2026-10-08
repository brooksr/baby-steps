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

const avery = child('avery-example', 'Avery Example', '2026-06-20T16:15:00.000Z');
const riley = child('riley-example', 'Riley Example', '2028-01-04T09:00:00.000Z');

describe('child ids', () => {
  // The id is what a caregiver sees in the sheet's `babyId` column, so it reads
  // as the child's name rather than as a UUID.
  it('slugifies the name', () => {
    expect(createProfileId('Riley Example')).toBe('riley-example');
    expect(createProfileId('Zoë O’Brien')).toBe('zoe-o-brien');
  });

  it('suffixes only on a collision, so the first of a name stays plain', () => {
    expect(createProfileId('Riley Example', ['avery-example'])).toBe('riley-example');
    expect(createProfileId('Riley Example', ['riley-example'])).toBe('riley-example-2');
    expect(createProfileId('Riley Example', ['riley-example', 'riley-example-2'])).toBe('riley-example-3');
  });

  it('still produces an id for a name with nothing to slugify', () => {
    expect(createProfileId('🙂')).toBe('child');
  });
});

describe('creating someone new', () => {
  it('starts from the defaults, carrying only the household settings', () => {
    const created = createFamilyProfile(
      { dueDate: '2028-03-04', gender: 'girl', name: '  Riley Example  ', timezone: 'America/New_York' },
      [avery],
      new Date('2028-01-04T09:00:00.000Z')
    );

    expect(created).toMatchObject({
      createdAt: '2028-01-04T09:00:00.000Z',
      dueDate: '2028-03-04',
      gender: 'girl',
      id: 'riley-example',
      name: 'Riley Example',
      timezone: 'America/New_York'
    });
    // Nothing of the first child's history comes along.
    expect(created.birthDate).toBeUndefined();
    expect(created.kind).toBe('child');
  });

  // A parent has no due date, and inventing one would read as a pregnancy.
  it('makes a parent with a role and no due date', () => {
    const mom = createFamilyProfile({ birthDate: '1994-05-11', kind: 'parent', name: 'Casey Example', parentRole: 'mom' }, [avery]);

    expect(mom).toMatchObject({ birthDate: '1994-05-11', id: 'casey-example', kind: 'parent', parentRole: 'mom' });
    expect(mom.dueDate).toBeUndefined();
  });
});

describe('choosing who to show', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('sorts oldest first, so every device shows the same order', () => {
    expect(sortProfiles([riley, avery]).map((profile) => profile.id)).toEqual(['avery-example', 'riley-example']);
  });

  // This is a baby tracker, so the switcher opens on the babies.
  it('puts children before parents, however recently either was added', () => {
    const mom = createFamilyProfile({ kind: 'parent', name: 'Casey Example', parentRole: 'mom' }, [], new Date('2025-01-01T00:00:00.000Z'));

    expect(sortProfiles([mom, riley, avery]).map((profile) => profile.id)).toEqual(['avery-example', 'riley-example', 'casey-example']);
  });

  it('remembers the choice per device', () => {
    expect(getStoredActiveProfileId()).toBeUndefined();
    storeActiveProfileId(riley.id);
    expect(getStoredActiveProfileId()).toBe(riley.id);
  });
});

describe('naming a child', () => {
  it('uses the first name, and says Baby when there is none', () => {
    expect(getFirstName(avery)).toBe('Avery');
    expect(getFirstName({ name: '   ' })).toBe('Baby');
    expect(getFirstName(null)).toBe('Baby');
    expect(getFirstName(createDefaultBabyProfile())).toBe('Baby');
  });

});

describe('telling a child from a parent', () => {
  const mom = createFamilyProfile({ kind: 'parent', name: 'Casey Example', parentRole: 'mom' });
  const dad = createFamilyProfile({ kind: 'parent', name: 'Jordan Example', parentRole: 'dad' });

  // Every profile row written before parents existed is a child.
  it('reads a profile with no kind as a child', () => {
    expect(getProfileKind({})).toBe('child');
    expect(getProfileKind(avery)).toBe('child');
    expect(isParent(avery)).toBe(false);
    expect(isParent(mom)).toBe(true);
  });

  it('offers cycle tracking to mom only', () => {
    expect(tracksCycle(mom)).toBe(true);
    expect(tracksCycle(dad)).toBe(false);
    expect(tracksCycle(avery)).toBe(false);
  });
});

describe('attributing an entry to a caregiver', () => {
  const mom = createFamilyProfile({ kind: 'parent', name: 'Casey Example', parentRole: 'mom' });
  const dad = createFamilyProfile({ kind: 'parent', name: 'Jordan Example', parentRole: 'dad' }, [mom]);

  beforeEach(() => {
    localStorage.clear();
  });

  it('offers the parents, never the children', () => {
    expect(getCaregivers([avery, mom, dad]).map((person) => person.name)).toEqual(['Casey Example', 'Jordan Example']);
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
    expect(getCaregiverName([avery, mom], mom.id)).toBe('Casey');
    expect(getCaregiverName([avery, mom], undefined)).toBeUndefined();
    // History keeps the id after a removal; there is just no name left to print.
    expect(getCaregiverName([avery, mom], dad.id)).toBeUndefined();
  });
});
