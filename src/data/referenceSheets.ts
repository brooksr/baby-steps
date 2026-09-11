// Single source of truth for the reference data BabySteps ships with.
// Each CSV is imported as raw text (bundled at build time, so it works
// offline) and surfaced on the Learn page as a table + download.

import expectationNotes from './reference/what-to-expect-notes.csv?raw';
import fetalDevelopment from './reference/fetal-development-by-week.csv?raw';
import headForAge from './reference/head-circumference-for-age-boys.csv?raw';
import lengthForAge from './reference/length-for-age-boys.csv?raw';
import milestones from './reference/developmental-milestones.csv?raw';
import moodScale from './reference/mood-scale.csv?raw';
import newbornExpectations from './reference/newborn-daily-expectations.csv?raw';
import stoolColors from './reference/stool-colors.csv?raw';
import temperatureRanges from './reference/temperature-ranges.csv?raw';
import tummyTime from './reference/tummy-time-by-age.csv?raw';
import vaccinationSchedule from './reference/vaccination-schedule.csv?raw';
import weightForAge from './reference/weight-for-age-boys.csv?raw';
import whatToExpect from './reference/what-to-expect-by-age.csv?raw';

export type SheetCategory = 'growth' | 'newborn' | 'expect' | 'feature';

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
    category: 'expect',
    description: 'Week-by-week fetal development, weeks 4\u201341 — the Home card before the birth.',
    filename: 'fetal-development-by-week.csv',
    id: 'fetal-development',
    text: fetalDevelopment,
    title: 'Fetal development by week'
  },
  {
    category: 'expect',
    description:
      'Day, week and month expectations from birth to age two. {name}, {their} and {them} are filled in from the profile.',
    filename: 'what-to-expect-by-age.csv',
    id: 'what-to-expect',
    text: whatToExpect,
    title: 'What to expect by age'
  },
  {
    category: 'expect',
    description: 'The extra notes added for a preterm birth or a baby\u2019s recorded sex.',
    filename: 'what-to-expect-notes.csv',
    id: 'what-to-expect-notes',
    text: expectationNotes,
    title: 'What to expect \u2014 personal notes'
  },
  {
    category: 'feature',
    description: 'CDC-style developmental milestones by age — the Care tab checklist.',
    filename: 'developmental-milestones.csv',
    id: 'milestones',
    text: milestones,
    title: 'Developmental milestones'
  },
  {
    category: 'feature',
    description: 'Infant body-temperature bands and guidance — the bands behind the fever flag.',
    filename: 'temperature-ranges.csv',
    id: 'temperature',
    text: temperatureRanges,
    title: 'Temperature ranges'
  },
  {
    category: 'feature',
    description: 'Recommended daily tummy-time minutes by age.',
    filename: 'tummy-time-by-age.csv',
    id: 'tummy-time',
    text: tummyTime,
    title: 'Tummy time by age'
  },
  {
    category: 'feature',
    description: 'CDC-style childhood immunization schedule — the Care tab due/overdue dates.',
    filename: 'vaccination-schedule.csv',
    id: 'vaccinations',
    text: vaccinationSchedule,
    title: 'Vaccination schedule'
  },
  {
    category: 'feature',
    description: 'Simple mood / fussiness scale — the 1\u20135 levels used when logging mood.',
    filename: 'mood-scale.csv',
    id: 'mood',
    text: moodScale,
    title: 'Mood scale'
  },
  {
    category: 'feature',
    description: 'Stool colors offered when logging a diaper, and which ones are worth a call.',
    filename: 'stool-colors.csv',
    id: 'stool-colors',
    text: stoolColors,
    title: 'Stool colors'
  }
];

export function getSheet(id: string): ReferenceSheet | undefined {
  return referenceSheets.find((sheet) => sheet.id === id);
}
