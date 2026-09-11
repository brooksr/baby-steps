import { getLocalDateKey, minutesBetween } from './dates';
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

/**
 * Time in bed is not time asleep. A logged sleep is the span someone went down
 * and got up; what the baby did in between is what decides how much of it was
 * actually rest, and these three numbers are how that is worked out.
 */
export interface RestOptions {
  /**
   * How long it takes to fall back asleep once a wakeup is over. Charged after
   * every wakeup, because the settling is the part that is never logged.
   */
  fallbackAsleepMinutes?: number;
  /**
   * Baby entries this close together are one wakeup, not several — a feed, a
   * change and a re-settle at 2am is one broken night, not three.
   */
  wakeupClusterMinutes?: number;
  /**
   * A stretch shorter than this between wakeups is not rest. Twenty minutes
   * with your eyes shut between feeds is not sleep, and counting it as such is
   * how a shattered night reads as seven hours.
   */
  minRestMinutes?: number;
}

export const DEFAULT_REST_OPTIONS: Required<RestOptions> = {
  fallbackAsleepMinutes: 15,
  minRestMinutes: 30,
  wakeupClusterMinutes: 30
};

/** One uninterrupted run at the baby, from the first entry to the last. */
export interface Wakeup {
  startedAt: string;
  endedAt: string;
  /** Entries in the cluster. */
  events: number;
}

export interface RestBreakdown {
  /** Minutes between lights-out and getting up. */
  inBedMinutes: number;
  /** Of that, the minutes that counted as rest. */
  restMinutes: number;
  /** The longest single stretch that counted. */
  longestRestMinutes: number;
  wakeups: Wakeup[];
  /** Minutes lost to wakeups and to settling back down. */
  awakeMinutes: number;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** The baby events that are a caregiver's work, and so belong in their report. */
const CARE_EVENT_TYPES = new Set<CareEvent['type']>(['feed', 'diaper', 'pump', 'bath']);

export interface ParentNight {
  /** The evening the night started. */
  dateKey: string;
  /** Rest, net of wakeups and settling — not time in bed. */
  sleepMinutes: number;
  /** Time in bed across the night's sessions. */
  inBedMinutes: number;
  /** The single longest stretch that counted as rest. */
  longestStretchMinutes: number;
  sessions: number;
  /** Wakeups that broke into the night's sleep, clustered. */
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
  averageInBedMinutes: number | null;
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

/**
 * Nobody is in bed twice at once. Two entries covering the same hours — a
 * backfilled night and the same night logged by hand, say — would otherwise be
 * added together and report a fourteen-hour night, so overlapping spans are
 * merged into the stretch they actually cover. Touching but separate spans (a
 * night and the nap after it) are left as two.
 */
function mergeOverlapping(sessions: Array<{ endedAt: string; minutes: number; startedAt: string }>) {
  const merged: Array<{ endedAt: string; minutes: number; startedAt: string }> = [];

  for (const session of sessions) {
    const current = merged[merged.length - 1];

    if (current && new Date(session.startedAt).getTime() < new Date(current.endedAt).getTime()) {
      if (new Date(session.endedAt).getTime() > new Date(current.endedAt).getTime()) {
        current.endedAt = session.endedAt;
        current.minutes = minutesBetween(current.startedAt, current.endedAt);
      }

      continue;
    }

    merged.push({ ...session });
  }

  return merged;
}

/** Sleep sessions worth counting: a real span, not a timer someone forgot. */
function getSleepSessions(parentEvents: CareEvent[]) {
  return mergeOverlapping(parentEvents
    .filter((event) => event.type === 'sleep' && event.endedAt)
    .map((event) => ({
      endedAt: event.endedAt as string,
      minutes: getEventDurationMinutes(event),
      startedAt: event.startedAt
    }))
    .filter((session) => session.minutes > 0 && session.minutes <= MAX_SLEEP_MINUTES)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt)));
}

/**
 * Which baby entries cost *this* parent sleep: **the ones recorded against
 * them**, and nothing else.
 *
 * An entry naming nobody used to count against whoever was asking, on the
 * grounds that it happened in the room. That is the wrong way round — it
 * charges a broken night to the parent who slept through it, which is exactly
 * what recording a caregiver is there to prevent. An unattributed entry is now
 * charged to no one; the report says how many of those there were, so a night
 * that looks unbroken can be checked against a field nobody filled in.
 *
 * With no parent named at all (a caller asking about the household rather than
 * a person) every entry still counts.
 */
function wokeThisParent(event: CareEvent, caregiverId?: string) {
  return !caregiverId || event.caregiverId === caregiverId;
}

/** Entries this close together are one run at the baby, not several. */
function clusterWakeups(events: CareEvent[], withinMinutes: number): Wakeup[] {
  const times = events.map((event) => new Date(event.startedAt).getTime()).sort((a, b) => a - b);
  const wakeups: Wakeup[] = [];

  for (const time of times) {
    const current = wakeups[wakeups.length - 1];

    if (current && time - new Date(current.endedAt).getTime() <= withinMinutes * MINUTE_MS) {
      current.endedAt = new Date(time).toISOString();
      current.events += 1;
      continue;
    }

    wakeups.push({ endedAt: new Date(time).toISOString(), events: 1, startedAt: new Date(time).toISOString() });
  }

  return wakeups;
}

/**
 * How much of a span in bed was actually rest.
 *
 * Every wakeup costs its own length plus the settling afterwards, and whatever
 * is left between wakeups only counts when it is long enough to be sleep. A
 * night of 7h30 in bed broken by three feeds is not seven and a half hours, and
 * this is the function that says so.
 */
export function getRest(
  startedAt: string,
  endedAt: string,
  babyEvents: CareEvent[] = [],
  options: RestOptions = {}
): RestBreakdown {
  const { fallbackAsleepMinutes, minRestMinutes, wakeupClusterMinutes } = { ...DEFAULT_REST_OPTIONS, ...options };
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  const inBedMinutes = Math.max(0, Math.round((end - start) / MINUTE_MS));

  const inside = babyEvents.filter((event) => {
    const at = new Date(event.startedAt).getTime();
    return at > start && at < end;
  });

  const wakeups = clusterWakeups(inside, wakeupClusterMinutes);
  const rests: number[] = [];
  let cursor = start;

  for (const wakeup of wakeups) {
    const wakeAt = new Date(wakeup.startedAt).getTime();
    rests.push(Math.round((wakeAt - cursor) / MINUTE_MS));
    // The settling is charged past the last entry of the cluster, and can run
    // past getting-up time — which simply means no rest was left after it.
    cursor = Math.min(end, new Date(wakeup.endedAt).getTime() + fallbackAsleepMinutes * MINUTE_MS);
  }

  rests.push(Math.round((end - cursor) / MINUTE_MS));

  const counted = rests.filter((minutes) => minutes >= minRestMinutes);
  const restMinutes = counted.reduce((total, minutes) => total + minutes, 0);

  return {
    awakeMinutes: Math.max(0, inBedMinutes - restMinutes),
    inBedMinutes,
    longestRestMinutes: counted.length > 0 ? Math.max(...counted) : 0,
    restMinutes,
    wakeups
  };
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
export function getParentReport(
  parentEvents: CareEvent[],
  childEvents: CareEvent[] = [],
  caregiverId?: string,
  options: RestOptions = {}
): ParentReport {
  const sessions = getSleepSessions(parentEvents);
  const care: LinkedCareLoad = { ...emptyCounts(), mine: emptyCounts(), unattributed: 0 };
  const careEvents = childEvents.filter((event) => CARE_EVENT_TYPES.has(event.type));

  for (const event of careEvents) {
    countCareEvent(care, event);

    if (!event.caregiverId) {
      care.unattributed += 1;
    } else if (caregiverId && event.caregiverId === caregiverId) {
      countCareEvent(care.mine, event);
    }
  }

  const wakers = careEvents.filter((event) => wokeThisParent(event, caregiverId));
  const nights = new Map<string, ParentNight>();

  for (const session of sessions) {
    const dateKey = getNightKey(session.startedAt);
    const rest = getRest(session.startedAt, session.endedAt, wakers, options);
    const night = nights.get(dateKey) ?? {
      dateKey,
      inBedMinutes: 0,
      interruptions: 0,
      longestStretchMinutes: 0,
      sessions: 0,
      sleepMinutes: 0
    };

    night.sleepMinutes += rest.restMinutes;
    night.inBedMinutes += rest.inBedMinutes;
    night.longestStretchMinutes = Math.max(night.longestStretchMinutes, rest.longestRestMinutes);
    night.interruptions += rest.wakeups.length;
    night.sessions += 1;
    nights.set(dateKey, night);
  }

  const ordered = [...nights.values()].sort((left, right) => left.dateKey.localeCompare(right.dateKey));
  const totals = ordered.map((night) => night.sleepMinutes);

  return {
    averageInterruptions: ordered.length > 0
      ? Math.round((ordered.reduce((sum, night) => sum + night.interruptions, 0) / ordered.length) * 10) / 10
      : null,
    averageInBedMinutes: average(ordered.map((night) => night.inBedMinutes)),
    averageLongestStretchMinutes: average(ordered.map((night) => night.longestStretchMinutes)),
    averageSleepMinutes: average(totals),
    care,
    longestSleepMinutes: totals.length > 0 ? Math.max(...totals) : null,
    nights: ordered,
    shortestSleepMinutes: totals.length > 0 ? Math.min(...totals) : null,
    totalSleepMinutes: totals.reduce((total, value) => total + value, 0)
  };
}
