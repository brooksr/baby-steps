import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LINK_WINDOW_HOURS,
  getIntakeOutputSummary,
  getTopIntakeTags,
  parseIntakeTags,
  serializeIntakeTags
} from './intakeOutput';
import type { CareEvent, IntakeKind, OutputKind } from './types';

function intake(startedAt: string, kind: IntakeKind, tags: string[] = [], extra: Partial<CareEvent> = {}): CareEvent {
  return {
    babyId: 'sara-roche',
    createdAt: startedAt,
    id: `in_${startedAt}`,
    kind,
    startedAt,
    tags,
    type: 'intake',
    updatedAt: startedAt,
    ...extra
  } as CareEvent;
}

function output(startedAt: string, kind: OutputKind, severity?: number): CareEvent {
  return {
    babyId: 'sara-roche',
    createdAt: startedAt,
    id: `out_${startedAt}`,
    kind,
    severity,
    startedAt,
    type: 'output',
    updatedAt: startedAt
  } as CareEvent;
}

describe('intake tags', () => {
  // Tags travel through a single sheet cell, so the split has to survive
  // whatever spacing and casing someone's row happens to carry.
  it('trims, lowercases and de-duplicates a tag cell', () => {
    expect(parseIntakeTags(' Dairy, caffeine ,dairy,, ')).toEqual(['dairy', 'caffeine']);
  });

  it('reads an empty cell as no tags rather than one blank one', () => {
    expect(parseIntakeTags('')).toEqual([]);
    expect(parseIntakeTags(undefined)).toEqual([]);
  });

  it('writes the list back as one cell it can read again', () => {
    expect(serializeIntakeTags(['gluten', 'gluten', 'dairy'])).toBe('gluten,dairy');
    expect(serializeIntakeTags(undefined)).toBe('');
  });

  // An id nothing recognises still means something to whoever wrote it.
  it('keeps a tag the reference sheet does not name', () => {
    expect(parseIntakeTags('kimchi')).toEqual(['kimchi']);
  });
});

describe('getIntakeOutputSummary', () => {
  it('counts each side and the fluid that was measured', () => {
    const summary = getIntakeOutputSummary([
      intake('2026-09-10T08:00:00.000Z', 'drink', ['caffeine'], { amountOz: 12 }),
      intake('2026-09-10T12:30:00.000Z', 'food', ['dairy', 'gluten']),
      // An amount is optional — a glass of water rarely has a measured one.
      intake('2026-09-10T15:00:00.000Z', 'drink'),
      output('2026-09-10T16:00:00.000Z', 'poo', 3),
      output('2026-09-10T17:00:00.000Z', 'fart')
    ]);

    expect(summary.intakes).toBe(3);
    expect(summary.drinks).toBe(2);
    expect(summary.foods).toBe(1);
    expect(summary.fluidOz).toBe(12);
    expect(summary.outputs).toBe(2);
    expect(summary.byOutputKind.poo).toBe(1);
    expect(summary.byOutputKind.fart).toBe(1);
    expect(summary.byOutputKind.pee).toBe(0);
  });

  // The three numbers a later association pass depends on. An untagged input is
  // a sentence nothing can group and an unrated output has no size to compare,
  // so counting them is how anyone knows whether the log could answer at all.
  it('counts how much of the log is usable for a comparison', () => {
    const summary = getIntakeOutputSummary([
      intake('2026-09-10T08:00:00.000Z', 'drink', ['caffeine']),
      intake('2026-09-10T12:00:00.000Z', 'food'),
      output('2026-09-10T14:00:00.000Z', 'poo', 2),
      output('2026-09-10T15:00:00.000Z', 'fart')
    ]);

    expect(summary.taggedIntakes).toBe(1);
    expect(summary.ratedOutputs).toBe(1);
    expect(summary.linkedOutputs).toBe(2);
  });

  // An output with nothing logged before it is a row with no left-hand side —
  // it is not linked, however many inputs came *after* it.
  it('does not link an output to an input that came later', () => {
    const summary = getIntakeOutputSummary([
      output('2026-09-10T08:00:00.000Z', 'poo'),
      intake('2026-09-10T09:00:00.000Z', 'food', ['dairy'])
    ]);

    expect(summary.linkedOutputs).toBe(0);
  });

  it('does not link an output to an input outside the window', () => {
    const summary = getIntakeOutputSummary([
      intake('2026-09-08T08:00:00.000Z', 'food', ['dairy']),
      output('2026-09-10T08:00:00.000Z', 'poo')
    ]);

    expect(summary.linkedOutputs).toBe(0);
    // Widen the window past the gap and the same pair does link.
    expect(getIntakeOutputSummary(
      [intake('2026-09-08T08:00:00.000Z', 'food', ['dairy']), output('2026-09-10T08:00:00.000Z', 'poo')],
      { linkWindowHours: DEFAULT_LINK_WINDOW_HOURS * 3 }
    ).linkedOutputs).toBe(1);
  });

  it('ignores everything that is neither an input nor an output', () => {
    const sleep = { babyId: 'sara-roche', createdAt: '', id: 's1', startedAt: '2026-09-10T22:00:00.000Z', type: 'sleep', updatedAt: '' } as CareEvent;
    const summary = getIntakeOutputSummary([sleep]);

    expect(summary.intakes).toBe(0);
    expect(summary.outputs).toBe(0);
    expect(summary.daysLogged).toBe(0);
  });
});

describe('getTopIntakeTags', () => {
  it('ranks by count, then alphabetically for a tie', () => {
    const tags = getTopIntakeTags([
      intake('2026-09-10T08:00:00.000Z', 'drink', ['caffeine', 'dairy']),
      intake('2026-09-10T12:00:00.000Z', 'food', ['dairy']),
      intake('2026-09-11T08:00:00.000Z', 'food', ['gluten'])
    ]);

    expect(tags).toEqual([
      { count: 2, tag: 'dairy' },
      { count: 1, tag: 'caffeine' },
      { count: 1, tag: 'gluten' }
    ]);
  });

  it('holds to the limit it was given', () => {
    const events = ['dairy', 'gluten', 'caffeine', 'spicy'].map((tag, index) =>
      intake(`2026-09-1${index}T08:00:00.000Z`, 'food', [tag])
    );

    expect(getTopIntakeTags(events, 2)).toHaveLength(2);
  });
});
