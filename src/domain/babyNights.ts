import type { DateRange } from './dateRange';
import { getLocalDateKey } from './dates';
import type { NurseryData } from './nurserySensor';
import { getEventDurationMinutes } from './summary';
import type { CareEvent, CareEventType } from './types';

/**
 * A baby's night, read from what the household logged. Night feeds and changes
 * get logged at 2am because someone is up anyway; the sleep around them mostly
 * does not, so the night is worked out from the entries that interrupt it:
 *
 * - **Wakes** are night care entries (feeds, changes, meds, a temperature)
 *   clustered within `WAKE_CLUSTER_MINUTES` — a feed, a change and a re-settle
 *   at 2am is one wake, not three.
 * - **Sleep windows** are the stretches between wakes. Where a sleep entry was
 *   logged it is used as written; anywhere else the stretch is an *estimate*
 *   (the night minus each wake and `SETTLE_MINUTES` to settle back down), and
 *   every surface says which it is.
 * - **Heard crying** from the nursery sensor is laid over the top as a
 *   suggestion. It never adds a wake or takes away sleep: how much a phone hears
 *   depends on where it was left, and a model's guess is not a care record.
 *
 * Nights are keyed by the evening they start, like a parent's in
 * `parentReport.ts`, so one night is one row rather than two halves of a date.
 */

/** The night window, local time: 7pm to 7am. A logged bedtime or lie-in stretches it. */
export const NIGHT_START_HOUR = 19;
export const NIGHT_END_HOUR = 7;

/** Entries this close together are one wake. */
export const WAKE_CLUSTER_MINUTES = 30;

/**
 * Charged after every wake for going back down — nobody logs the settling.
 * A sleep entry logged after a wake replaces it with the time actually written.
 */
export const SETTLE_MINUTES = 15;

/**
 * A stretch shorter than this is not counted as sleep. Two wakes with less
 * between them are one long wake, and an entry this close to either end of the
 * night is going down or getting up rather than a wake.
 */
export const MIN_STRETCH_MINUTES = 30;

/** A timer left running, not a sleep — the cutoff the other reports use. */
const MAX_SLEEP_MINUTES = 16 * 60;
/** A feed this long is a timer left running; it is cut to this, not dropped. */
const MAX_FEED_MINUTES = 4 * 60;
/** How far before 7pm a logged bedtime can open the night, and past 7am a lie-in can close it. */
const STRETCH_HOURS = 3;
/**
 * The latest a logged sleep can start and still be bedtime, as hours after 7pm.
 * Past 11pm it is a resettle after a wake nobody logged the evening around.
 */
const BEDTIME_LATEST_HOURS = 4;
/**
 * With no bedtime logged, the first entries before 9pm are the bedtime feed and
 * change — going down, not a wake. Otherwise every evening reads as a broken night.
 */
const EVENING_SETTLE_HOURS = 2;
/** A logged sleep starting this soon after a wake is when the baby went back down. */
const RESETTLE_LOOKAHEAD_MINUTES = 60;
/** Cry episodes this close together are one bout of crying. */
const CRY_CLUSTER_MINUTES = 10;
/** A bout of crying this close to a logged wake is that wake, heard. */
const HEARD_MATCH_MINUTES = 15;
/** At least this share of a stretch inside logged sleep and it reads as logged. */
const LOGGED_SHARE = 0.9;

const WAKE_TYPES = new Set<CareEventType>(['diaper', 'feed', 'medication', 'temperature']);

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export type StretchSource = 'estimated' | 'logged' | 'mixed';

export interface SleepStretch {
  startedAt: string;
  endedAt: string;
  minutes: number;
  /** Logged as a sleep entry, worked out from the gaps between wakes, or some of each. */
  source: StretchSource;
}

export interface NightWake {
  startedAt: string;
  /** The last entry's end. */
  endedAt: string;
  /** Back asleep: a logged sleep's start, or `endedAt` plus `SETTLE_MINUTES`. */
  resumedAt: string;
  /** Entries in the wake. */
  entries: number;
  types: CareEventType[];
  /** Each entry, for drawing on the night's track. */
  items: Array<{ startedAt: string; type: CareEventType }>;
  /** The sensor heard crying around it. */
  heard: boolean;
}

export interface HeardCry {
  startedAt: string;
  endedAt: string;
  episodes: number;
  /** Lines up with a logged wake. One that does not is a possible wake, nothing more. */
  withWake: boolean;
}

export interface BabyNight {
  /** The evening the night started. */
  dateKey: string;
  /** What the night is measured over: 7pm–7am unless a logged bedtime or lie-in moved an end. */
  startedAt: string;
  endedAt: string;
  /** Still going; everything below runs to now. */
  inProgress: boolean;
  /** Anything at all was logged around this night. Without it there is nothing to say. */
  tracked: boolean;
  /** The first logged sleep of the night, when there is one. */
  bedtime: string | null;
  sleeps: SleepStretch[];
  /** Wakes between two stretches of sleep — the ones that broke the night. */
  wakes: NightWake[];
  /** Entries before the first stretch or after the last: going down and getting up. */
  edges: NightWake[];
  sleepMinutes: number;
  longestStretchMinutes: number;
  /** Some of the sleep was worked out rather than logged. */
  estimated: boolean;
  heard: HeardCry[];
  /** The sensor's own summary of the night, when the phone was running. */
  sensor: { coveragePercent: number; cryEpisodes: number } | null;
}

interface Span {
  end: number;
  start: number;
}

interface Cluster extends Span {
  entries: number;
  items: Array<{ start: number; type: CareEventType }>;
  resume: number;
  types: Set<CareEventType>;
}

const isoOf = (time: number) => new Date(time).toISOString();
const minutesOf = (span: Span) => Math.round((span.end - span.start) / MINUTE_MS);

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return { day, month: month - 1, year };
}

/** The night's evening date, `days` later (or earlier). Calendar arithmetic, so DST cannot skew it. */
export function shiftNightKey(dateKey: string, days: number) {
  const { day, month, year } = parseDateKey(dateKey);
  return getLocalDateKey(new Date(year, month, day + days, 12));
}

/** The night under way or most recently begun: tonight from 7pm, otherwise last night. */
export function getCurrentNightKey(now = new Date()) {
  const today = getLocalDateKey(now);
  return now.getHours() >= NIGHT_START_HOUR ? today : shiftNightKey(today, -1);
}

function getWindow(dateKey: string): Span {
  const { day, month, year } = parseDateKey(dateKey);

  return {
    end: new Date(year, month, day + 1, NIGHT_END_HOUR).getTime(),
    start: new Date(year, month, day, NIGHT_START_HOUR).getTime()
  };
}

/**
 * Logged sleep as spans, overlaps merged — nobody is asleep twice at once, and
 * a backfilled entry over one logged live must not count double. A sleep with
 * no end is still running, so it runs to now.
 */
function getSleepSpans(events: CareEvent[], now: number): Span[] {
  const spans = events
    .filter((event) => event.type === 'sleep')
    .map((event) => {
      const start = new Date(event.startedAt).getTime();
      const end = event.endedAt ? new Date(event.endedAt).getTime() : now;
      return { end, start };
    })
    .filter((span) => span.end > span.start && span.end - span.start <= MAX_SLEEP_MINUTES * MINUTE_MS)
    .sort((left, right) => left.start - right.start);
  const merged: Span[] = [];

  for (const span of spans) {
    const last = merged[merged.length - 1];

    if (last && span.start < last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  return merged;
}

function overlapMs(span: Span, spans: Span[]) {
  return spans.reduce((total, other) => total + Math.max(0, Math.min(span.end, other.end) - Math.max(span.start, other.start)), 0);
}

function toWake(cluster: Cluster, heard: HeardCry[]): NightWake {
  const near = (cry: HeardCry) =>
    new Date(cry.endedAt).getTime() >= cluster.start - HEARD_MATCH_MINUTES * MINUTE_MS &&
    new Date(cry.startedAt).getTime() <= cluster.resume + HEARD_MATCH_MINUTES * MINUTE_MS;

  return {
    endedAt: isoOf(cluster.end),
    entries: cluster.entries,
    heard: heard.some(near),
    items: cluster.items.map((item) => ({ startedAt: isoOf(item.start), type: item.type })),
    resumedAt: isoOf(cluster.resume),
    startedAt: isoOf(cluster.start),
    types: [...cluster.types].sort()
  };
}

/** Bouts of crying the sensor heard inside the night, closest episodes joined. */
function getHeardCries(nursery: NurseryData | null | undefined, span: Span): HeardCry[] {
  const episodes = (nursery?.episodes ?? [])
    .filter((episode) => episode.label === 'baby_cry')
    .map((episode) => ({ end: new Date(episode.endedAt).getTime(), start: new Date(episode.startedAt).getTime() }))
    .filter((episode) => episode.start >= span.start && episode.start < span.end)
    .sort((left, right) => left.start - right.start);
  const bouts: Array<Span & { episodes: number }> = [];

  for (const episode of episodes) {
    const last = bouts[bouts.length - 1];

    if (last && episode.start <= last.end + CRY_CLUSTER_MINUTES * MINUTE_MS) {
      last.end = Math.max(last.end, episode.end);
      last.episodes += 1;
    } else {
      bouts.push({ ...episode, episodes: 1 });
    }
  }

  return bouts.map((bout) => ({ endedAt: isoOf(bout.end), episodes: bout.episodes, startedAt: isoOf(bout.start), withWake: false }));
}

function getSensorSummary(nursery: NurseryData | null | undefined, dateKey: string) {
  // Two phones on one night: the one that heard more of it speaks for it.
  const rows = (nursery?.nights ?? []).filter((night) => night.nightOf === dateKey);

  if (rows.length === 0) {
    return null;
  }

  const best = rows.reduce((left, right) => (right.coveragePercent > left.coveragePercent ? right : left));
  return { coveragePercent: best.coveragePercent, cryEpisodes: best.cryEpisodes };
}

export function getBabyNight(events: CareEvent[], dateKey: string, nursery?: NurseryData | null, now = new Date()): BabyNight {
  const nowMs = now.getTime();
  const window = getWindow(dateKey);
  const sleepSpans = getSleepSpans(events, nowMs);
  const stretch = STRETCH_HOURS * HOUR_MS;

  // A logged bedtime opens the night, earlier or later than 7pm: the evening
  // before it was awake time, and a stretch before it is not sleep.
  const bedSpan = sleepSpans.find(
    (span) => span.end > window.start && span.start >= window.start - stretch && span.start < window.start + BEDTIME_LATEST_HOURS * HOUR_MS
  );
  const lieIn = sleepSpans.find((span) => span.start < window.end && span.end > window.end);
  const span: Span = {
    end: lieIn ? Math.min(lieIn.end, window.end + stretch) : window.end,
    start: bedSpan ? bedSpan.start : window.start
  };
  const inProgress = nowMs < span.end;
  const until = Math.min(span.end, nowMs);
  const heard = getHeardCries(nursery, { end: until, start: span.start });
  const night: BabyNight = {
    bedtime: bedSpan ? isoOf(bedSpan.start) : null,
    dateKey,
    edges: [],
    endedAt: isoOf(span.end),
    estimated: false,
    heard,
    inProgress,
    longestStretchMinutes: 0,
    sensor: getSensorSummary(nursery, dateKey),
    sleepMinutes: 0,
    sleeps: [],
    startedAt: isoOf(span.start),
    tracked: false,
    wakes: []
  };

  const margin = 2 * HOUR_MS;
  night.tracked =
    until > span.start &&
    events.some((event) => {
      if (event.type !== 'sleep' && !WAKE_TYPES.has(event.type)) {
        return false;
      }

      const time = new Date(event.startedAt).getTime();
      return time >= window.start - margin && time < window.end + margin;
    });

  if (!night.tracked) {
    return night;
  }

  const entries = events
    .filter((event) => WAKE_TYPES.has(event.type))
    .map((event) => {
      const start = new Date(event.startedAt).getTime();
      return { end: start + Math.min(getEventDurationMinutes(event), MAX_FEED_MINUTES) * MINUTE_MS, start, type: event.type };
    })
    .filter((entry) => entry.start >= span.start && entry.start < until)
    .sort((left, right) => left.start - right.start);
  const clusters: Cluster[] = [];

  for (const entry of entries) {
    const last = clusters[clusters.length - 1];

    if (last && entry.start <= last.end + WAKE_CLUSTER_MINUTES * MINUTE_MS) {
      last.end = Math.max(last.end, entry.end);
      last.entries += 1;
      last.items.push({ start: entry.start, type: entry.type });
      last.types.add(entry.type);
    } else {
      clusters.push({ end: entry.end, entries: 1, items: [{ start: entry.start, type: entry.type }], resume: entry.end, start: entry.start, types: new Set([entry.type]) });
    }
  }

  for (const cluster of clusters) {
    // A logged sleep that ended just before is when the wake really began, and
    // one starting soon after is when the baby went back down.
    const ended = sleepSpans.find((sleep) => sleep.end <= cluster.start && sleep.end >= cluster.start - WAKE_CLUSTER_MINUTES * MINUTE_MS && sleep.end > span.start);
    const resettled = sleepSpans.find((sleep) => sleep.start >= cluster.end && sleep.start <= cluster.end + RESETTLE_LOOKAHEAD_MINUTES * MINUTE_MS);

    cluster.start = ended ? ended.end : cluster.start;
    cluster.resume = Math.min(until, resettled ? resettled.start : cluster.end + SETTLE_MINUTES * MINUTE_MS);
  }

  // Too little between two wakes to count as sleep makes them one long wake.
  const wakes: Cluster[] = [];

  for (const cluster of clusters) {
    const last = wakes[wakes.length - 1];

    if (last && cluster.start - last.resume < MIN_STRETCH_MINUTES * MINUTE_MS) {
      last.end = Math.max(last.end, cluster.end);
      last.resume = Math.max(last.resume, cluster.resume);
      last.entries += cluster.entries;
      last.items.push(...cluster.items);
      cluster.types.forEach((type) => last.types.add(type));
    } else {
      wakes.push(cluster);
    }
  }

  const minStretch = MIN_STRETCH_MINUTES * MINUTE_MS;
  let before = wakes[0] && wakes[0].start - span.start < minStretch ? wakes.shift() : undefined;

  // No bedtime logged: everything before 9pm is the routine of going down,
  // however many entries it took — a change at 7:15 and a feed at 8:05 included.
  while (!bedSpan && wakes[0] && wakes[0].start < window.start + EVENING_SETTLE_HOURS * HOUR_MS) {
    const next = wakes.shift() as Cluster;
    before = before
      ? {
          ...before,
          end: Math.max(before.end, next.end),
          entries: before.entries + next.entries,
          items: [...before.items, ...next.items],
          resume: next.resume,
          types: new Set([...before.types, ...next.types])
        }
      : next;
  }
  // Mid-night, a wake that is still going is a wake. Only a finished night has a morning.
  const last = wakes[wakes.length - 1];
  const after = !inProgress && last && until - last.resume < minStretch ? wakes.pop() : undefined;

  const bounds: Span[] = [];
  let cursor = before ? before.resume : span.start;

  for (const wake of wakes) {
    bounds.push({ end: wake.start, start: cursor });
    cursor = wake.resume;
  }

  bounds.push({ end: after ? after.start : until, start: cursor });

  night.sleeps = bounds
    .filter((bound) => bound.end - bound.start >= minStretch)
    .map((bound) => {
      const share = overlapMs(bound, sleepSpans) / (bound.end - bound.start);
      const source: StretchSource = share >= LOGGED_SHARE ? 'logged' : share > 0 ? 'mixed' : 'estimated';
      return { endedAt: isoOf(bound.end), minutes: minutesOf(bound), source, startedAt: isoOf(bound.start) };
    });
  night.wakes = wakes.map((wake) => toWake(wake, heard));
  night.edges = [before, after].filter((edge): edge is Cluster => Boolean(edge)).map((edge) => toWake(edge, heard));
  night.sleepMinutes = night.sleeps.reduce((total, sleep) => total + sleep.minutes, 0);
  night.longestStretchMinutes = night.sleeps.reduce((longest, sleep) => Math.max(longest, sleep.minutes), 0);
  night.estimated = night.sleeps.some((sleep) => sleep.source !== 'logged');

  const logged = [...night.wakes, ...night.edges];
  night.heard = heard.map((cry) => {
    const start = new Date(cry.startedAt).getTime();
    const end = new Date(cry.endedAt).getTime();
    const withWake = logged.some(
      (wake) =>
        end >= new Date(wake.startedAt).getTime() - HEARD_MATCH_MINUTES * MINUTE_MS &&
        start <= new Date(wake.resumedAt).getTime() + HEARD_MATCH_MINUTES * MINUTE_MS
    );
    return { ...cry, withWake };
  });

  return night;
}

export interface NightStat {
  average: number;
  max: number;
  min: number;
}

export interface BabyNightsReport {
  /** The finished nights counted, oldest first. Nights nothing was logged around are left out. */
  nights: BabyNight[];
  /** How many nights the range covered, tracked or not. */
  span: number;
  sleepMinutes: NightStat | null;
  wakes: NightStat | null;
  longestStretchMinutes: NightStat | null;
  /** Logged daytime sleep (7am–7pm) per day, over the days any was logged. */
  napMinutes: NightStat | null;
  /** Nights whose sleep was at least partly worked out rather than logged. */
  estimatedNights: number;
}

function stat(values: number[]): NightStat | null {
  if (values.length === 0) {
    return null;
  }

  return {
    average: values.reduce((total, value) => total + value, 0) / values.length,
    max: Math.max(...values),
    min: Math.min(...values)
  };
}

/** Logged sleep inside the day before a night: 7am to 7pm on its evening's date. */
function getNapMinutes(sleepSpans: Span[], dateKey: string) {
  const day = { end: getWindow(dateKey).start, start: getWindow(shiftNightKey(dateKey, -1)).end };
  return Math.round(overlapMs(day, sleepSpans) / MINUTE_MS);
}

/** The most recent night that has finished — the night under way never is. */
export function getLastFinishedNightKey(events: CareEvent[], now = new Date()) {
  const current = getCurrentNightKey(now);
  return getBabyNight(events, current, null, now).inProgress ? shiftNightKey(current, -1) : current;
}

/** The last `count` finished nights as a range of evening dates, for the Week/Month/Year periods. */
export function getRecentNightsRange(events: CareEvent[], count: number, now = new Date()): DateRange {
  const to = getLastFinishedNightKey(events, now);
  return { from: shiftNightKey(to, 1 - count), to };
}

/**
 * The finished nights whose evening falls in `range`. An open start begins at
 * the first logged entry; an open or future end stops at the last finished
 * night, since half a night would drag every figure down until morning.
 */
export function getBabyNightsReport(events: CareEvent[], nursery: NurseryData | null | undefined, range: DateRange, now = new Date()): BabyNightsReport {
  const lastFinished = getLastFinishedNightKey(events, now);
  const earliest = events.reduce<string | null>((first, event) => (!first || event.startedAt < first ? event.startedAt : first), null);
  const [low, high] = range.from && range.to && range.from > range.to ? [range.to, range.from] : [range.from, range.to];
  const from = low || (earliest ? shiftNightKey(getLocalDateKey(earliest), -1) : lastFinished);
  const to = high && high < lastFinished ? high : lastFinished;
  const keys: string[] = [];

  for (let key = from; key <= to; key = shiftNightKey(key, 1)) {
    keys.push(key);
  }

  // Each night only needs the entries around it, so a year of nights does not
  // walk the whole log 365 times over.
  const sorted = [...events].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const nights = keys
    .map((key) => {
      const window = getWindow(key);
      const nearby = sorted.filter((event) => {
        const time = new Date(event.startedAt).getTime();
        return time >= window.start - MAX_SLEEP_MINUTES * MINUTE_MS && time < window.end + MAX_SLEEP_MINUTES * MINUTE_MS;
      });
      return getBabyNight(nearby, key, nursery, now);
    })
    .filter((night) => night.tracked && !night.inProgress);
  const sleepSpans = getSleepSpans(events, now.getTime());
  const naps = keys.map((key) => getNapMinutes(sleepSpans, key)).filter((minutes) => minutes > 0);

  return {
    estimatedNights: nights.filter((night) => night.estimated).length,
    longestStretchMinutes: stat(nights.map((night) => night.longestStretchMinutes)),
    napMinutes: stat(naps),
    nights,
    sleepMinutes: stat(nights.map((night) => night.sleepMinutes)),
    span: keys.length,
    wakes: stat(nights.map((night) => night.wakes.length))
  };
}
