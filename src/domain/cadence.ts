import { formatDaysAgo, formatDuration, getDaysAgo } from './dates';
import { getLastEvent } from './summary';
import type { CareEvent } from './types';

/**
 * Gentle cadence nudges: how long it has been since the last feed and the last
 * bath, measured against the rhythms families usually aim for.
 *
 * These are reminders about the log, not medical guidance. They stay quiet
 * until the top of the usual range has passed, they only ever suggest offering
 * a feed or running a bath, and they say nothing at all when there is no
 * earlier event to measure from — an empty log means unknown, not overdue.
 */

const MINUTE = 60_000;

/** Feeds are usually offered every 2–3 hours, day and night. */
export const FEED_CADENCE_HOURS = { max: 3, min: 2 };
/** A bath every 2–3 days is the usual rhythm; daily is not needed. */
export const BATH_CADENCE_DAYS = { max: 3, min: 2 };

export type CadenceKind = 'bath' | 'feed';

export interface CadenceReminder {
  kind: CadenceKind;
  /** The gentlest useful next step, plus where the rhythm comes from. */
  message: string;
  /** What was last logged, and how long ago. */
  title: string;
}

export interface CadenceOptions {
  /** A feed being timed right now is a feed happening — no nudge needed. */
  feedInProgress?: boolean;
  now?: Date;
}

function getFeedReminder(events: CareEvent[], now: Date): CadenceReminder | null {
  const lastFeed = getLastEvent(events, (event) => event.type === 'feed');

  if (!lastFeed) {
    return null;
  }

  const minutesSince = Math.round((now.getTime() - new Date(lastFeed.startedAt).getTime()) / MINUTE);

  if (minutesSince < FEED_CADENCE_HOURS.max * 60) {
    return null;
  }

  return {
    kind: 'feed',
    message: `Feeds usually land every ${FEED_CADENCE_HOURS.min}–${FEED_CADENCE_HOURS.max} hours, day and night. Offer one when you can — if feeds keep slipping or something seems off, check in with your pediatrician.`,
    title: `Last feed was ${formatDuration(minutesSince)} ago`
  };
}

function getBathReminder(events: CareEvent[], now: Date): CadenceReminder | null {
  const lastBath = getLastEvent(events, (event) => event.type === 'bath');

  if (!lastBath) {
    return null;
  }

  // Baths are counted in calendar days, the way the dashboard shows them.
  if (getDaysAgo(lastBath.startedAt, now) < BATH_CADENCE_DAYS.max) {
    return null;
  }

  return {
    kind: 'bath',
    message: `Every ${BATH_CADENCE_DAYS.min}–${BATH_CADENCE_DAYS.max} days is the usual rhythm for a bath. No rush if today is busy — a quick top-and-tail counts.`,
    title: `Last bath was ${formatDaysAgo(lastBath.startedAt, now)}`
  };
}

/** Feeds come first: they are the one with a clock on them. */
export function getCadenceReminders(events: CareEvent[], options: CadenceOptions = {}): CadenceReminder[] {
  const { feedInProgress = false, now = new Date() } = options;

  return [feedInProgress ? null : getFeedReminder(events, now), getBathReminder(events, now)].filter(
    (reminder): reminder is CadenceReminder => reminder !== null
  );
}
