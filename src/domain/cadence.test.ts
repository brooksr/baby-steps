import { describe, expect, it } from 'vitest';
import { getCadenceReminders, predictNextBath, predictNextFeed } from './cadence';
import type { CareEvent } from './types';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const HOUR = 60 * 60_000;

const base = {
  babyId: 'avery-example',
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

describe('next feed prediction', () => {
  it('centers the usual feed window two and a half hours after the last feed', () => {
    const prediction = predictNextFeed([feedHoursAgo(1)], NOW);

    expect(prediction).toMatchObject({
      expectedAt: '2026-09-10T13:30:00.000Z',
      minutesAway: 90,
      windowEndAt: '2026-09-10T14:00:00.000Z',
      windowStartAt: '2026-09-10T13:00:00.000Z'
    });
  });

  it('returns nothing without a logged feed', () => {
    expect(predictNextFeed([], NOW)).toBeNull();
  });
});

describe('predictNextBath', () => {
  const bath = (startedAt: string): CareEvent => ({
    babyId: 'avery-example',
    createdAt: startedAt,
    id: `bath-${startedAt}`,
    startedAt,
    syncState: 'local',
    type: 'bath',
    updatedAt: startedAt
  });

  it('says nothing without a bath to count from', () => {
    expect(predictNextBath([])).toBeNull();
  });

  it('spans the usual 2–3 calendar days after the last bath', () => {
    expect(predictNextBath([bath('2026-09-08T19:00:00')], new Date('2026-09-09T09:00:00'))).toEqual({
      due: false,
      windowEndKey: '2026-09-11',
      windowStartKey: '2026-09-10'
    });
  });

  it('is due once the window has run out', () => {
    expect(predictNextBath([bath('2026-09-08T19:00:00')], new Date('2026-09-11T09:00:00'))?.due).toBe(true);
  });
});
