import { getLocalDateKey } from '../dates';
import type { BabyProfile, CareEvent } from '../types';
import { getNewbornExpectation, type NewbornDayExpectation } from './newbornExpectations';
import { boyGrowthStandards, type GrowthMetric, type GrowthStandard, type StandardPoint } from './whoBoyStandards';

const DAY_MS = 24 * 60 * 60_000;
const AVG_DAYS_PER_MONTH = 365.25 / 12;

const OZ_TO_KG = 0.0283495;
const IN_TO_CM = 2.54;

/** A pregnancy carried to 40w0d. Anything earlier leaves age to correct for. */
const TERM_GESTATION_DAYS = 280;
/** Below 37w0d is preterm; 34w0d–36w6d is the "late preterm" window. */
const PRETERM_GESTATION_DAYS = 37 * 7;
const LATE_PRETERM_GESTATION_DAYS = 34 * 7;

export type GrowthBand = 'below' | 'within' | 'above';

/**
 * WHO standards are built on term births, so a preterm baby is normally plotted
 * at *corrected* age (chronological age minus the weeks missed) as well as at
 * actual age. The correction comes straight from the profile: the gap between
 * the birth date and the due date is exactly the time not spent in the womb.
 */
export interface GestationInfo {
  /** Completed gestation at birth, in days. */
  gestationalAgeDays: number;
  /** Days to subtract from chronological age. Zero for a term (or late) birth. */
  correctionDays: number;
  /** e.g. "36w2d". */
  label: string;
  preterm: boolean;
  latePreterm: boolean;
}

export function getGestationInfo(profile: BabyProfile): GestationInfo | null {
  if (!profile.birthDate) {
    return null;
  }

  const birth = new Date(`${getLocalDateKey(profile.birthDate)}T12:00:00`).getTime();
  const due = new Date(`${getLocalDateKey(profile.dueDate)}T12:00:00`).getTime();
  const earlyDays = Math.round((due - birth) / DAY_MS);
  const gestationalAgeDays = TERM_GESTATION_DAYS - earlyDays;

  return {
    correctionDays: Math.max(0, earlyDays),
    gestationalAgeDays,
    label: `${Math.floor(gestationalAgeDays / 7)}w${gestationalAgeDays % 7}d`,
    latePreterm: gestationalAgeDays >= LATE_PRETERM_GESTATION_DAYS && gestationalAgeDays < PRETERM_GESTATION_DAYS,
    preterm: gestationalAgeDays < PRETERM_GESTATION_DAYS
  };
}

export interface InterpolatedStandard {
  p2: number;
  median: number;
  p98: number;
}

export interface GrowthAssessment {
  metric: GrowthMetric;
  label: string;
  unit: string;
  ageMonths: number;
  /** The child's measurement converted into the standard's unit. */
  value: number;
  band: GrowthBand;
  standard: InterpolatedStandard;
  /** Human-readable verdict, e.g. "On track — near the median". */
  summary: string;
}

export interface GrowthMeasurement {
  dateKey: string;
  ageDays: number;
  ageMonths: number;
  /** Age with the preterm correction applied; equals `ageMonths` for a term birth. */
  correctedAgeMonths: number;
  lengthCm?: number;
  weightKg?: number;
  headCm?: number;
}

/** Which age a measurement is compared against. */
export type AgeBasis = 'actual' | 'corrected';

/** Linearly interpolate a standard's bounds at an arbitrary age in months. */
export function interpolateStandard(standard: GrowthStandard, ageMonths: number): InterpolatedStandard {
  const points = standard.points;
  const clamped = Math.max(points[0].month, Math.min(points[points.length - 1].month, ageMonths));

  let lower: StandardPoint = points[0];
  let upper: StandardPoint = points[points.length - 1];

  for (let i = 0; i < points.length - 1; i += 1) {
    if (clamped >= points[i].month && clamped <= points[i + 1].month) {
      lower = points[i];
      upper = points[i + 1];
      break;
    }
  }

  if (lower.month === upper.month) {
    return { median: lower.median, p2: lower.p2, p98: lower.p98 };
  }

  const ratio = (clamped - lower.month) / (upper.month - lower.month);
  const mix = (a: number, b: number) => a + (b - a) * ratio;

  return {
    median: mix(lower.median, upper.median),
    p2: mix(lower.p2, upper.p2),
    p98: mix(lower.p98, upper.p98)
  };
}

function describeBand(band: GrowthBand, value: number, standard: InterpolatedStandard): string {
  if (band === 'below') {
    return 'A bit below the expected range (under the WHO -2 SD line). One reading is just a snapshot — jot it down to review at the next visit.';
  }

  if (band === 'above') {
    return 'A bit above the expected range (over the WHO +2 SD line). One reading is just a snapshot — jot it down to review at the next visit.';
  }

  // Within range — describe position relative to the median.
  const span = standard.p98 - standard.median || 1;
  const delta = (value - standard.median) / span; // ~ -1..1 across the band half

  if (Math.abs(delta) <= 0.2) {
    return 'On track — right around the median.';
  }

  return delta < 0
    ? 'On track — below the median but within the normal range.'
    : 'On track — above the median but within the normal range.';
}

export function classifyMeasurement(metric: GrowthMetric, ageMonths: number, value: number): GrowthAssessment {
  const standard = boyGrowthStandards[metric];
  const bounds = interpolateStandard(standard, ageMonths);

  let band: GrowthBand = 'within';
  if (value < bounds.p2) {
    band = 'below';
  } else if (value > bounds.p98) {
    band = 'above';
  }

  return {
    ageMonths,
    band,
    label: standard.label,
    metric,
    standard: bounds,
    summary: describeBand(band, value, bounds),
    unit: standard.unit,
    value
  };
}

function ageAt(birthDate: string, iso: string) {
  const birth = new Date(`${getLocalDateKey(birthDate)}T12:00:00`).getTime();
  const at = new Date(iso).getTime();
  const ageDays = Math.max(0, Math.floor((at - birth) / DAY_MS));
  return { ageDays, ageMonths: ageDays / AVG_DAYS_PER_MONTH };
}

/** Extract growth/birth measurements (converted to metric units) sorted by age. */
export function getGrowthMeasurements(profile: BabyProfile, events: CareEvent[]): GrowthMeasurement[] {
  if (!profile.birthDate) {
    return [];
  }

  const correctionDays = getGestationInfo(profile)?.correctionDays ?? 0;
  const measurements: GrowthMeasurement[] = [];

  for (const event of events) {
    if (event.type !== 'growth' && event.type !== 'birth') {
      continue;
    }

    const hasData = event.weightOz != null || event.lengthIn != null || event.headCircumferenceIn != null;
    if (!hasData) {
      continue;
    }

    const { ageDays, ageMonths } = ageAt(profile.birthDate, event.startedAt);

    measurements.push({
      ageDays,
      ageMonths,
      // Before the due date the corrected age is negative; clamp to the
      // newborn end of the standards, which is the closest honest comparison.
      correctedAgeMonths: Math.max(0, (ageDays - correctionDays) / AVG_DAYS_PER_MONTH),
      dateKey: getLocalDateKey(event.startedAt),
      headCm: event.headCircumferenceIn != null ? event.headCircumferenceIn * IN_TO_CM : undefined,
      lengthCm: event.lengthIn != null ? event.lengthIn * IN_TO_CM : undefined,
      weightKg: event.weightOz != null ? event.weightOz * OZ_TO_KG : undefined
    });
  }

  return measurements.sort((a, b) => a.ageDays - b.ageDays);
}

export interface MetricPlot {
  ageMonths: number;
  correctedAgeMonths: number;
  value: number;
}

/** Plot points (in metric units) for a single standard. */
export function getMetricPlots(measurements: GrowthMeasurement[], metric: GrowthMetric): MetricPlot[] {
  const select = (m: GrowthMeasurement) =>
    metric === 'length' ? m.lengthCm : metric === 'weight' ? m.weightKg : m.headCm;

  return measurements
    .map((m) => ({ ageMonths: m.ageMonths, correctedAgeMonths: m.correctedAgeMonths, value: select(m) }))
    .filter((point): point is MetricPlot => point.value != null);
}

/** Assess the most recent measurement for each metric against the standards. */
export function assessLatestGrowth(
  profile: BabyProfile,
  events: CareEvent[],
  basis: AgeBasis = 'actual'
): GrowthAssessment[] {
  const measurements = getGrowthMeasurements(profile, events);
  const metrics: GrowthMetric[] = ['weight', 'length', 'head'];
  const assessments: GrowthAssessment[] = [];

  for (const metric of metrics) {
    const plots = getMetricPlots(measurements, metric);
    const latest = plots[plots.length - 1];
    if (latest) {
      const ageMonths = basis === 'corrected' ? latest.correctedAgeMonths : latest.ageMonths;
      assessments.push(classifyMeasurement(metric, ageMonths, latest.value));
    }
  }

  return assessments;
}

// ---------------------------------------------------------------------------
// Newborn early-window diaper / feed checks
// ---------------------------------------------------------------------------

/**
 * `pending` means the full-day minimum isn't met yet but the count is on pace
 * for how much of the day has actually happened — half the diapers by noon is
 * normal, so it must not read as a warning.
 */
export type RangeStatus = 'below' | 'pending' | 'within';

export interface NewbornMetricCheck {
  label: string;
  count: number;
  expectedMin: number;
  /** Pro-rated target for the elapsed part of the day (equals expectedMin once the day is over). */
  expectedByNow: number;
  status: RangeStatus;
}

export interface NewbornDayAssessment {
  dayOfLife: number;
  expectation: NewbornDayExpectation;
  checks: NewbornMetricCheck[];
  /** True when no tracked metric has fallen behind its pace. */
  onTrack: boolean;
  /** True once the day is over — a partial day is only judged against the pace. */
  dayComplete: boolean;
  /** Share of the day (from birth on day 1) that has elapsed, 0–1. */
  dayProgress: number;
  /** True when a metric is short of the full-day minimum but still on pace. */
  stillCounting: boolean;
}

export interface NewbornDailyCounts {
  wetDiapers: number;
  stoolDiapers: number;
  feeds: number;
}

export function getDayOfLife(birthDate: string, dateKey: string): number {
  const birth = new Date(`${getLocalDateKey(birthDate)}T00:00:00`).getTime();
  const day = new Date(`${dateKey}T00:00:00`).getTime();
  return Math.floor((day - birth) / DAY_MS) + 1;
}

/** Tally wet/stool diapers and feeds for a single local date. */
export function countNewbornDaily(events: CareEvent[], dateKey: string): NewbornDailyCounts {
  return events.reduce<NewbornDailyCounts>(
    (counts, event) => {
      if (getLocalDateKey(event.startedAt) !== dateKey) {
        return counts;
      }

      if (event.type === 'feed') {
        counts.feeds += 1;
      } else if (event.type === 'diaper') {
        if (event.kind === 'wet' || event.kind === 'both') {
          counts.wetDiapers += 1;
        }
        if (event.kind === 'dirty' || event.kind === 'both') {
          counts.stoolDiapers += 1;
        }
      }

      return counts;
    },
    { feeds: 0, stoolDiapers: 0, wetDiapers: 0 }
  );
}

/**
 * How much of `dateKey` has elapsed, as a 0–1 share. The birth day starts at
 * the birth itself rather than midnight, so a baby born at 6pm isn't measured
 * against a whole day of feeds.
 */
export function getDayProgress(birthDate: string, dateKey: string, now: Date = new Date()): number {
  const dayStart = new Date(`${dateKey}T00:00:00`).getTime();
  const dayEnd = dayStart + DAY_MS;
  const current = now.getTime();

  if (current >= dayEnd) {
    return 1;
  }

  // A date-only birthDate has no usable time of day, so fall back to midnight.
  const birth = birthDate.length > 10 ? new Date(birthDate).getTime() : Number.NaN;
  const start = Number.isFinite(birth) ? Math.max(dayStart, birth) : dayStart;

  if (current <= start) {
    return 0;
  }

  return Math.min(1, (current - start) / (dayEnd - start));
}

function buildCheck(label: string, count: number, expectedMin: number, progress: number): NewbornMetricCheck {
  // Floor keeps the pace target forgiving: 6 wet nappies by bedtime is only
  // 3 by noon, and a target of 0 early in the morning flags nothing.
  const expectedByNow = progress >= 1 ? expectedMin : Math.floor(expectedMin * progress);
  const status: RangeStatus = count >= expectedMin ? 'within' : count >= expectedByNow ? 'pending' : 'below';

  return { count, expectedByNow, expectedMin, label, status };
}

export function assessNewbornDay(
  profile: BabyProfile,
  events: CareEvent[],
  dateKey: string,
  now: Date = new Date()
): NewbornDayAssessment | null {
  if (!profile.birthDate) {
    return null;
  }

  const dayOfLife = getDayOfLife(profile.birthDate, dateKey);
  const expectation = getNewbornExpectation(dayOfLife);
  if (!expectation) {
    return null;
  }

  const counts = countNewbornDaily(events, dateKey);
  const dayProgress = getDayProgress(profile.birthDate, dateKey, now);

  const checks: NewbornMetricCheck[] = [
    buildCheck('Wet diapers', counts.wetDiapers, expectation.wetMin, dayProgress),
    buildCheck('Stools', counts.stoolDiapers, expectation.stoolMin, dayProgress),
    buildCheck('Feeds', counts.feeds, expectation.feedMin, dayProgress)
  ];

  return {
    checks,
    dayComplete: dayProgress >= 1,
    dayOfLife,
    dayProgress,
    expectation,
    onTrack: checks.every((check) => check.status !== 'below'),
    stillCounting: checks.some((check) => check.status === 'pending')
  };
}
