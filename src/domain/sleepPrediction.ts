import type { CareEvent } from './types';

/**
 * The Home sleep card's next transition: while asleep, roughly when this baby
 * usually wakes; while awake, roughly when they usually go back down.
 *
 * Read only from logged sleep entries — how long this baby's recent sleeps of
 * the same kind (night or nap) ran, and how long they stayed up between them.
 * Like `predictNextDiaper`, it declines rather than guessing from too little,
 * and it is a reading of the log, not advice about when a baby should sleep.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Only the last fortnight describes this baby's rhythm now. */
const LOOKBACK_DAYS = 14;
/** A sample's weight halves every 3 days, so a changing routine shows up fast. */
const RECENCY_HALF_LIFE_DAYS = 3;
/** Fewer samples than this and the card says nothing. */
export const MIN_SLEEP_SAMPLES = 3;
/** Over 16h is a timer left running, not a sleep (as in the parent report). */
const MAX_SLEEP_MINUTES = 16 * 60;
/** A longer stretch awake is a hole in the log, not a wake window. */
const MAX_WAKE_MINUTES = 8 * 60;
/** Half-width bounds for the window, whatever the spread works out to. */
const MIN_WINDOW_MINUTES = 15;
const MAX_WINDOW_MINUTES = 60;
/** Night runs 7pm–6am by start (or by waking, for a stretch awake). */
const NIGHT_START_HOUR = 19;
const NIGHT_END_HOUR = 6;

export type SleepTransition = 'sleep' | 'wake';

export interface SleepPrediction {
  expectedAt: string;
  /** Whether the stretch being read is a night's or a day's. */
  isNight: boolean;
  minutesAway: number;
  samples: number;
  /** `wake` while asleep, `sleep` while awake. */
  transition: SleepTransition;
  typicalMinutes: number;
  windowEndAt: string;
  windowStartAt: string;
}

export interface SleepPredictionOptions {
  /** A sleep under way — a running timer or an open entry. */
  asleepSince?: string;
  now?: Date;
}

interface Sample {
  at: number;
  minutes: number;
}

function timeOf(value: string) {
  return new Date(value).getTime();
}

export function isNightTime(time: number) {
  const hour = new Date(time).getHours();
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

function weightOf(sample: Sample, now: number) {
  const ageDays = Math.max(0, (now - sample.at) / DAY);
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

function weightedMean(samples: Sample[], now: number) {
  const total = samples.reduce((sum, sample) => sum + weightOf(sample, now), 0);
  return samples.reduce((sum, sample) => sum + sample.minutes * weightOf(sample, now), 0) / total;
}

function weightedSpread(samples: Sample[], mean: number, now: number) {
  const total = samples.reduce((sum, sample) => sum + weightOf(sample, now), 0);
  const variance = samples.reduce((sum, sample) => sum + weightOf(sample, now) * (sample.minutes - mean) ** 2, 0) / total;
  return Math.sqrt(variance);
}

/** Finished sleeps inside the lookback, oldest first, overlapping ones merged. */
function getFinishedSleeps(events: CareEvent[], now: number) {
  const spans = events
    .filter((event) => event.type === 'sleep' && event.endedAt)
    .map((event) => ({ end: timeOf(event.endedAt as string), start: timeOf(event.startedAt) }))
    .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end))
    .filter((span) => span.end > span.start && span.end <= now && now - span.end <= LOOKBACK_DAYS * DAY)
    .filter((span) => (span.end - span.start) / MINUTE <= MAX_SLEEP_MINUTES)
    .sort((a, b) => a.start - b.start);

  // Nobody is asleep twice at once: a backfilled night and the same night
  // logged by hand are one sleep.
  return spans.reduce<{ end: number; start: number }[]>((merged, span) => {
    const last = merged[merged.length - 1];
    if (last && span.start < last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
    return merged;
  }, []);
}

/** Same-kind samples when there are enough of them, every sample otherwise. */
function pickSamples(samples: (Sample & { night: boolean })[], night: boolean) {
  const same = samples.filter((sample) => sample.night === night);
  return same.length >= MIN_SLEEP_SAMPLES ? same : samples;
}

function buildPrediction(transition: SleepTransition, from: number, samples: Sample[], isNight: boolean, now: number): SleepPrediction | null {
  if (samples.length < MIN_SLEEP_SAMPLES) {
    return null;
  }

  const typicalMinutes = weightedMean(samples, now);
  const halfWindow = Math.min(MAX_WINDOW_MINUTES, Math.max(MIN_WINDOW_MINUTES, Math.round(weightedSpread(samples, typicalMinutes, now))));
  const expected = from + typicalMinutes * MINUTE;
  const windowEnd = expected + halfWindow * MINUTE;

  // Past the window by a whole typical stretch, the log went quiet — the card
  // would be predicting something that has plainly already happened.
  if (now - windowEnd > typicalMinutes * MINUTE) {
    return null;
  }

  return {
    expectedAt: new Date(expected).toISOString(),
    isNight,
    minutesAway: Math.round((expected - now) / MINUTE),
    samples: samples.length,
    transition,
    typicalMinutes: Math.round(typicalMinutes),
    windowEndAt: new Date(windowEnd).toISOString(),
    windowStartAt: new Date(expected - halfWindow * MINUTE).toISOString()
  };
}

export function predictNextSleepChange(events: CareEvent[], options: SleepPredictionOptions = {}): SleepPrediction | null {
  const now = (options.now ?? new Date()).getTime();
  const sleeps = getFinishedSleeps(events, now);

  if (options.asleepSince) {
    const start = timeOf(options.asleepSince);
    if (!Number.isFinite(start)) return null;
    const night = isNightTime(start);
    const durations = sleeps.map((sleep) => ({ at: sleep.end, minutes: (sleep.end - sleep.start) / MINUTE, night: isNightTime(sleep.start) }));
    return buildPrediction('wake', start, pickSamples(durations, night), night, now);
  }

  const last = sleeps[sleeps.length - 1];
  if (!last) return null;

  const wakes = sleeps
    .slice(1)
    .map((sleep, index) => ({ at: sleep.start, minutes: (sleep.start - sleeps[index].end) / MINUTE, night: isNightTime(sleeps[index].end) }))
    .filter((wake) => wake.minutes > 0 && wake.minutes <= MAX_WAKE_MINUTES);
  const night = isNightTime(last.end);
  return buildPrediction('sleep', last.end, pickSamples(wakes, night), night, now);
}
