import { describe, expect, it } from 'vitest';
import { addDaysToKey, createDefaultBabyProfile, formatAgeSummary, formatClockRange as formatRange, formatDaysAgo, formatDaysSince, getDayFraction, getDeviceTimezone, getTimezoneOptions } from './dates';

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

describe('formatDaysSince', () => {
  const now = new Date('2026-09-10T09:00:00');

  it('stays short enough for a phone-width card', () => {
    expect(formatDaysSince('2026-09-10T06:30:00', now)).toBe('Today');
    expect(formatDaysSince('2026-09-09T19:00:00', now)).toBe('1 day');
    expect(formatDaysSince('2026-09-07T19:00:00', now)).toBe('3 days');
  });
});

describe('formatClockRange', () => {
  // ICU puts a narrow no-break space before AM/PM.
  const formatClockRange = (start: string, end: string) => formatRange(start, end).replace(/\s/g, ' ');

  it('rounds both ends to the quarter hour', () => {
    expect(formatClockRange('2026-09-10T06:37:00', '2026-09-10T07:22:00')).toBe('6:30–7:15 AM');
  });

  it('drops the minutes when both ends land on the hour', () => {
    expect(formatClockRange('2026-09-10T06:02:00', '2026-09-10T06:58:00')).toBe('6–7 AM');
  });

  it('collapses a window that rounds to one time', () => {
    expect(formatClockRange('2026-09-10T06:58:00', '2026-09-10T07:05:00')).toBe('7:00 AM');
  });
});

describe('addDaysToKey', () => {
  it('steps across a month end', () => {
    expect(addDaysToKey('2026-09-29', 3)).toBe('2026-10-02');
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
    expect(formatAgeSummary(profile, new Date('2026-10-21T13:00:00'))).toBe('7 weeks');
  });

  it('rounds to two months at eight weeks, then uses whole calendar months', () => {
    expect(formatAgeSummary(profile, new Date('2026-10-28T13:00:00'))).toBe('2 months');
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

describe('day fraction', () => {
  it('is whole for a finished day and nothing for one still ahead', () => {
    expect(getDayFraction('2026-09-02', new Date('2026-09-03T06:00:00'))).toBe(1);
    expect(getDayFraction('2026-09-04', new Date('2026-09-03T06:00:00'))).toBe(0);
  });

  it('is the part of today that has elapsed', () => {
    expect(getDayFraction('2026-09-03', new Date('2026-09-03T18:00:00'))).toBeCloseTo(0.75, 5);
  });

  // Dividing a count by a sliver of a day would invent a wild daily rate.
  it('floors the earliest hours at a quarter day', () => {
    expect(getDayFraction('2026-09-03', new Date('2026-09-03T00:30:00'))).toBe(0.25);
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
