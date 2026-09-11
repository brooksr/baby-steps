import { getAgeDays, getDayFraction, getLocalDateKey, minutesBetween } from './dates';
import { getPoopWeight } from './diaperDetails';
import type { BabyProfile, CareEvent } from './types';

const FIRST_YEAR_DAYS = 365;
const DAY_MS = 24 * 60 * 60_000;

export interface FirstYearPoint {
  dateKey: string;
  dayNumber: number;
  feeds: number;
  /** wet + dirty, so a "both" change counts once each way (as the dashboard shows it). */
  diapers: number;
  wetDiapers: number;
  dirtyDiapers: number;
  /** Dirty changes by recorded size. One logged without a size is in none of these. */
  dirtyLarge: number;
  dirtyMedium: number;
  dirtySmall: number;
  /** Dirty changes weighted by size (see `POOP_SIZE_WEIGHTS`). */
  poopLoad: number;
  sleepMinutes: number;
  bottleOunces: number;
  pumpOunces: number;
  weightOz?: number;
}

export interface MetricStats {
  average: number;
  max: number;
  min: number;
}

export interface FirstYearAnalytics {
  anchorDate: string;
  daysElapsed: number;
  progressPercent: number;
  points: FirstYearPoint[];
  stats: {
    feeds: MetricStats;
    diapers: MetricStats;
    /** Wet and dirty are averaged over days with any diaper logged, so the two
     *  splits add up to the `diapers` average rather than each counting its own days. */
    wetDiapers: MetricStats;
    dirtyDiapers: MetricStats;
    sleepHours: MetricStats;
    milkOunces: MetricStats;
    weightOz: MetricStats;
  };
  totalLogs: number;
}

function getAnchorDate(profile: BabyProfile) {
  // Falls back to when the profile was created: a parent has neither date, and
  // the first-year block is not about them anyway.
  return getLocalDateKey(profile.birthDate ?? profile.dueDate ?? profile.createdAt);
}

function inFirstYear(anchorDate: string, event: CareEvent) {
  const start = new Date(`${anchorDate}T00:00:00`).getTime();
  const eventTime = new Date(event.startedAt).getTime();
  return eventTime >= start && eventTime < start + FIRST_YEAR_DAYS * DAY_MS;
}

function emptyPoint(anchorDate: string, dateKey: string): FirstYearPoint {
  const dayNumber = Math.floor((new Date(`${dateKey}T00:00:00`).getTime() - new Date(`${anchorDate}T00:00:00`).getTime()) / DAY_MS) + 1;

  return {
    bottleOunces: 0,
    dateKey,
    dayNumber,
    diapers: 0,
    dirtyDiapers: 0,
    dirtyLarge: 0,
    dirtyMedium: 0,
    dirtySmall: 0,
    feeds: 0,
    poopLoad: 0,
    pumpOunces: 0,
    sleepMinutes: 0,
    wetDiapers: 0
  };
}

/** One day's worth of a metric, kept with its day so today can count as partial. */
export interface DayValue {
  dateKey: string;
  value: number;
}

/**
 * Per-day stats where today counts only as the fraction of it that has already
 * happened: three feeds by 9am is a pace of twelve a day, not a three-feed day,
 * and averaging it as a whole day would pull every average down all morning.
 *
 * Min and max stay off the day in progress while any finished day is available
 * — a day that isn't over yet has no total to be the lowest.
 */
export function getDayMetricStats(entries: DayValue[], now = new Date()): MetricStats {
  if (entries.length === 0) {
    return { average: 0, max: 0, min: 0 };
  }

  const weights = entries.map((entry) => getDayFraction(entry.dateKey, now));
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  const complete = entries.filter((_, index) => weights[index] >= 1).map((entry) => entry.value);
  const extremes = complete.length > 0 ? complete : entries.map((entry) => entry.value);

  return {
    average: totalWeight > 0 ? total / totalWeight : 0,
    max: Math.max(...extremes),
    min: Math.min(...extremes)
  };
}

/** A plain mean, for a metric that is a level rather than a per-day rate. */
function getLevelStats(values: number[]): MetricStats {
  if (values.length === 0) {
    return { average: 0, max: 0, min: 0 };
  }

  return {
    average: values.reduce((total, value) => total + value, 0) / values.length,
    max: Math.max(...values),
    min: Math.min(...values)
  };
}

function valuesFor(points: FirstYearPoint[], selector: (point: FirstYearPoint) => number | undefined): DayValue[] {
  return points
    .map((point) => ({ dateKey: point.dateKey, value: selector(point) }))
    .filter((entry): entry is DayValue => entry.value !== undefined);
}

export function getFirstYearEvents(profile: BabyProfile, events: CareEvent[]) {
  const anchorDate = getAnchorDate(profile);
  return events.filter((event) => inFirstYear(anchorDate, event));
}

export function getFirstYearAnalytics(profile: BabyProfile, events: CareEvent[], now = new Date()): FirstYearAnalytics {
  const anchorDate = getAnchorDate(profile);
  const pointMap = new Map<string, FirstYearPoint>();
  const firstYearEvents = getFirstYearEvents(profile, events);

  for (const event of firstYearEvents) {
    const dateKey = getLocalDateKey(event.startedAt);
    const point = pointMap.get(dateKey) ?? emptyPoint(anchorDate, dateKey);
    pointMap.set(dateKey, point);

    switch (event.type) {
      case 'feed':
        point.feeds += 1;
        if (event.method === 'bottle') {
          point.bottleOunces += event.amountOz ?? 0;
        }
        break;
      case 'diaper':
        if (event.kind === 'wet' || event.kind === 'both') {
          point.wetDiapers += 1;
          point.diapers += 1;
        }
        if (event.kind === 'dirty' || event.kind === 'both') {
          point.dirtyDiapers += 1;
          point.diapers += 1;
          point.poopLoad += getPoopWeight(event.poopSize);

          if (event.poopSize === 'large') {
            point.dirtyLarge += 1;
          } else if (event.poopSize === 'medium') {
            point.dirtyMedium += 1;
          } else if (event.poopSize === 'small') {
            point.dirtySmall += 1;
          }
        }
        break;
      case 'sleep':
        point.sleepMinutes += minutesBetween(event.startedAt, event.endedAt);
        break;
      case 'pump':
        point.pumpOunces += event.amountOz;
        break;
      case 'birth':
      case 'growth':
        if (event.weightOz) {
          point.weightOz = event.weightOz;
        }
        break;
      case 'appointment':
      case 'medication':
      case 'note':
        break;
    }
  }

  const points = [...pointMap.values()].sort((a, b) => a.dayNumber - b.dayNumber);
  const daysElapsed = profile.birthDate ? Math.min(FIRST_YEAR_DAYS, getAgeDays(profile, now) + 1) : 0;
  const dayStats = (selector: (point: FirstYearPoint) => number | undefined) => getDayMetricStats(valuesFor(points, selector), now);

  return {
    anchorDate,
    daysElapsed,
    points,
    progressPercent: Math.round((daysElapsed / FIRST_YEAR_DAYS) * 100),
    stats: {
      diapers: dayStats((point) => (point.diapers > 0 ? point.diapers : undefined)),
      dirtyDiapers: dayStats((point) => (point.diapers > 0 ? point.dirtyDiapers : undefined)),
      feeds: dayStats((point) => (point.feeds > 0 ? point.feeds : undefined)),
      milkOunces: dayStats((point) => {
        const ounces = point.bottleOunces + point.pumpOunces;
        return ounces > 0 ? ounces : undefined;
      }),
      sleepHours: dayStats((point) => (point.sleepMinutes > 0 ? point.sleepMinutes / 60 : undefined)),
      // A weight is a level, not a per-day rate, so a reading taken this morning
      // must not be scaled up the way a half-day of feeds is.
      weightOz: getLevelStats(valuesFor(points, (point) => point.weightOz).map((entry) => entry.value)),
      wetDiapers: dayStats((point) => (point.diapers > 0 ? point.wetDiapers : undefined))
    },
    totalLogs: firstYearEvents.length
  };
}
