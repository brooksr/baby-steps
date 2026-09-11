// What to expect — the Home card's copy, picked for one profile at one moment.
//
// Two phases share the card. Before the birth it reads the pregnancy by
// gestational week; after it, the day / week / month window the baby is in.
// The copy itself lives in three CSVs under `src/data/reference/` and is read
// through `domain/reference.ts`, so this module only decides *which* rows apply
// and fills the names and pronouns in.
//
// Informational only. Like every reference range in the app it repeats a
// general guideline and points back at the pediatrician — see the Learn page.

import { getLocalDateKey } from './dates';
import { TERM_GESTATION_DAYS, getGestationInfo, type GestationInfo } from './growth/assess';
import {
  getAgeStages,
  getExpectationNotes,
  getFetalWeeks,
  type AgeStage,
  type ExpectationNote,
  type FetalWeek,
  type NoteAudience
} from './reference';
import type { BabyGender, BabyProfile } from './types';

const DAY_MS = 24 * 60 * 60_000;

/**
 * Day-by-day copy is written through age two. Past this the card says so rather
 * than inventing content — `FUTURE_STAGE_OUTLINE` at the bottom of this file is
 * the sketch the next stretch has to be written against.
 */
export const COVERAGE_END_DAYS = 730;

/**
 * The newborn window runs on the calendar, not on corrected time: milk coming
 * in, the cord stump, meconium and regaining birth weight all happen a fixed
 * number of days after the birth however early it was. Skills do not — those
 * follow corrected age — so the stage switches basis at the end of this window.
 */
const NEWBORN_STAGE_DAYS = 28;

/** At most this many personal notes at once, so the card stays a card. */
const MAX_NOTES = 3;

/**
 * Preterm notes are the ones that change what you do today, so they sort above
 * the ones about the baby's sex when both apply and the card only has room for
 * `MAX_NOTES` of them.
 */
const AUDIENCE_ORDER: NoteAudience[] = ['early-preterm', 'late-preterm', 'preterm', 'boy', 'girl'];

const PRONOUNS: Record<BabyGender, { their: string; them: string }> = {
  boy: { their: 'his', them: 'him' },
  girl: { their: 'her', them: 'her' },
  other: { their: 'their', them: 'them' }
};

/**
 * The tokens reference copy may use. `{name}` is deliberately the only subject
 * available: it is singular whatever the pronouns are, so a verb written in the
 * CSV agrees for every profile. A `{they}` token would need "he is" and "they
 * are" to be two different rows, which is a second table nobody wants to keep
 * in step — `whatToExpect.test.ts` fails the build on any token not listed here.
 */
export const COPY_TOKENS = ['name', 'their', 'them'] as const;

/** First name only — the copy is written to address the baby, not the record. */
export function getBabyFirstName(profile: BabyProfile): string {
  return profile.name.trim().split(/\s+/)[0] || 'your baby';
}

export function personalize(text: string, profile: BabyProfile): string {
  const pronouns = PRONOUNS[profile.gender ?? 'other'];
  const values: Record<string, string> = {
    name: getBabyFirstName(profile),
    their: pronouns.their,
    them: pronouns.them
  };

  return text.replace(/\{(\w+)\}/g, (match, token: string) => values[token] ?? match);
}

/**
 * Which age the stage is read at. Inside the newborn window that is the plain
 * chronological age; past it, the corrected age — but never allowed to fall
 * back below where the newborn window left off, so the card can only ever move
 * forwards while a preterm baby's corrected age catches up. For a term birth
 * the two ages are equal and this is just the age.
 */
export function getStageAgeDays(ageDays: number, correctionDays: number): number {
  return Math.max(Math.min(ageDays, NEWBORN_STAGE_DAYS), ageDays - correctionDays);
}

export interface PregnancyOutlook {
  phase: 'pregnancy';
  /** Days to go, negative once the due date has passed. */
  daysUntilDue: number;
  /** Completed days of gestation today. */
  gestationDays: number;
  /** Completed weeks — the row `week` was matched on. */
  gestationWeeks: number;
  week: FetalWeek;
}

export interface ChildOutlook {
  phase: 'child';
  ageDays: number;
  /** Chronological age minus the weeks missed. Negative before the due date. */
  correctedAgeDays: number;
  /** True past `COVERAGE_END_DAYS`, where `stage` is null because nothing is written yet. */
  beyondCoverage: boolean;
  gestation: GestationInfo | null;
  /** 'corrected' only while the correction is actually moving the answer. */
  basis: 'actual' | 'corrected';
  notes: string[];
  stage: AgeStage | null;
  /** The age `stage` was chosen at — see `getStageAgeDays`. */
  stageAgeDays: number;
}

export type Outlook = ChildOutlook | PregnancyOutlook;

/** Every audience this profile is written for today, most specific first. */
export function getNoteAudiences(profile: BabyProfile, gestation: GestationInfo | null): NoteAudience[] {
  const audiences: NoteAudience[] = [];

  if (gestation?.preterm) {
    audiences.push('preterm', gestation.latePreterm ? 'late-preterm' : 'early-preterm');
  }

  if (profile.gender === 'boy' || profile.gender === 'girl') {
    audiences.push(profile.gender);
  }

  return AUDIENCE_ORDER.filter((audience) => audiences.includes(audience));
}

/**
 * Notes match on **chronological** age, not on the corrected age the stage uses:
 * a car seat screen, a cord stump and an RSV season all arrive on the calendar.
 */
function selectNotes(profile: BabyProfile, gestation: GestationInfo | null, ageDays: number): string[] {
  const audiences = getNoteAudiences(profile, gestation);
  const rank = (note: ExpectationNote) => audiences.indexOf(note.audience);

  return getExpectationNotes()
    .filter((note) => rank(note) >= 0 && ageDays >= note.fromDays && ageDays <= note.toDays)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_NOTES)
    .map((note) => personalize(note.note, profile));
}

function findStage(profile: BabyProfile, stageAgeDays: number): AgeStage | null {
  const stage = getAgeStages().find((row) => stageAgeDays >= row.fromDays && stageAgeDays <= row.toDays);
  if (!stage) {
    return null;
  }

  // The card renders what it is handed, so the tokens are filled in here rather
  // than being left for four separate call sites to remember.
  return {
    ...stage,
    development: personalize(stage.development, profile),
    feeding: personalize(stage.feeding, profile),
    headsUp: personalize(stage.headsUp, profile),
    sleep: personalize(stage.sleep, profile),
    summary: personalize(stage.summary, profile)
  };
}

/**
 * The pregnancy week today. Gestation is counted back from the due date, which
 * is by definition 40w0d, so it needs no extra field on the profile. Weeks past
 * the last written row clamp to it — a pregnancy at 42 weeks still has week 41
 * to say — but a due date far enough out to sit before the first row returns
 * null rather than pretending week 4 applies.
 */
function getPregnancyOutlook(profile: BabyProfile, now: Date): PregnancyOutlook | null {
  if (!profile.dueDate) {
    return null;
  }

  const dueAtNoon = new Date(`${getLocalDateKey(profile.dueDate)}T12:00:00`).getTime();
  const daysUntilDue = Math.ceil((dueAtNoon - now.getTime()) / DAY_MS);
  const gestationDays = TERM_GESTATION_DAYS - daysUntilDue;
  const gestationWeeks = Math.floor(gestationDays / 7);
  const weeks = getFetalWeeks();

  if (weeks.length === 0 || gestationWeeks < weeks[0].week) {
    return null;
  }

  const week = weeks.filter((row) => row.week <= gestationWeeks).pop() ?? weeks[weeks.length - 1];

  return { daysUntilDue, gestationDays, gestationWeeks, phase: 'pregnancy', week };
}

function getChildOutlook(profile: BabyProfile, birthDate: string, now: Date): ChildOutlook {
  const birthAtNoon = new Date(`${getLocalDateKey(birthDate)}T12:00:00`).getTime();
  const ageDays = Math.max(0, Math.floor((now.getTime() - birthAtNoon) / DAY_MS));
  const gestation = getGestationInfo(profile);
  const stageAgeDays = getStageAgeDays(ageDays, gestation?.correctionDays ?? 0);

  return {
    ageDays,
    basis: stageAgeDays === ageDays ? 'actual' : 'corrected',
    correctedAgeDays: ageDays - (gestation?.correctionDays ?? 0),
    beyondCoverage: stageAgeDays > COVERAGE_END_DAYS,
    gestation,
    notes: selectNotes(profile, gestation, ageDays),
    phase: 'child',
    stage: findStage(profile, stageAgeDays),
    stageAgeDays
  };
}

/** What to expect for this profile right now, or null when there is nothing to say. */
export function getWhatToExpect(profile: BabyProfile, now: Date = new Date()): Outlook | null {
  return profile.birthDate
    ? getChildOutlook(profile, profile.birthDate, now)
    : getPregnancyOutlook(profile, now);
}

// ---------------------------------------------------------------------------
// Ages two to eighteen — outline only
// ---------------------------------------------------------------------------

export interface FutureStageOutline {
  fromYears: number;
  /** Exclusive, so the bands tile without overlapping. */
  toYears: number;
  label: string;
  /** What rows for this band would have to cover, in the order a card would show them. */
  themes: string[];
}

/**
 * Sketched, not written. The card stops at age two today and says so; these are
 * the bands the next stretch of copy has to fill, and the facets each band needs
 * in place of the infant `feeding` / `sleep` / `development` / `headsUp` set.
 *
 * Deliberately **not rendered anywhere**. The Learn page lists only what ships,
 * and a roadmap on the Home screen would be advertising an unbuilt feature — it
 * is exported so the shape is reviewable and the coverage is testable.
 */
export const FUTURE_STAGE_OUTLINE: FutureStageOutline[] = [
  {
    fromYears: 2,
    label: 'Toddler (2–3)',
    themes: [
      'Language explosion: two- to three-word sentences, then questions',
      'Toilet learning, on the child’s timing rather than a calendar',
      'Tantrums as a communication gap, and what helps',
      'Moving out of the crib; dropping the nap',
      'Well visits at 2, 2.5 and 3 years; first dental visit'
    ],
    toYears: 3
  },
  {
    fromYears: 3,
    label: 'Preschool (3–5)',
    themes: [
      'Play with other children rather than beside them',
      'Self-care: dressing, washing, feeding without help',
      'Pre-literacy — letters, rhyme, holding a pencil',
      'Screen time, sleep needs (10–13 hours) and bedtime drift',
      'Vision and hearing screening; the 4-year immunisations'
    ],
    toYears: 5
  },
  {
    fromYears: 5,
    label: 'Early school (5–7)',
    themes: [
      'Reading takes off; attention stretches',
      'Losing baby teeth and the first orthodontic look',
      'Friendships, fairness and separation at drop-off',
      'Sleep needs (9–12 hours) against a school start time',
      'Annual well visits; sports physicals'
    ],
    toYears: 7
  },
  {
    fromYears: 7,
    label: 'Middle childhood (7–10)',
    themes: [
      'Independence: chores, allowance, walking further alone',
      'Body image and eating patterns as growth steadies',
      'Devices, group chats and a first phone conversation',
      'Organised sport, overuse injuries and rest',
      'Annual well visits; the first talk about puberty ahead of it'
    ],
    toYears: 10
  },
  {
    fromYears: 10,
    label: 'Early adolescence (10–13)',
    themes: [
      'Puberty on a wide and normal timetable',
      'Sleep phase shifts later while school does not',
      'Mood, privacy and how much to ask',
      'Immunisations at 11–12; the annual depression screening',
      'Online life: consent, permanence and who to tell'
    ],
    toYears: 13
  },
  {
    fromYears: 13,
    label: 'Mid adolescence (13–16)',
    themes: [
      'Abstract thinking, risk taking and where limits still belong',
      'Confidentiality with their own doctor',
      'Substances, driving and consent conversations',
      'Identity, relationships and finding their own people',
      'Annual well visits; sports and mental-health screening'
    ],
    toYears: 16
  },
  {
    fromYears: 16,
    label: 'Late adolescence (16–18)',
    themes: [
      'Handing over their own health record and appointments',
      'Work, money and time management',
      'Leaving home, or not, and what support looks like either way',
      'Transition from pediatric to adult care at 18',
      'The last set of childhood immunisations before college'
    ],
    toYears: 18
  }
];
