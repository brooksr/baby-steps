import { beforeEach, describe, expect, it } from 'vitest';
import { describeManageResult, getLocalDbName, getPendingJoinId, getStoredFamilyId, storeFamilyId, takeJoinParam } from './familyDirectory';
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

describe('describeManageResult', () => {
  it('tells a refused grant apart from nothing being picked', () => {
    expect(describeManageResult({ kind: 'not-picked' })).toMatch(/Nothing was selected/);
    expect(describeManageResult({ kind: 'refused', reason: 'not-granted' })).toMatch(/same Google Cloud project/);
    expect(describeManageResult({ kind: 'refused', reason: 'not-owner' })).toMatch(/owner/);
    expect(
      describeManageResult({
        detail: 'Google request failed (403): Google Drive API has not been used in project 155470529382 before or it is disabled. "reason": "SERVICE_DISABLED"',
        kind: 'refused',
        reason: 'error'
      })
    ).toMatch(/Drive API is turned off .*\(155470529382\)/);
    expect(describeManageResult({ count: 2, kind: 'shared' })).toBe('BabySteps can share this sheet now — shared with 2 people already added.');
  });
});
