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
