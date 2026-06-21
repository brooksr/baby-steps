import { getLocalDateKey } from '../dates';
import type { BabyProfile, CareEvent } from '../types';
import { getNewbornExpectation, type NewbornDayExpectation } from './newbornExpectations';
import { boyGrowthStandards, type GrowthMetric, type GrowthStandard, type StandardPoint } from './whoBoyStandards';

const DAY_MS = 24 * 60 * 60_000;
const AVG_DAYS_PER_MONTH = 365.25 / 12;

const OZ_TO_KG = 0.0283495;
const IN_TO_CM = 2.54;

export type GrowthBand = 'below' | 'within' | 'above';

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
  lengthCm?: number;
  weightKg?: number;
  headCm?: number;
}

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
  value: number;
}

/** Plot points (in metric units) for a single standard. */
export function getMetricPlots(measurements: GrowthMeasurement[], metric: GrowthMetric): MetricPlot[] {
  const select = (m: GrowthMeasurement) =>
    metric === 'length' ? m.lengthCm : metric === 'weight' ? m.weightKg : m.headCm;

  return measurements
    .map((m) => ({ ageMonths: m.ageMonths, value: select(m) }))
    .filter((point): point is MetricPlot => point.value != null);
}

/** Assess the most recent measurement for each metric against the standards. */
export function assessLatestGrowth(profile: BabyProfile, events: CareEvent[]): GrowthAssessment[] {
  const measurements = getGrowthMeasurements(profile, events);
  const metrics: GrowthMetric[] = ['weight', 'length', 'head'];
  const assessments: GrowthAssessment[] = [];

  for (const metric of metrics) {
    const plots = getMetricPlots(measurements, metric);
    const latest = plots[plots.length - 1];
    if (latest) {
      assessments.push(classifyMeasurement(metric, latest.ageMonths, latest.value));
    }
  }

  return assessments;
}

// ---------------------------------------------------------------------------
// Newborn early-window diaper / feed checks
// ---------------------------------------------------------------------------

export type RangeStatus = 'below' | 'within';

export interface NewbornMetricCheck {
  label: string;
  count: number;
  expectedMin: number;
  status: RangeStatus;
}

export interface NewbornDayAssessment {
  dayOfLife: number;
  expectation: NewbornDayExpectation;
  checks: NewbornMetricCheck[];
  /** True when every tracked metric meets its minimum. */
  onTrack: boolean;
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

      if (event.type === 'breastfeed' || event.type === 'bottle') {
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

export function assessNewbornDay(profile: BabyProfile, events: CareEvent[], dateKey: string): NewbornDayAssessment | null {
  if (!profile.birthDate) {
    return null;
  }

  const dayOfLife = getDayOfLife(profile.birthDate, dateKey);
  const expectation = getNewbornExpectation(dayOfLife);
  if (!expectation) {
    return null;
  }

  const counts = countNewbornDaily(events, dateKey);

  const checks: NewbornMetricCheck[] = [
    { count: counts.wetDiapers, expectedMin: expectation.wetMin, label: 'Wet diapers', status: counts.wetDiapers >= expectation.wetMin ? 'within' : 'below' },
    { count: counts.stoolDiapers, expectedMin: expectation.stoolMin, label: 'Stools', status: counts.stoolDiapers >= expectation.stoolMin ? 'within' : 'below' },
    { count: counts.feeds, expectedMin: expectation.feedMin, label: 'Feeds', status: counts.feeds >= expectation.feedMin ? 'within' : 'below' }
  ];

  return {
    checks,
    dayOfLife,
    expectation,
    onTrack: checks.every((check) => check.status === 'within')
  };
}
