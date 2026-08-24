import { describe, expect, it } from 'vitest';
import {
  ALL_TIME,
  filterEventsByRange,
  formatRangeLabel,
  getPresetRange,
  getRangeDays,
  isDateKeyInRange,
  isRangeActive,
  matchPreset,
  normalizeRange
} from './dateRange';
import type { CareEvent } from './types';

const NOW = new Date('2026-09-30T12:00:00');

function diaper(startedAt: string, id = startedAt): CareEvent {
  return {
    babyId: 'theo-roche',
    createdAt: startedAt,
    id,
    kind: 'wet',
    startedAt,
    syncState: 'synced',
    type: 'diaper',
    updatedAt: startedAt
  } as CareEvent;
}

describe('date ranges', () => {
  // "7 days" has to mean today plus the six before it, not eight days.
  it('builds presets inclusive of today', () => {
    expect(getPresetRange('7d', NOW)).toEqual({ from: '2026-09-24', to: '2026-09-30' });
    expect(getRangeDays(getPresetRange('7d', NOW))).toBe(7);
    expect(getRangeDays(getPresetRange('30d', NOW))).toBe(30);
    expect(getPresetRange('all', NOW)).toEqual(ALL_TIME);
  });

  it('recognizes a range that came from a preset', () => {
    expect(matchPreset(getPresetRange('30d', NOW), NOW)).toBe('30d');
    expect(matchPreset(ALL_TIME, NOW)).toBe('all');
    expect(matchPreset({ from: '2026-09-01', to: '2026-09-03' }, NOW)).toBeNull();
  });

  // Picking the ends out of order should still show the span meant, not nothing.
  it('reads a reversed range as the span between the two dates', () => {
    expect(normalizeRange({ from: '2026-09-10', to: '2026-09-01' })).toEqual({ from: '2026-09-01', to: '2026-09-10' });
    expect(isDateKeyInRange('2026-09-05', { from: '2026-09-10', to: '2026-09-01' })).toBe(true);
  });

  it('treats an open end as unbounded', () => {
    expect(isRangeActive(ALL_TIME)).toBe(false);
    expect(isRangeActive({ from: '2026-09-01', to: '' })).toBe(true);
    expect(isDateKeyInRange('2001-01-01', { from: '', to: '2026-09-01' })).toBe(true);
    expect(isDateKeyInRange('2030-01-01', { from: '', to: '2026-09-01' })).toBe(false);
    expect(getRangeDays({ from: '2026-09-01', to: '' })).toBeNull();
  });

  it('filters on the local calendar day, both ends included', () => {
    const events = [diaper('2026-09-01T23:30:00'), diaper('2026-09-02T00:30:00'), diaper('2026-09-05T09:00:00')];
    const filtered = filterEventsByRange(events, { from: '2026-09-02', to: '2026-09-05' });

    expect(filtered.map((event) => event.id)).toEqual(['2026-09-02T00:30:00', '2026-09-05T09:00:00']);
    expect(filterEventsByRange(events, ALL_TIME)).toBe(events);
  });

  it('labels a range the way it reads out loud', () => {
    expect(formatRangeLabel(ALL_TIME)).toBe('All time');
    expect(formatRangeLabel({ from: '2026-09-02', to: '2026-09-02' })).toBe(formatRangeLabel({ from: '2026-09-02', to: '2026-09-02' }));
    expect(formatRangeLabel({ from: '2026-09-02', to: '' })).toMatch(/onward$/);
    expect(formatRangeLabel({ from: '', to: '2026-09-02' })).toMatch(/^Through /);
    expect(formatRangeLabel({ from: '2026-09-02', to: '2026-09-09' })).toContain('–');
  });
});
