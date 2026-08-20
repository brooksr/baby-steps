import { formatDuration } from './dates';
import type { CareEvent, DiaperEvent, FeedEvent } from './types';

const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;

/** A stretch longer than this is a hole in the log, not a real gap between changes. */
const MAX_DIAPER_GAP_MINUTES = 12 * 60;
/** Dirty diapers can legitimately be days apart, so they get a looser cap. */
const MAX_DIRTY_GAP_MINUTES = 3 * DAY_MINUTES;
/** A diaper later than this after a feed belongs to some other feed. */
const MAX_FEED_LAG_MINUTES = 6 * 60;
/** Recent days describe today better than old ones: a sample's weight halves every 3 days. */
const RECENCY_HALF_LIFE_DAYS = 3;
/** Below this many intervals the model is guessing, so it declines to answer. */
const MIN_GAP_SAMPLES = 4;
/** Dirty diapers are rarer than wet ones, so the kind guess settles for fewer. */
const MIN_DIRTY_GAP_SAMPLES = 3;
/** Half-width bounds for the predicted window, whatever the spread works out to. */
const MIN_WINDOW_MINUTES = 15;
const MAX_WINDOW_MINUTES = 90;
/** How far a feed since the last change pulls the interval-only estimate. */
const FEED_SIGNAL_WEIGHT = 0.4;
/** Spread-to-gap ratios a prediction has to beat to claim more than low confidence. */
const HIGH_CONFIDENCE_VARIATION = 0.35;
const MEDIUM_CONFIDENCE_VARIATION = 0.6;
const HIGH_CONFIDENCE_SAMPLES = 12;
const MEDIUM_CONFIDENCE_SAMPLES = 6;

export type DiaperConfidence = 'high' | 'low' | 'medium';

export interface FeedToDiaperLag {
  /** Mean minutes from a feed to the next diaper of this kind, or null with no pairs. */
  averageMinutes: number | null;
  /** Feeds that were followed by such a diaper inside the window. */
  samples: number;
}

export interface FeedToDiaperLags {
  dirty: FeedToDiaperLag;
  wet: FeedToDiaperLag;
}

export interface DiaperPrediction {
  /** Plain-language account of what drove the estimate. */
  basis: string;
  confidence: DiaperConfidence;
  expectedAt: string;
  likelyKind: 'dirty' | 'wet';
  /** Minutes from `now` to `expectedAt` — negative once the estimate has passed. */
  minutesAway: number;
  /** Effective number of intervals behind the estimate — old ones count for less. */
  samples: number;
  typicalGapMinutes: number;
  windowEndAt: string;
  windowStartAt: string;
}

interface WeightedSample {
  minutes: number;
  weight: number;
}

function timeOf(iso: string) {
  return new Date(iso).getTime();
}

function byStartedAt(a: CareEvent, b: CareEvent) {
  return timeOf(a.startedAt) - timeOf(b.startedAt);
}

export function getDiaperEvents(events: CareEvent[]): DiaperEvent[] {
  return events.filter((event): event is DiaperEvent => event.type === 'diaper').sort(byStartedAt);
}

function getFeedEvents(events: CareEvent[]): FeedEvent[] {
  return events.filter((event): event is FeedEvent => event.type === 'feed').sort(byStartedAt);
}

/** A "both" change counts as wet and as dirty, the way the daily totals count it. */
function coversWet(event: DiaperEvent) {
  return event.kind === 'wet' || event.kind === 'both';
}

function coversDirty(event: DiaperEvent) {
  return event.kind === 'dirty' || event.kind === 'both';
}

function recencyWeight(iso: string, now: Date) {
  const ageDays = Math.max(0, (now.getTime() - timeOf(iso)) / (DAY_MINUTES * MINUTE));
  return 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS);
}

function mean(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function weightedMean(samples: WeightedSample[]) {
  const totalWeight = samples.reduce((total, sample) => total + sample.weight, 0);

  // Weights decay toward zero on very old data; fall back to a plain mean rather
  // than dividing by nothing.
  if (totalWeight <= 0) {
    return mean(samples.map((sample) => sample.minutes));
  }

  return samples.reduce((total, sample) => total + sample.minutes * sample.weight, 0) / totalWeight;
}

function weightedSpread(samples: WeightedSample[], average: number) {
  const totalWeight = samples.reduce((total, sample) => total + sample.weight, 0);

  if (totalWeight <= 0) {
    return 0;
  }

  const variance = samples.reduce((total, sample) => total + sample.weight * (sample.minutes - average) ** 2, 0) / totalWeight;
  return Math.sqrt(variance);
}

/**
 * Kish effective sample size. A year of logs is thousands of intervals, but the
 * recency weighting means only the last week or so actually informs the answer —
 * this is how many intervals that is worth.
 */
function effectiveSampleSize(samples: WeightedSample[]) {
  const totalWeight = samples.reduce((total, sample) => total + sample.weight, 0);
  const totalSquaredWeight = samples.reduce((total, sample) => total + sample.weight ** 2, 0);

  return totalSquaredWeight > 0 ? totalWeight ** 2 / totalSquaredWeight : samples.length;
}

function getGapSamples(diapers: DiaperEvent[], now: Date, maxGapMinutes: number): WeightedSample[] {
  const samples: WeightedSample[] = [];

  for (let index = 1; index < diapers.length; index += 1) {
    const minutes = (timeOf(diapers[index].startedAt) - timeOf(diapers[index - 1].startedAt)) / MINUTE;

    if (minutes <= 0 || minutes > maxGapMinutes) {
      continue;
    }

    samples.push({ minutes, weight: recencyWeight(diapers[index].startedAt, now) });
  }

  return samples;
}

/** Both lists are sorted, so one forward-only cursor pairs every feed with its next diaper. */
function getLag(feeds: FeedEvent[], diaperTimes: number[]): FeedToDiaperLag {
  const lags: number[] = [];
  let cursor = 0;

  for (const feed of feeds) {
    const feedTime = timeOf(feed.startedAt);

    while (cursor < diaperTimes.length && diaperTimes[cursor] <= feedTime) {
      cursor += 1;
    }

    if (cursor >= diaperTimes.length) {
      break;
    }

    const minutes = (diaperTimes[cursor] - feedTime) / MINUTE;

    if (minutes <= MAX_FEED_LAG_MINUTES) {
      lags.push(minutes);
    }
  }

  return { averageMinutes: lags.length > 0 ? mean(lags) : null, samples: lags.length };
}

/**
 * How long after a feed the next wet and the next dirty diaper tend to arrive.
 * Feeds whose next diaper of that kind is further out than `MAX_FEED_LAG_MINUTES`
 * are dropped — by then the two are unrelated.
 */
export function getFeedToDiaperLags(events: CareEvent[]): FeedToDiaperLags {
  const feeds = getFeedEvents(events);
  const diapers = getDiaperEvents(events);
  const timesOf = (covers: (event: DiaperEvent) => boolean) => diapers.filter(covers).map((event) => timeOf(event.startedAt));

  return {
    dirty: getLag(feeds, timesOf(coversDirty)),
    wet: getLag(feeds, timesOf(coversWet))
  };
}

function getLikelyKind(diapers: DiaperEvent[], expectedTime: number, now: Date): 'dirty' | 'wet' {
  const dirtyDiapers = diapers.filter(coversDirty);
  const lastDirty = dirtyDiapers[dirtyDiapers.length - 1];
  const dirtyGaps = getGapSamples(dirtyDiapers, now, MAX_DIRTY_GAP_MINUTES);

  if (!lastDirty || dirtyGaps.length < MIN_DIRTY_GAP_SAMPLES) {
    return 'wet';
  }

  // Dirty if the usual dirty stretch will have run out by the predicted time.
  const sinceLastDirty = (expectedTime - timeOf(lastDirty.startedAt)) / MINUTE;
  return sinceLastDirty >= weightedMean(dirtyGaps) ? 'dirty' : 'wet';
}

function getConfidence(samples: number, variation: number): DiaperConfidence {
  if (samples >= HIGH_CONFIDENCE_SAMPLES && variation <= HIGH_CONFIDENCE_VARIATION) {
    return 'high';
  }

  if (samples >= MEDIUM_CONFIDENCE_SAMPLES && variation <= MEDIUM_CONFIDENCE_VARIATION) {
    return 'medium';
  }

  return 'low';
}

/**
 * Estimates when the next diaper change is due.
 *
 * The model is a recency-weighted average of how far apart recent changes have
 * been (weights halve every `RECENCY_HALF_LIFE_DAYS`, so a changing routine
 * shows up quickly), applied to the last logged change. A feed logged since
 * that change is evidence the interval history cannot see, so the estimate is
 * pulled toward the usual feed → wet-diaper lag. The spread of the same
 * intervals becomes the window and the confidence.
 *
 * Informational only — it describes the log, it does not diagnose anything.
 */
export function predictNextDiaper(events: CareEvent[], now = new Date()): DiaperPrediction | null {
  const diapers = getDiaperEvents(events);
  const lastDiaper = diapers[diapers.length - 1];

  if (!lastDiaper) {
    return null;
  }

  const gaps = getGapSamples(diapers, now, MAX_DIAPER_GAP_MINUTES);

  if (gaps.length < MIN_GAP_SAMPLES) {
    return null;
  }

  const typicalGapMinutes = weightedMean(gaps);
  const spread = weightedSpread(gaps, typicalGapMinutes);
  let expectedTime = timeOf(lastDiaper.startedAt) + typicalGapMinutes * MINUTE;

  const wetLag = getFeedToDiaperLags(events).wet;
  // Only a feed since the last change, and recent enough that the diaper it
  // leads to has not already come and gone, tells us anything new.
  const lastFeed = getFeedEvents(events)
    .filter((feed) => timeOf(feed.startedAt) > timeOf(lastDiaper.startedAt) && timeOf(feed.startedAt) <= now.getTime())
    .filter((feed) => (now.getTime() - timeOf(feed.startedAt)) / MINUTE <= MAX_FEED_LAG_MINUTES)
    .pop();
  const useFeedSignal = Boolean(lastFeed) && wetLag.averageMinutes !== null && wetLag.samples >= MIN_GAP_SAMPLES;

  if (lastFeed && useFeedSignal) {
    const feedEstimate = timeOf(lastFeed.startedAt) + (wetLag.averageMinutes as number) * MINUTE;
    expectedTime = expectedTime * (1 - FEED_SIGNAL_WEIGHT) + feedEstimate * FEED_SIGNAL_WEIGHT;
  }

  const halfWindow = Math.min(MAX_WINDOW_MINUTES, Math.max(MIN_WINDOW_MINUTES, Math.round(spread)));
  const minutesAway = Math.round((expectedTime - now.getTime()) / MINUTE);
  const variation = typicalGapMinutes > 0 ? spread / typicalGapMinutes : 1;
  const samples = Math.round(effectiveSampleSize(gaps));
  // A prediction more than a full gap stale means the log went quiet, not that a
  // change is very overdue.
  const confidence = minutesAway < -typicalGapMinutes ? 'low' : getConfidence(samples, variation);

  const basis = [
    `Typical ${formatDuration(Math.round(typicalGapMinutes))} between changes`,
    lastFeed && useFeedSignal
      ? `adjusted for the feed ${formatDuration(Math.max(0, Math.round((now.getTime() - timeOf(lastFeed.startedAt)) / MINUTE)))} ago`
      : null
  ]
    .filter(Boolean)
    .join(', ');

  return {
    basis: `${basis} · ${samples} recent gaps`,
    confidence,
    expectedAt: new Date(expectedTime).toISOString(),
    likelyKind: getLikelyKind(diapers, expectedTime, now),
    minutesAway,
    samples,
    typicalGapMinutes,
    windowEndAt: new Date(expectedTime + halfWindow * MINUTE).toISOString(),
    windowStartAt: new Date(expectedTime - halfWindow * MINUTE).toISOString()
  };
}
