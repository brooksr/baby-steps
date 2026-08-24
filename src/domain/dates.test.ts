import { describe, expect, it } from 'vitest';
import { createDefaultBabyProfile, formatAgeSummary, formatDaysAgo, getDeviceTimezone, getTimezoneOptions } from './dates';

describe('formatDaysAgo', () => {
  const now = new Date('2026-09-10T09:00:00');

  it('reads calendar days, not elapsed hours', () => {
    // Fourteen hours earlier, but the night before — "Yesterday", not "14h ago".
    expect(formatDaysAgo('2026-09-09T19:00:00', now)).toBe('Yesterday');
  });

  it('labels the current day', () => {
    expect(formatDaysAgo('2026-09-10T06:30:00', now)).toBe('Today');
  });

  it('counts back further days', () => {
    expect(formatDaysAgo('2026-09-07T19:00:00', now)).toBe('3 days ago');
  });

  it('treats a future timestamp as today', () => {
    expect(formatDaysAgo('2026-09-11T08:00:00', now)).toBe('Today');
  });
});

describe('formatAgeSummary', () => {
  const profile = { ...createDefaultBabyProfile(new Date('2026-06-19T12:00:00')), birthDate: '2026-09-02' };

  it('counts the first fortnight in days', () => {
    expect(formatAgeSummary(profile, new Date('2026-09-02T18:00:00'))).toBe('Newborn');
    expect(formatAgeSummary(profile, new Date('2026-09-03T13:00:00'))).toBe('1 day');
    expect(formatAgeSummary(profile, new Date('2026-09-15T13:00:00'))).toBe('13 days');
  });

  it('switches to weeks at a fortnight', () => {
    expect(formatAgeSummary(profile, new Date('2026-09-16T13:00:00'))).toBe('2 weeks');
    expect(formatAgeSummary(profile, new Date('2026-11-30T13:00:00'))).toBe('12 weeks');
  });

  it('switches to whole calendar months at three months', () => {
    expect(formatAgeSummary(profile, new Date('2026-12-02T13:00:00'))).toBe('3 months');
    expect(formatAgeSummary(profile, new Date('2027-08-02T13:00:00'))).toBe('11 months');
  });

  it('switches to years after two', () => {
    expect(formatAgeSummary(profile, new Date('2028-09-02T13:00:00'))).toBe('2 years');
    expect(formatAgeSummary(profile, new Date('2028-12-02T13:00:00'))).toBe('2y 3m');
  });

  it('says nothing before birth', () => {
    expect(formatAgeSummary(createDefaultBabyProfile(new Date('2026-06-19T12:00:00')))).toBe('');
  });
});

describe('timezone options', () => {
  it('always offers the device zone and whatever is already saved', () => {
    const saved = 'Antarctica/Troll';
    const options = getTimezoneOptions(saved);

    // A profile set on another device must stay selectable here even if this
    // browser would not have listed that zone.
    expect(options).toContain(saved);
    expect(options).toContain(getDeviceTimezone());
    expect(options).toEqual([...options].sort());
    expect(new Set(options).size).toBe(options.length);
  });
});
