// Single source of truth for the reference data BabySteps ships with.
// Each CSV is imported as raw text (bundled at build time, so it works
// offline) and surfaced on the Learn page as a table + download.

import headForAge from './reference/head-circumference-for-age-boys.csv?raw';
import lengthForAge from './reference/length-for-age-boys.csv?raw';
import milestones from './reference/developmental-milestones.csv?raw';
import moodScale from './reference/mood-scale.csv?raw';
import newbornExpectations from './reference/newborn-daily-expectations.csv?raw';
import temperatureRanges from './reference/temperature-ranges.csv?raw';
import tummyTime from './reference/tummy-time-by-age.csv?raw';
import vaccinationSchedule from './reference/vaccination-schedule.csv?raw';
import weightForAge from './reference/weight-for-age-boys.csv?raw';

export type SheetCategory = 'growth' | 'newborn' | 'feature';

export interface ReferenceSheet {
  id: string;
  title: string;
  description: string;
  category: SheetCategory;
  filename: string;
  text: string;
}

export const referenceSheets: ReferenceSheet[] = [
  {
    category: 'growth',
    description: 'WHO Child Growth Standards (2006), boys — length in cm.',
    filename: 'length-for-age-boys.csv',
    id: 'length-for-age',
    text: lengthForAge,
    title: 'Length-for-age (boys)'
  },
  {
    category: 'growth',
    description: 'WHO Child Growth Standards (2006), boys — weight in kg.',
    filename: 'weight-for-age-boys.csv',
    id: 'weight-for-age',
    text: weightForAge,
    title: 'Weight-for-age (boys)'
  },
  {
    category: 'growth',
    description: 'WHO Child Growth Standards (2006), boys — head circumference in cm.',
    filename: 'head-circumference-for-age-boys.csv',
    id: 'head-for-age',
    text: headForAge,
    title: 'Head circumference-for-age (boys)'
  },
  {
    category: 'newborn',
    description: 'Typical minimum diapers and feeds per day of life in the first weeks.',
    filename: 'newborn-daily-expectations.csv',
    id: 'newborn-expectations',
    text: newbornExpectations,
    title: 'Newborn daily expectations'
  },
  {
    category: 'feature',
    description: 'CDC-style developmental milestones by age (for the milestones feature).',
    filename: 'developmental-milestones.csv',
    id: 'milestones',
    text: milestones,
    title: 'Developmental milestones'
  },
  {
    category: 'feature',
    description: 'Infant body-temperature bands and guidance (for temperature logging).',
    filename: 'temperature-ranges.csv',
    id: 'temperature',
    text: temperatureRanges,
    title: 'Temperature ranges'
  },
  {
    category: 'feature',
    description: 'Recommended daily tummy-time minutes by age (for tummy-time tracking).',
    filename: 'tummy-time-by-age.csv',
    id: 'tummy-time',
    text: tummyTime,
    title: 'Tummy time by age'
  },
  {
    category: 'feature',
    description: 'CDC-style childhood immunization schedule (for the vaccine reminder feature).',
    filename: 'vaccination-schedule.csv',
    id: 'vaccinations',
    text: vaccinationSchedule,
    title: 'Vaccination schedule'
  },
  {
    category: 'feature',
    description: 'Simple mood / fussiness scale (for mood logging).',
    filename: 'mood-scale.csv',
    id: 'mood',
    text: moodScale,
    title: 'Mood scale'
  }
];

export function getSheet(id: string): ReferenceSheet | undefined {
  return referenceSheets.find((sheet) => sheet.id === id);
}
