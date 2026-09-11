import { getLocalDateKey } from './dates';
import { getEventDurationMinutes } from './summary';
import type { CareEvent } from './types';

/**
 * A parent's night runs across midnight, so a night is keyed by the *evening*
 * it started. Anything beginning before this hour is the tail of the night
 * before rather than a new day's sleep; anything after it starts that night.
 */
const MORNING_END_HOUR = 10;

/**
 * The stretch a baby event counts as night duty. Wider than the sleep window on
 * purpose: an 11pm feed is night duty whether or not anyone had got to bed.
 */
const NIGHT_DUTY_FROM_HOUR = 22;
const NIGHT_DUTY_TO_HOUR = 6;

/** A timer left running, not a sleep. Dropped the way feed spans over 4h are. */
const MAX_SLEEP_MINUTES = 16 * 60;

const DAY_MS = 86_400_000;

/** The baby events that are a caregiver's work, and so belong in their report. */
const CARE_EVENT_TYPES = new Set<CareEvent['type']>(['feed', 'diaper', 'pump', 'bath']);

export interface ParentNight {
  /** The evening the night started. */
  dateKey: string;
  sleepMinutes: number;
  /** The single longest unbroken session that night. */
  longestStretchMinutes: number;
  sessions: number;
  /** Baby events that landed inside one of that night's sleep sessions. */
  interruptions: number;
}

export interface CareCounts {
  total: number;
  feeds: number;
  nursingFeeds: number;
  diapers: number;
  pumps: number;
  /** Of those, the ones between 10pm and 6am. */
  nightEvents: number;
}

export interface LinkedCareLoad extends CareCounts {
  /** The share this parent is recorded as having done (`caregiverId`). */
  mine: CareCounts;
  /** Entries carrying no caregiver at all — unattributable, not unshared. */
  unattributed: number;
}

export interface ParentReport {
  /** Oldest first. Only nights that logged sleep appear. */
  nights: ParentNight[];
  averageSleepMinutes: number | null;
  shortestSleepMinutes: number | null;
  longestSleepMinutes: number | null;
  averageLongestStretchMinutes: number | null;
  averageInterruptions: number | null;
  totalSleepMinutes: number;
  care: LinkedCareLoad;
}

function hourOf(iso: string) {
  return new Date(iso).getHours();
}

/**
 * Which night a sleep session belongs to. Sleep in the small hours is keyed to
 * the evening before, so one night reads as one row rather than splitting at
 * midnight into two half-nights.
 */
export function getNightKey(iso: string) {
  const hour = hourOf(iso);
  const started = new Date(iso);

  if (hour < MORNING_END_HOUR) {
    return getLocalDateKey(new Date(started.getTime() - DAY_MS));
  }

  return getLocalDateKey(started);
}

export function isNightDuty(iso: string) {
  const hour = hourOf(iso);
  return hour >= NIGHT_DUTY_FROM_HOUR || hour < NIGHT_DUTY_TO_HOUR;
}

/** Sleep sessions worth counting: a real span, not a timer someone forgot. */
function getSleepSessions(parentEvents: CareEvent[]) {
  return parentEvents
    .filter((event) => event.type === 'sleep' && event.endedAt)
    .map((event) => ({
      endedAt: event.endedAt as string,
      minutes: getEventDurationMinutes(event),
      startedAt: event.startedAt
    }))
    .filter((session) => session.minutes > 0 && session.minutes <= MAX_SLEEP_MINUTES)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function average(values: number[]) {
  return values.length > 0 ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : null;
}

function emptyCounts(): CareCounts {
  return { diapers: 0, feeds: 0, nightEvents: 0, nursingFeeds: 0, pumps: 0, total: 0 };
}

function countCareEvent(counts: CareCounts, event: CareEvent) {
  counts.total += 1;

  if (event.type === 'feed') {
    counts.feeds += 1;
    if (event.method === 'nursing') {
      counts.nursingFeeds += 1;
    }
  } else if (event.type === 'diaper') {
    counts.diapers += 1;
  } else if (event.type === 'pump') {
    counts.pumps += 1;
  }

  if (isNightDuty(event.startedAt)) {
    counts.nightEvents += 1;
  }
}

/**
 * A parent's own nights, plus the baby events that touch them.
 *
 * An entry says who did it only when someone recorded it (`caregiverId`), so the
 * load comes back two ways: `care` is everything the household logged, `care.mine`
 * the share attributed to this parent, and `care.unattributed` the entries that
 * name nobody. A report that showed only the attributed share would read as "you
 * did less" on a log where people simply did not fill the field in.
 *
 * `interruptions` is a different question and needs no attribution at all: it
 * counts baby events that landed inside this parent's own logged sleep — not who
 * got up, but which of their sleeps was broken into.
 */
export function getParentReport(parentEvents: CareEvent[], childEvents: CareEvent[] = [], caregiverId?: string): ParentReport {
  const sessions = getSleepSessions(parentEvents);
  const nights = new Map<string, ParentNight>();

  for (const session of sessions) {
    const dateKey = getNightKey(session.startedAt);
    const night = nights.get(dateKey) ?? {
      dateKey,
      interruptions: 0,
      longestStretchMinutes: 0,
      sessions: 0,
      sleepMinutes: 0
    };

    night.sleepMinutes += session.minutes;
    night.longestStretchMinutes = Math.max(night.longestStretchMinutes, session.minutes);
    night.sessions += 1;
    nights.set(dateKey, night);
  }

  const care: LinkedCareLoad = { ...emptyCounts(), mine: emptyCounts(), unattributed: 0 };

  for (const event of childEvents) {
    if (!CARE_EVENT_TYPES.has(event.type)) {
      continue;
    }

    countCareEvent(care, event);

    if (!event.caregiverId) {
      care.unattributed += 1;
    } else if (caregiverId && event.caregiverId === caregiverId) {
      countCareEvent(care.mine, event);
    }

    const at = new Date(event.startedAt).getTime();
    const inside = sessions.find(
      (session) => at > new Date(session.startedAt).getTime() && at < new Date(session.endedAt).getTime()
    );

    if (inside) {
      const night = nights.get(getNightKey(inside.startedAt));

      if (night) {
        night.interruptions += 1;
      }
    }
  }

  const ordered = [...nights.values()].sort((left, right) => left.dateKey.localeCompare(right.dateKey));
  const totals = ordered.map((night) => night.sleepMinutes);

  return {
    averageInterruptions: ordered.length > 0
      ? Math.round((ordered.reduce((sum, night) => sum + night.interruptions, 0) / ordered.length) * 10) / 10
      : null,
    averageLongestStretchMinutes: average(ordered.map((night) => night.longestStretchMinutes)),
    averageSleepMinutes: average(totals),
    care,
    longestSleepMinutes: totals.length > 0 ? Math.max(...totals) : null,
    nights: ordered,
    shortestSleepMinutes: totals.length > 0 ? Math.min(...totals) : null,
    totalSleepMinutes: totals.reduce((total, value) => total + value, 0)
  };
}
