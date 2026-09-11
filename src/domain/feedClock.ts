import { getLocalDateKey } from './dates';
import { getEventDurationMinutes } from './summary';
import type { CareEvent, FeedEvent } from './types';

/**
 * How wide a band is, in hours. Three is the default: eight bands fit across a
 * phone and each holds enough feeds for its average length to mean something.
 * One hour is the truest picture of when a feed happens but spreads the same
 * feeds over 24 bands, so the lengths there rest on very few sessions each —
 * which is why the headline bands still have to clear `MIN_BAND_SAMPLES`.
 */
export const FEED_BAND_OPTIONS = [1, 2, 3] as const;
export type FeedBandHours = (typeof FEED_BAND_OPTIONS)[number];
export const DEFAULT_FEED_BAND_HOURS: FeedBandHours = 3;

/** Longer than this is a timer left running, not a feeding. */
const MAX_FEED_MINUTES = 4 * 60;

/** Under this much of a band actually observed, a per-day rate is extrapolation. */
const MIN_BAND_DAYS = 0.25;

/** An average length needs this many timed feeds before it can name a band. */
const MIN_BAND_SAMPLES = 3;

export interface FeedTimeBand {
  /** Mean length of the timed feeds here, or null when none carried one. */
  averageMinutes: number | null;
  /** Feeds that started inside this band, timed or not. */
  feeds: number;
  /** Feeds here per day the band was observed, or null with too little observed. */
  feedsPerDay: number | null;
  /** "6–9a" — the span in words. */
  label: string;
  maxMinutes: number | null;
  minMinutes: number | null;
  /** "6a" — the opening hour alone, for an axis tick. */
  shortLabel: string;
  /** Local hour the band opens on, 0–23. */
  startHour: number;
  /** Feeds here that carried a length — the ones the average can see. */
  timed: number;
}

export interface FeedClockReport {
  /** Mean length across every timed feed in the span, or null with none. */
  averageMinutes: number | null;
  /** How wide the bands are — the caller's choice, echoed back for labelling. */
  bandHours: FeedBandHours;
  bands: FeedTimeBand[];
  /** The band with the most feeds, null when nothing is logged. */
  busiest: FeedTimeBand | null;
  /** Days that logged a feed — the denominator behind `feedsPerDay`. */
  days: number;
  feeds: number;
  /** Where feeds run longest / shortest, over bands with enough timed feeds. */
  longest: FeedTimeBand | null;
  shortest: FeedTimeBand | null;
  timed: number;
}

function meridiem(hour: number) {
  return hour % 24 < 12 ? 'a' : 'p';
}

function clockHour(hour: number) {
  const twelve = hour % 12;
  return twelve === 0 ? 12 : twelve;
}

function formatHour(hour: number) {
  return `${clockHour(hour)}${meridiem(hour)}`;
}

/** "9a–12p", but "6–9a" when both ends share a meridiem — saying it twice is noise. */
function bandLabel(startHour: number, endHour: number) {
  return meridiem(startHour) === meridiem(endHour)
    ? `${clockHour(startHour)}–${formatHour(endHour)}`
    : `${formatHour(startHour)}–${formatHour(endHour)}`;
}

/**
 * How much of this band had happened on the given day, 0–1. A band later today
 * has not come round yet, so counting it as a whole day would make the evening
 * read quiet every morning — the same reasoning as `getDayFraction`, applied to
 * a slice of the day rather than the whole of it.
 */
function bandDayCoverage(dateKey: string, startHour: number, bandHours: number, now: Date) {
  const today = getLocalDateKey(now);

  if (dateKey < today) {
    return 1;
  }

  if (dateKey > today) {
    return 0;
  }

  const elapsedHours = now.getHours() + now.getMinutes() / 60;
  return Math.min(1, Math.max(0, (elapsedHours - startHour) / bandHours));
}

/** The feed's length in minutes, or null when it was never timed (most bottles). */
function feedMinutes(feed: FeedEvent) {
  const minutes = getEventDurationMinutes(feed);
  return minutes > 0 && minutes <= MAX_FEED_MINUTES ? minutes : null;
}

function mean(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * When feeds happen across the day, and how long they run at each of those
 * times. Feeds are bucketed by the local hour they *started*, so a session that
 * runs past the band it began in still belongs to the time it was offered.
 *
 * Describes the log and nothing more — see Guardrails.
 */
export function getFeedClockReport(
  events: CareEvent[],
  bandHours: FeedBandHours = DEFAULT_FEED_BAND_HOURS,
  now = new Date()
): FeedClockReport {
  const feeds = events.filter((event): event is FeedEvent => event.type === 'feed');
  const dateKeys = [...new Set(feeds.map((feed) => getLocalDateKey(feed.startedAt)))];
  const bandCount = 24 / bandHours;
  const lengths: number[][] = Array.from({ length: bandCount }, () => []);
  const counts: number[] = Array.from({ length: bandCount }, () => 0);

  for (const feed of feeds) {
    const index = Math.floor(new Date(feed.startedAt).getHours() / bandHours);
    const minutes = feedMinutes(feed);
    counts[index] += 1;

    if (minutes !== null) {
      lengths[index].push(minutes);
    }
  }

  const bands = counts.map((count, index) => {
    const startHour = index * bandHours;
    const bandLengths = lengths[index];
    const observedDays = dateKeys.reduce((total, dateKey) => total + bandDayCoverage(dateKey, startHour, bandHours, now), 0);

    return {
      averageMinutes: bandLengths.length > 0 ? mean(bandLengths) : null,
      feeds: count,
      feedsPerDay: observedDays >= MIN_BAND_DAYS ? count / observedDays : null,
      label: bandLabel(startHour, startHour + bandHours),
      maxMinutes: bandLengths.length > 0 ? Math.max(...bandLengths) : null,
      minMinutes: bandLengths.length > 0 ? Math.min(...bandLengths) : null,
      shortLabel: formatHour(startHour),
      startHour,
      timed: bandLengths.length
    };
  });

  // A band named on one or two feeds is describing those feeds, not a routine,
  // so the headline declines rather than guessing (as `predictNextDiaper` does).
  const rankable = bands.filter((band) => band.timed >= MIN_BAND_SAMPLES);
  const pick = (candidates: FeedTimeBand[], better: (band: FeedTimeBand, best: FeedTimeBand) => boolean) =>
    candidates.reduce<FeedTimeBand | null>((best, band) => (best === null || better(band, best) ? band : best), null);

  return {
    averageMinutes: lengths.flat().length > 0 ? mean(lengths.flat()) : null,
    bandHours,
    bands,
    busiest: pick(bands.filter((band) => band.feeds > 0), (band, best) => band.feeds > best.feeds),
    days: dateKeys.length,
    feeds: feeds.length,
    longest: pick(rankable, (band, best) => (band.averageMinutes as number) > (best.averageMinutes as number)),
    shortest: pick(rankable, (band, best) => (band.averageMinutes as number) < (best.averageMinutes as number)),
    timed: lengths.flat().length
  };
}
