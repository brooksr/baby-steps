import { beforeEach, describe, expect, it } from 'vitest';
import { getLocalDbName, getPendingJoinId, getStoredFamilyId, storeFamilyId, takeJoinParam } from './familyDirectory';
import { GOOGLE_SHEET_ID } from './googleSheetsStore';

describe('family directory', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('remembers a family per account, not per device', () => {
    storeFamilyId('Mom@Example.com', 'sheet-a');
    storeFamilyId('sitter@example.com', 'sheet-b');

    expect(getStoredFamilyId('mom@example.com')).toBe('sheet-a');
    expect(getStoredFamilyId('sitter@example.com')).toBe('sheet-b');
    expect(getStoredFamilyId('stranger@example.com')).toBeUndefined();
    expect(getStoredFamilyId(undefined)).toBeUndefined();
  });

  it('keeps each family in its own offline database', () => {
    expect(getLocalDbName(undefined)).toBe('babysteps');
    expect(getLocalDbName(GOOGLE_SHEET_ID || undefined)).toBe('babysteps');
    expect(getLocalDbName('sheet-b')).toBe('babysteps-sheet-b');
  });

  it('takes the family from an invite link and out of the address bar', () => {
    window.history.replaceState(null, '', '/?family=sheet-c#settings');

    takeJoinParam();

    expect(getPendingJoinId()).toBe('sheet-c');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#settings');
  });
});
