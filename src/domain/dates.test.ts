import { describe, expect, it } from 'vitest';
import { formatDaysAgo } from './dates';

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
