import { getLocalDateKey } from './dates';
import type { CareEvent, IntakeEvent, IntakeKind, OutputEvent, OutputKind } from './types';

/**
 * Inputs and outputs for a tracked parent: what went in, what came back out,
 * and how usable the pair of them will be to an association pass later.
 *
 * Nothing here decides that one caused the other — that is a separate module
 * and a much harder question. What this file is for is making sure the rows
 * being written can answer it at all: a tag rather than a sentence, a severity
 * rather than an adjective, and a plain count of how often an output even has
 * an input logged before it.
 */

/** The order the pickers offer them in — food before drink, the way a day goes. */
export const INTAKE_KINDS: IntakeKind[] = ['food', 'drink'];

/**
 * Ordered by how often they are logged, not alphabetically: pee and poo are the
 * two buttons anyone reaches for, and the symptoms sit at the end.
 */
export const OUTPUT_KINDS: OutputKind[] = ['pee', 'poo', 'fart', 'burp', 'vomit', 'reflux', 'bloating', 'cramp'];

/**
 * The one tag with a dose worth being exact about — 80mg of espresso and a mug
 * of green tea are the same tag and nothing like the same amount.
 */
export const CAFFEINE_TAG = 'caffeine';

/** The only kind with a stool to describe — the others carry severity alone. */
export const STOOL_OUTPUT_KINDS: OutputKind[] = ['poo'];

export function hasStoolDetail(kind: OutputKind) {
  return STOOL_OUTPUT_KINDS.includes(kind);
}

/**
 * How far back an output looks for an input. Gas runs a few hours behind a
 * meal and stool a day or more, so a single window cannot be right for both —
 * this one is deliberately generous, because it only ever answers "was
 * anything logged before this", never "was it the cause".
 */
export const DEFAULT_LINK_WINDOW_HOURS = 24;

const HOUR_MS = 3_600_000;

export function isIntakeKind(value: string | null | undefined): value is IntakeKind {
  return INTAKE_KINDS.includes(value as IntakeKind);
}

export function isOutputKind(value: string | null | undefined): value is OutputKind {
  return OUTPUT_KINDS.includes(value as OutputKind);
}

export function isIntake(event: CareEvent): event is IntakeEvent {
  return event.type === 'intake';
}

export function isOutput(event: CareEvent): event is OutputEvent {
  return event.type === 'output';
}

/**
 * Tags travel through one sheet cell, so they are a comma-separated list of
 * `food-triggers.csv` ids. An id we do not recognise is kept as written —
 * whoever added it meant something by it.
 */
export function parseIntakeTags(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  const seen = new Set<string>();

  for (const part of value.split(',')) {
    const tag = part.trim().toLowerCase();

    if (tag) {
      seen.add(tag);
    }
  }

  return [...seen];
}

export function serializeIntakeTags(tags: string[] | undefined): string {
  return parseIntakeTags((tags ?? []).join(',')).join(',');
}

export interface IntakeOutputSummary {
  intakes: number;
  foods: number;
  drinks: number;
  /** Ounces drunk across the span. Only entries that recorded an amount count. */
  fluidOz: number;
  outputs: number;
  byOutputKind: Record<OutputKind, number>;
  /** Days with at least one entry of either sort. */
  daysLogged: number;
  /**
   * The three numbers a later association pass depends on: an untagged input is
   * a sentence nothing can group, an unrated output has no size to correlate,
   * and an output with nothing logged before it is a row with no left-hand side.
   */
  taggedIntakes: number;
  ratedOutputs: number;
  linkedOutputs: number;
}

function emptyOutputCounts(): Record<OutputKind, number> {
  return OUTPUT_KINDS.reduce(
    (counts, kind) => {
      counts[kind] = 0;
      return counts;
    },
    {} as Record<OutputKind, number>
  );
}

export function createEmptyIntakeOutputSummary(): IntakeOutputSummary {
  return {
    byOutputKind: emptyOutputCounts(),
    daysLogged: 0,
    drinks: 0,
    fluidOz: 0,
    foods: 0,
    intakes: 0,
    linkedOutputs: 0,
    outputs: 0,
    ratedOutputs: 0,
    taggedIntakes: 0
  };
}

export interface IntakeOutputOptions {
  /** How far back an output looks for an input. See `DEFAULT_LINK_WINDOW_HOURS`. */
  linkWindowHours?: number;
}

export function getIntakeOutputSummary(events: CareEvent[], options: IntakeOutputOptions = {}): IntakeOutputSummary {
  const windowMs = (options.linkWindowHours ?? DEFAULT_LINK_WINDOW_HOURS) * HOUR_MS;
  const summary = createEmptyIntakeOutputSummary();
  const intakes = events.filter(isIntake);
  const outputs = events.filter(isOutput);
  const days = new Set<string>();
  // Sorted once so each output can walk back through the inputs before it
  // instead of re-scanning the whole log per row.
  const intakeTimes = intakes.map((event) => new Date(event.startedAt).getTime()).sort((a, b) => a - b);

  for (const event of intakes) {
    summary.intakes += 1;
    days.add(getLocalDateKey(event.startedAt));

    if (event.kind === 'drink') {
      summary.drinks += 1;
      summary.fluidOz += event.amountOz ?? 0;
    } else {
      summary.foods += 1;
    }

    if (parseIntakeTags((event.tags ?? []).join(',')).length > 0) {
      summary.taggedIntakes += 1;
    }
  }

  for (const event of outputs) {
    summary.outputs += 1;
    summary.byOutputKind[event.kind] = (summary.byOutputKind[event.kind] ?? 0) + 1;
    days.add(getLocalDateKey(event.startedAt));

    if (event.severity != null) {
      summary.ratedOutputs += 1;
    }

    const at = new Date(event.startedAt).getTime();

    if (intakeTimes.some((time) => time <= at && at - time <= windowMs)) {
      summary.linkedOutputs += 1;
    }
  }

  summary.daysLogged = days.size;
  summary.fluidOz = Math.round(summary.fluidOz * 10) / 10;

  return summary;
}

export interface TagCount {
  tag: string;
  count: number;
}

/** The food groups logged most often — what an association pass has to work with. */
export function getTopIntakeTags(events: CareEvent[], limit = 6): TagCount[] {
  const counts = new Map<string, number>();

  for (const event of events.filter(isIntake)) {
    for (const tag of parseIntakeTags((event.tags ?? []).join(','))) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ count, tag }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
    .slice(0, limit);
}
