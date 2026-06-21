// Typical newborn output/intake expectations for the first weeks of life.
//
// These are general lactation/newborn-care guidelines (AAP / breastfeeding
// medicine), used here to flag when a day's logged diapers or feeds fall short
// of what is usually expected for a baby of that age. They are NOT a medical
// assessment — see the Learn page. The matching spreadsheet lives at
// src/data/reference/newborn-daily-expectations.csv.

export interface NewbornDayExpectation {
  /** Day of life (day 1 = the calendar day of birth). */
  dayOfLife: number;
  /** Minimum wet diapers typically expected by this day. */
  wetMin: number;
  /** Minimum stool (dirty) diapers typically expected by this day. */
  stoolMin: number;
  /** Typical lower bound of feeds per 24h. */
  feedMin: number;
  /** Typical upper bound of feeds per 24h (more is usually fine). */
  feedMax: number;
  /** Short note about what is normal for this day. */
  note: string;
}

// Days 1–6 ramp up; day 6 values hold for the remainder of the early window.
const EXPECTATIONS: NewbornDayExpectation[] = [
  { dayOfLife: 1, wetMin: 1, stoolMin: 1, feedMin: 3, feedMax: 12, note: 'First day: ≥1 wet, ≥1 meconium (black, tarry) stool. Feeds may be sleepy.' },
  { dayOfLife: 2, wetMin: 2, stoolMin: 1, feedMin: 8, feedMax: 12, note: 'Aim for 8–12 feeds/24h; still passing meconium.' },
  { dayOfLife: 3, wetMin: 3, stoolMin: 2, feedMin: 8, feedMax: 12, note: 'Milk coming in; stools turning green/brown (transitional).' },
  { dayOfLife: 4, wetMin: 4, stoolMin: 3, feedMin: 8, feedMax: 12, note: 'Stools becoming yellow; output increasing.' },
  { dayOfLife: 5, wetMin: 5, stoolMin: 3, feedMin: 8, feedMax: 12, note: 'Expect yellow, seedy stools and heavier wet diapers.' },
  { dayOfLife: 6, wetMin: 6, stoolMin: 3, feedMin: 8, feedMax: 12, note: '6+ wet and 3+ yellow stools per day is reassuring.' }
];

/** Last day (inclusive) we apply the newborn early-window checks. */
export const NEWBORN_WINDOW_DAYS = 28;

export function getNewbornExpectation(dayOfLife: number): NewbornDayExpectation | null {
  if (dayOfLife < 1 || dayOfLife > NEWBORN_WINDOW_DAYS) {
    return null;
  }

  const index = Math.min(dayOfLife, EXPECTATIONS.length) - 1;
  const base = EXPECTATIONS[index];

  if (dayOfLife > EXPECTATIONS.length) {
    return { ...base, dayOfLife, note: 'Steady state: expect 6+ wet and 3+ stools per day, 8–12 feeds.' };
  }

  return { ...base, dayOfLife };
}

export const newbornExpectations = EXPECTATIONS;
