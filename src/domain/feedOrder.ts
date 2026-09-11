import { getLocalDateKey } from './dates';
import type { CareEvent, FeedEvent } from './types';

const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;

/**
 * Where a feeding day begins. Counting from midnight made a 1am feed the *first*
 * feed of a new day when it is really the tail of the night before, which put a
 * Feed 1 in the small hours and pushed the whole sequence out of step. Five is
 * late enough to be past the night feeds and early enough that a genuine morning
 * start still lands on the right day.
 */
export const FEED_DAY_START_HOUR = 5;
const DAY_START_MINUTES = FEED_DAY_START_HOUR * 60;

/** Under this many days an index describes a day or two, not a routine. */
const MIN_ORDER_DAYS = 3;

/**
 * Only a day with an ordinary full run of feeds shapes the sequence. A day
 * holding three feeds is a hole in the log or the ragged end of the selected
 * range, not a short day — and folding one in stretches every index across the
 * clock, because its lone morning feed is "feed 1" exactly like a proper day's
 * and its afternoon one is "feed 2" where a full day is on its fifth. Trimming
 * to the ordinary range is what makes a row's spread mean "when this feed
 * happens" rather than "how uneven the logging was".
 */
export const FEED_DAY_MIN_FEEDS = 9;
export const FEED_DAY_MAX_FEEDS = 11;

export interface FeedOrderSlot {
  /** Mean minutes since that day's previous feed. Null for the first of the day. */
  averageGapMinutes: number | null;
  /** Mean minutes after the day start, 0–1440. Read it with `toClockMinutes`. */
  averageOffset: number;
  /** Days that logged an Nth feed. */
  days: number;
  earliestOffset: number;
  /** 1-based position within the feeding day. */
  index: number;
  latestOffset: number;
  /** Whether enough days reached this index for its average to describe a routine. */
  typical: boolean;
}

export interface FeedOrderReport {
  /** Where the feeding day begins, as minutes after local midnight. */
  dayStartMinutes: number;
  /** Feeding days that shaped the sequence — those inside the feed-count range. */
  days: number;
  /** Feeds a day, over the counted days — roughly where the sequence runs out. */
  feedsPerDay: number;
  /** Every feeding day that logged a feed, counted or not. */
  loggedDays: number;
  slots: FeedOrderSlot[];
  /** How far the sequence runs before it rests on too few days. */
  typicalCount: number;
}

/**
 * An offset back to a wall-clock time, as minutes after local midnight — what
 * `formatMinutesOfDay` wants. Slots are stored as offsets so they sort and plot
 * in the order the day happens; only the reading is in clock time.
 */
export function toClockMinutes(offset: number, dayStartMinutes = DAY_START_MINUTES) {
  return (offset + dayStartMinutes) % DAY_MINUTES;
}

function timeOf(iso: string) {
  return new Date(iso).getTime();
}

/**
 * The feeding day a moment belongs to. Anything before the start hour closes out
 * the previous day. Shifting the calendar date rather than subtracting hours
 * keeps this right across a DST change.
 */
function feedDayKey(iso: string) {
  const date = new Date(iso);

  if (date.getHours() < FEED_DAY_START_HOUR) {
    date.setDate(date.getDate() - 1);
  }

  return getLocalDateKey(date);
}

/** Minutes since the day started — 0 at 5am, running to 1440 at the next 5am. */
function offsetMinutes(iso: string) {
  const date = new Date(iso);
  return (date.getHours() * 60 + date.getMinutes() - DAY_START_MINUTES + DAY_MINUTES) % DAY_MINUTES;
}

function mean(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * The shape of the day by feed *order*: when the first feed of the day tends to
 * land, then the second, and so on. Feeds are numbered within their feeding day
 * and averaged across days, so it answers "what time is the third feed usually?"
 * where the feed clock answers "how busy is 9am?".
 *
 * Only days logging between `FEED_DAY_MIN_FEEDS` and `FEED_DAY_MAX_FEEDS` feeds
 * are counted, so a half-logged day cannot pass its stray feed off as a first or
 * second feed. Within those days each index averages only the ones that reached
 * it, so a day still in progress contributes the feeds it has had without
 * dragging down the ones it has not. Averaging offsets rather
 * than clock times is what lets the day cross midnight: 11pm and 1am are 18h
 * and 20h into the same day, not 23h and 1h into different ones.
 *
 * Describes the log and nothing more — see Guardrails.
 */
export function getFeedOrderReport(events: CareEvent[]): FeedOrderReport {
  const feeds = events
    .filter((event): event is FeedEvent => event.type === 'feed')
    .sort((a, b) => timeOf(a.startedAt) - timeOf(b.startedAt));

  const byDay = new Map<string, FeedEvent[]>();

  for (const feed of feeds) {
    const dayKey = feedDayKey(feed.startedAt);
    const day = byDay.get(dayKey) ?? [];
    day.push(feed);
    byDay.set(dayKey, day);
  }

  // Days outside the ordinary range are dropped whole: a day is either a normal
  // one whose sequence means something, or it is not one to learn from at all.
  const countedDays = [...byDay.values()].filter(
    (day) => day.length >= FEED_DAY_MIN_FEEDS && day.length <= FEED_DAY_MAX_FEEDS
  );
  const countedFeeds = countedDays.reduce((total, day) => total + day.length, 0);

  const samples: { gaps: number[]; offsets: number[] }[] = [];

  for (const day of countedDays) {
    day.forEach((feed, index) => {
      const slot = samples[index] ?? { gaps: [], offsets: [] };
      samples[index] = slot;
      slot.offsets.push(offsetMinutes(feed.startedAt));

      if (index > 0) {
        slot.gaps.push((timeOf(feed.startedAt) - timeOf(day[index - 1].startedAt)) / MINUTE);
      }
    });
  }

  const slots = samples.map((slot, index) => ({
    averageGapMinutes: slot.gaps.length > 0 ? mean(slot.gaps) : null,
    averageOffset: mean(slot.offsets),
    days: slot.offsets.length,
    earliestOffset: Math.min(...slot.offsets),
    index: index + 1,
    latestOffset: Math.max(...slot.offsets),
    typical: slot.offsets.length >= MIN_ORDER_DAYS
  }));

  // Where the routine stops: the first index too thin to trust ends it, so a
  // single fourteen-feed day cannot stretch the sequence past the rest.
  const firstSparse = slots.findIndex((slot) => !slot.typical);

  return {
    dayStartMinutes: DAY_START_MINUTES,
    days: countedDays.length,
    feedsPerDay: countedDays.length > 0 ? countedFeeds / countedDays.length : 0,
    loggedDays: byDay.size,
    slots,
    typicalCount: firstSparse === -1 ? slots.length : firstSparse
  };
}
