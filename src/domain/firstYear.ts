import { getAgeDays, getLocalDateKey, minutesBetween } from './dates';
import type { BabyProfile, CareEvent } from './types';

const FIRST_YEAR_DAYS = 365;
const DAY_MS = 24 * 60 * 60_000;

export interface FirstYearPoint {
  dateKey: string;
  dayNumber: number;
  feeds: number;
  diapers: number;
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
    sleepHours: MetricStats;
    milkOunces: MetricStats;
    weightOz: MetricStats;
  };
  totalLogs: number;
}

function getAnchorDate(profile: BabyProfile) {
  return getLocalDateKey(profile.birthDate ?? profile.dueDate);
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
    feeds: 0,
    pumpOunces: 0,
    sleepMinutes: 0
  };
}

function getMetricStats(values: number[]): MetricStats {
  if (values.length === 0) {
    return { average: 0, max: 0, min: 0 };
  }

  return {
    average: values.reduce((total, value) => total + value, 0) / values.length,
    max: Math.max(...values),
    min: Math.min(...values)
  };
}

function valuesFor(points: FirstYearPoint[], selector: (point: FirstYearPoint) => number | undefined) {
  return points.map(selector).filter((value): value is number => value !== undefined);
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
      case 'breastfeed':
        point.feeds += 1;
        break;
      case 'bottle':
        point.feeds += 1;
        point.bottleOunces += event.amountOz;
        break;
      case 'diaper':
        point.diapers += 1;
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

  return {
    anchorDate,
    daysElapsed,
    points,
    progressPercent: Math.round((daysElapsed / FIRST_YEAR_DAYS) * 100),
    stats: {
      diapers: getMetricStats(valuesFor(points, (point) => (point.diapers > 0 ? point.diapers : undefined))),
      feeds: getMetricStats(valuesFor(points, (point) => (point.feeds > 0 ? point.feeds : undefined))),
      milkOunces: getMetricStats(valuesFor(points, (point) => {
        const ounces = point.bottleOunces + point.pumpOunces;
        return ounces > 0 ? ounces : undefined;
      })),
      sleepHours: getMetricStats(valuesFor(points, (point) => (point.sleepMinutes > 0 ? point.sleepMinutes / 60 : undefined))),
      weightOz: getMetricStats(valuesFor(points, (point) => point.weightOz))
    },
    totalLogs: firstYearEvents.length
  };
}
