// Typed accessors over the reference CSV sheets. These are the building blocks
// the staged feature work (milestones, temperature, tummy time, vaccines, mood)
// will consume — the data and parsing already work today.

import { parseCsvRecords } from './csv';
import { getSheet } from '../data/referenceSheets';

function records(id: string): Array<Record<string, string>> {
  const sheet = getSheet(id);
  return sheet ? parseCsvRecords(sheet.text) : [];
}

function num(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface Milestone {
  id: string;
  ageMonths: number;
  domain: string;
  milestone: string;
}

export function getMilestones(): Milestone[] {
  return records('milestones').map((row, index) => ({
    ageMonths: Number(row.age_months),
    domain: row.domain,
    id: `m-${index}-${row.age_months}-${slug(row.domain)}`,
    milestone: row.milestone
  }));
}

export function getMilestoneById(id: string): Milestone | undefined {
  return getMilestones().find((milestone) => milestone.id === id);
}

export interface TemperatureBand {
  band: string;
  celsiusMin?: number;
  celsiusMax?: number;
  fahrenheitMin?: number;
  fahrenheitMax?: number;
  guidance: string;
}

export function getTemperatureBands(): TemperatureBand[] {
  return records('temperature').map((row) => ({
    band: row.band,
    celsiusMax: num(row.celsius_max),
    celsiusMin: num(row.celsius_min),
    fahrenheitMax: num(row.fahrenheit_max),
    fahrenheitMin: num(row.fahrenheit_min),
    guidance: row.guidance
  }));
}

/** Classify a temperature (Celsius) into one of the reference bands. */
export function classifyTemperatureC(celsius: number): TemperatureBand | undefined {
  const bands = getTemperatureBands();
  return bands.find((band) => {
    const aboveMin = band.celsiusMin === undefined || celsius >= band.celsiusMin;
    const belowMax = band.celsiusMax === undefined || celsius <= band.celsiusMax;
    return aboveMin && belowMax;
  });
}

export interface TummyTimeGuide {
  ageRange: string;
  dailyMinMinutes: number;
  dailyMaxMinutes: number;
  note: string;
}

export function getTummyTimeGuide(): TummyTimeGuide[] {
  return records('tummy-time').map((row) => ({
    ageRange: row.age_range,
    dailyMaxMinutes: Number(row.daily_max_minutes),
    dailyMinMinutes: Number(row.daily_min_minutes),
    note: row.note
  }));
}

export interface Vaccination {
  id: string;
  age: string;
  /** Age in months from birth (Birth = 0). */
  ageMonths: number;
  vaccines: string;
  note: string;
}

function parseAgeMonths(age: string): number {
  if (/birth/i.test(age)) {
    return 0;
  }
  const match = age.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

export function getVaccinationSchedule(): Vaccination[] {
  return records('vaccinations').map((row) => ({
    age: row.age,
    ageMonths: parseAgeMonths(row.age),
    id: `vax-${slug(row.age)}`,
    note: row.note,
    vaccines: row.vaccines
  }));
}

export function getVaccinationById(id: string): Vaccination | undefined {
  return getVaccinationSchedule().find((vaccination) => vaccination.id === id);
}

export interface MoodLevel {
  level: number;
  label: string;
  description: string;
}

export function getMoodScale(): MoodLevel[] {
  return records('mood').map((row) => ({
    description: row.description,
    label: row.label,
    level: Number(row.level)
  }));
}

export interface StoolColor {
  /**
   * Day of life from which this color is worth a call — 0 flags it at any age,
   * and an empty column (undefined here) never flags. Black is the reason the
   * column is a number rather than a yes/no: meconium is expected in the first
   * week and only means something after it.
   */
  flagFromDay?: number;
  guidance: string;
  id: string;
  label: string;
}

export function getStoolColors(): StoolColor[] {
  return records('stool-colors').map((row) => ({
    flagFromDay: num(row.flag_from_day),
    guidance: row.guidance,
    id: row.id,
    label: row.label
  }));
}

export function getStoolColorById(id: string): StoolColor | undefined {
  return getStoolColors().find((color) => color.id === id);
}

/** Informational only — it repeats the reference row, it does not diagnose. */
export function isStoolColorFlagged(color: StoolColor, ageDays: number): boolean {
  return color.flagFromDay !== undefined && ageDays >= color.flagFromDay;
}

// ---------------------------------------------------------------------------
// What to expect — the Home card's pregnancy and age-stage copy
// ---------------------------------------------------------------------------

export interface FetalWeek {
  /** Completed weeks of gestation this row describes. */
  week: number;
  trimester: string;
  /** Everyday size comparison. Crown-to-rump before week 20, head-to-heel after. */
  size: string;
  development: string;
  headsUp: string;
}

export function getFetalWeeks(): FetalWeek[] {
  return records('fetal-development')
    .map((row) => ({
      development: row.development,
      headsUp: row.heads_up,
      size: row.size,
      trimester: row.trimester,
      week: Number(row.week)
    }))
    .sort((a, b) => a.week - b.week);
}

/**
 * One window of life after birth, from `fromDays` to `toDays` inclusive, both
 * counted from the birth date (day of birth is 0). The copy carries `{name}`,
 * `{their}` and `{them}` tokens — see `domain/whatToExpect.ts`.
 */
export interface AgeStage {
  development: string;
  feeding: string;
  fromDays: number;
  headsUp: string;
  label: string;
  sleep: string;
  summary: string;
  toDays: number;
}

export function getAgeStages(): AgeStage[] {
  return records('what-to-expect')
    .map((row) => ({
      development: row.development,
      feeding: row.feeding,
      fromDays: Number(row.from_days),
      headsUp: row.heads_up,
      label: row.label,
      sleep: row.sleep,
      summary: row.summary,
      toDays: Number(row.to_days)
    }))
    .sort((a, b) => a.fromDays - b.fromDays);
}

/** Who an extra note is written for. A profile can match several at once. */
export type NoteAudience = 'boy' | 'early-preterm' | 'girl' | 'late-preterm' | 'preterm';

export interface ExpectationNote {
  audience: NoteAudience;
  fromDays: number;
  note: string;
  toDays: number;
}

export function getExpectationNotes(): ExpectationNote[] {
  return records('what-to-expect-notes').map((row) => ({
    audience: row.audience as NoteAudience,
    fromDays: Number(row.from_days),
    note: row.note,
    toDays: Number(row.to_days)
  }));
}
