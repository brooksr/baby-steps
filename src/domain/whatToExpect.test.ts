import { describe, expect, it } from 'vitest';
import { getAgeStages, getExpectationNotes, getFetalWeeks } from './reference';
import type { BabyGender, BabyProfile } from './types';
import {
  COPY_TOKENS,
  COVERAGE_END_DAYS,
  FUTURE_STAGE_OUTLINE,
  getNoteAudiences,
  getStageAgeDays,
  getWhatToExpect,
  personalize
} from './whatToExpect';
import { getGestationInfo } from './growth/assess';

const DAY_MS = 24 * 60 * 60_000;

function profileOf(overrides: Partial<BabyProfile> = {}): BabyProfile {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    dueDate: '2026-09-01',
    id: 'theo-roche',
    name: 'Theo Roche',
    timezone: 'America/Los_Angeles',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

/** A moment `days` after the given local date, read at midday so DST cannot shift it. */
function daysAfter(dateKey: string, days: number) {
  return new Date(new Date(`${dateKey}T12:00:00`).getTime() + days * DAY_MS);
}

describe('personalize', () => {
  const cases: Array<[BabyGender | undefined, string]> = [
    ['boy', 'Theo holds his head up. Hold him.'],
    ['girl', 'Theo holds her head up. Hold her.'],
    ['other', 'Theo holds their head up. Hold them.'],
    [undefined, 'Theo holds their head up. Hold them.']
  ];

  it.each(cases)('renders %s copy with the matching pronouns', (gender, expected) => {
    const text = '{name} holds {their} head up. Hold {them}.';
    expect(personalize(text, profileOf({ gender }))).toBe(expected);
  });

  it('uses the first name only, and falls back when there is none', () => {
    expect(personalize('{name}', profileOf({ name: 'Theo Roche' }))).toBe('Theo');
    expect(personalize('{name}', profileOf({ name: '  ' }))).toBe('your baby');
  });

  it('leaves an unknown token alone rather than blanking the sentence', () => {
    expect(personalize('{name} at {nowhere}', profileOf())).toBe('Theo at {nowhere}');
  });
});

// The interpolator has no verb table, so a token it cannot fill would ship as
// literal braces on the Home screen. Fail the build instead.
describe('shipped copy', () => {
  const shipped = [
    ...getAgeStages().flatMap((stage) => [stage.summary, stage.development, stage.feeding, stage.sleep, stage.headsUp]),
    ...getExpectationNotes().map((note) => note.note),
    ...getFetalWeeks().flatMap((week) => [week.development, week.headsUp, week.size])
  ];

  it('uses only tokens the interpolator knows', () => {
    const used = new Set(shipped.flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1])));
    expect([...used].sort()).toEqual([...COPY_TOKENS].sort());
  });

  it('never leaves a field empty', () => {
    expect(shipped.filter((text) => !text.trim())).toEqual([]);
  });
});

describe('age stage coverage', () => {
  const stages = getAgeStages();

  it('tiles birth to two years with no gap and no overlap', () => {
    expect(stages[0].fromDays).toBe(0);
    expect(stages[stages.length - 1].toDays).toBe(COVERAGE_END_DAYS);

    for (let i = 1; i < stages.length; i += 1) {
      expect(stages[i].fromDays).toBe(stages[i - 1].toDays + 1);
    }
  });
});

describe('getStageAgeDays', () => {
  // 34w2d: born 40 days early, the profile this card was written for.
  const correction = 40;

  it('is just the age for a term birth', () => {
    expect(getStageAgeDays(0, 0)).toBe(0);
    expect(getStageAgeDays(200, 0)).toBe(200);
  });

  it('keeps the newborn window on the calendar, not on corrected age', () => {
    expect(getStageAgeDays(3, correction)).toBe(3);
    expect(getStageAgeDays(27, correction)).toBe(27);
  });

  // Reading day 29 as corrected would send the card back to day -11, i.e. to
  // "Day 1" — it must hold at the end of the newborn window instead.
  it('holds at the end of the newborn window while corrected age catches up', () => {
    expect(getStageAgeDays(29, correction)).toBe(28);
    expect(getStageAgeDays(60, correction)).toBe(28);
  });

  it('follows corrected age once it passes the newborn window', () => {
    expect(getStageAgeDays(100, correction)).toBe(60);
  });

  it('never moves backwards as the days pass', () => {
    let previous = -1;
    for (let age = 0; age <= 800; age += 1) {
      const stageAge = getStageAgeDays(age, correction);
      expect(stageAge).toBeGreaterThanOrEqual(previous);
      previous = stageAge;
    }
  });
});

describe('getWhatToExpect — pregnancy', () => {
  it('reads the fetal week back from the due date', () => {
    // 28 days to go is 36w0d.
    const outlook = getWhatToExpect(profileOf(), daysAfter('2026-09-01', -28));

    expect(outlook).toMatchObject({
      daysUntilDue: 28,
      gestationDays: 252,
      gestationWeeks: 36,
      phase: 'pregnancy'
    });
    expect(outlook?.phase === 'pregnancy' && outlook.week.week).toBe(36);
  });

  it('clamps past the last written week rather than going quiet at term', () => {
    const outlook = getWhatToExpect(profileOf(), daysAfter('2026-09-01', 21));
    expect(outlook?.phase === 'pregnancy' && outlook.week.week).toBe(41);
  });

  it('says nothing before the first written week', () => {
    expect(getWhatToExpect(profileOf(), daysAfter('2026-09-01', -270))).toBeNull();
  });
});

describe('getWhatToExpect — after birth', () => {
  const term = profileOf({ birthDate: '2026-09-01', dueDate: '2026-09-01', gender: 'boy' });
  // Theo: born 2026-07-23 against a 2026-09-01 due date — 40 days early, 34w2d.
  const preterm = profileOf({ birthDate: '2026-07-23', dueDate: '2026-09-01', gender: 'boy' });

  it('opens on the day of birth', () => {
    const outlook = getWhatToExpect(term, daysAfter('2026-09-01', 0));
    expect(outlook).toMatchObject({ ageDays: 0, basis: 'actual', phase: 'child' });
    expect(outlook?.phase === 'child' && outlook.stage?.label).toBe('Day 1');
  });

  it('personalizes the stage copy it hands back', () => {
    const outlook = getWhatToExpect(term, daysAfter('2026-09-01', 15));
    expect(outlook?.phase === 'child' && outlook.stage?.development).toBe('Theo holds his head up briefly during tummy time.');
  });

  it('reads a preterm newborn on actual age', () => {
    const outlook = getWhatToExpect(preterm, daysAfter('2026-07-23', 4));
    expect(outlook).toMatchObject({ ageDays: 4, basis: 'actual', stageAgeDays: 4 });
    expect(outlook?.phase === 'child' && outlook.stage?.label).toBe('Day 5');
  });

  it('switches to corrected age past the newborn window', () => {
    const outlook = getWhatToExpect(preterm, daysAfter('2026-07-23', 120));
    expect(outlook).toMatchObject({ basis: 'corrected', stageAgeDays: 80 });
    expect(outlook?.phase === 'child' && outlook.stage?.label).toBe('Weeks 11–13');
  });

  it('stops rather than inventing copy past two years', () => {
    const outlook = getWhatToExpect(term, daysAfter('2026-09-01', COVERAGE_END_DAYS + 1));
    expect(outlook).toMatchObject({ beyondCoverage: true, stage: null });
  });

  // Corrected age is why a preterm two-year-old is still inside the copy: at
  // 730 chronological days Theo is only 690 corrected days old.
  it('is still covered at two years chronological when the birth was preterm', () => {
    const outlook = getWhatToExpect(preterm, daysAfter('2026-07-23', COVERAGE_END_DAYS + 1));
    expect(outlook).toMatchObject({ beyondCoverage: false });
  });
});

describe('personal notes', () => {
  const pretermBoy = profileOf({ birthDate: '2026-07-23', dueDate: '2026-09-01', gender: 'boy' });
  const termGirl = profileOf({ birthDate: '2026-09-01', dueDate: '2026-09-01', gender: 'girl' });

  it('matches a late preterm birth on both preterm audiences', () => {
    expect(getNoteAudiences(pretermBoy, getGestationInfo(pretermBoy))).toEqual(['late-preterm', 'preterm', 'boy']);
  });

  it('separates an early preterm birth from a late one', () => {
    const early = profileOf({ birthDate: '2026-06-01', dueDate: '2026-09-01' });
    expect(getNoteAudiences(early, getGestationInfo(early))).toEqual(['early-preterm', 'preterm']);
  });

  it('adds nothing for a term baby with no recorded sex', () => {
    const plain = profileOf({ birthDate: '2026-09-01' });
    expect(getNoteAudiences(plain, getGestationInfo(plain))).toEqual([]);
    const outlook = getWhatToExpect(plain, daysAfter('2026-09-01', 3));
    expect(outlook?.phase === 'child' && outlook.notes).toEqual([]);
  });

  it('ranks preterm notes above sex-specific ones and caps the card at three', () => {
    const outlook = getWhatToExpect(pretermBoy, daysAfter('2026-07-23', 3));
    const notes = outlook?.phase === 'child' ? outlook.notes : [];

    expect(notes).toHaveLength(3);
    expect(notes[0]).toContain('Late preterm babies');
    expect(notes.some((note) => note.includes('spray risk'))).toBe(false);
  });

  it('fills pronouns and the name into a note', () => {
    const outlook = getWhatToExpect(termGirl, daysAfter('2026-09-01', 3));
    const notes = outlook?.phase === 'child' ? outlook.notes : [];
    expect(notes).toContain('Wipe front to back at every change.');
    expect(notes.join(' ')).toContain('Theo');
  });

  // Notes are about the calendar — a cord stump and a car seat screen do not
  // wait for corrected age the way a first smile does.
  it('matches on chronological age, not the corrected age the stage uses', () => {
    const outlook = getWhatToExpect(pretermBoy, daysAfter('2026-07-23', 200));
    const notes = outlook?.phase === 'child' ? outlook.notes : [];
    expect(notes.some((note) => note.includes('whooping cough'))).toBe(true);
  });
});

describe('FUTURE_STAGE_OUTLINE', () => {
  it('sketches two to eighteen with no gaps', () => {
    expect(FUTURE_STAGE_OUTLINE[0].fromYears).toBe(2);
    expect(FUTURE_STAGE_OUTLINE[FUTURE_STAGE_OUTLINE.length - 1].toYears).toBe(18);

    for (let i = 1; i < FUTURE_STAGE_OUTLINE.length; i += 1) {
      expect(FUTURE_STAGE_OUTLINE[i].fromYears).toBe(FUTURE_STAGE_OUTLINE[i - 1].toYears);
    }
  });

  it('gives every band something to write', () => {
    for (const band of FUTURE_STAGE_OUTLINE) {
      expect(band.themes.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the researched facts on every stage', () => {
  // A row added without facts would render an empty card section, so coverage
  // is asserted rather than left to whoever edits the sheet next.
  it('gives every week of pregnancy at least two actionable bullets', () => {
    for (const week of getFetalWeeks()) {
      expect(week.facts.length, `week ${week.week}`).toBeGreaterThanOrEqual(2);
      expect(week.facts.every((fact) => fact.trim().length > 0)).toBe(true);
    }
  });

  it('gives every stage of the first two years at least two', () => {
    for (const stage of getAgeStages()) {
      expect(stage.facts.length, stage.label).toBeGreaterThanOrEqual(2);
      expect(stage.facts.every((fact) => fact.trim().length > 0)).toBe(true);
    }
  });

  // The safety point stands; the framing does not need to name the worst thing
  // a frightened parent could do at 3am.
  it('asks a parent to put the baby down without naming shaking', () => {
    const copy = getAgeStages()
      .flatMap((stage) => [stage.headsUp, stage.summary, ...stage.facts])
      .join(' ');

    expect(copy).not.toMatch(/shak/i);
    expect(copy).toMatch(/put \{them\} down somewhere safe/);
  });
});
