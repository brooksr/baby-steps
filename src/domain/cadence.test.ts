import { describe, expect, it } from 'vitest';
import { getCadenceReminders } from './cadence';
import type { CareEvent } from './types';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const HOUR = 60 * 60_000;

const base = {
  babyId: 'theo-roche',
  createdAt: '2026-09-10T12:00:00.000Z',
  syncState: 'local' as const,
  updatedAt: '2026-09-10T12:00:00.000Z'
};

function feedHoursAgo(hours: number): CareEvent {
  return {
    ...base,
    id: `feed-${hours}`,
    method: 'nursing',
    startedAt: new Date(NOW.getTime() - hours * HOUR).toISOString(),
    type: 'feed'
  };
}

function bathDaysAgo(days: number): CareEvent {
  return {
    ...base,
    id: `bath-${days}`,
    startedAt: new Date(NOW.getTime() - days * 24 * HOUR).toISOString(),
    type: 'bath'
  };
}

describe('cadence reminders', () => {
  it('stays quiet inside the usual feed and bath rhythms', () => {
    const events = [feedHoursAgo(2), bathDaysAgo(2)];

    expect(getCadenceReminders(events, { now: NOW })).toEqual([]);
  });

  it('nudges once a feed passes three hours', () => {
    const [reminder] = getCadenceReminders([feedHoursAgo(3.5)], { now: NOW });

    expect(reminder.kind).toBe('feed');
    expect(reminder.title).toBe('Last feed was 3h 30m ago');
    expect(reminder.message).toContain('every 2–3 hours');
    expect(reminder.message).toContain('pediatrician');
  });

  it('nudges once a bath passes three days', () => {
    const [reminder] = getCadenceReminders([bathDaysAgo(4)], { now: NOW });

    expect(reminder.kind).toBe('bath');
    expect(reminder.title).toBe('Last bath was 4 days ago');
    expect(reminder.message).toContain('2–3 days');
  });

  it('puts the feed first when both are due', () => {
    const reminders = getCadenceReminders([feedHoursAgo(5), bathDaysAgo(6)], { now: NOW });

    expect(reminders.map((reminder) => reminder.kind)).toEqual(['feed', 'bath']);
  });

  it('says nothing when a feed is being timed right now', () => {
    const reminders = getCadenceReminders([feedHoursAgo(5)], { feedInProgress: true, now: NOW });

    expect(reminders).toEqual([]);
  });

  it('says nothing about care that was never logged', () => {
    // An empty log means unknown, not overdue — no nagging a fresh install.
    expect(getCadenceReminders([], { now: NOW })).toEqual([]);
  });
});
