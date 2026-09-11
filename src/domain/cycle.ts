import { getLocalDateKey } from './dates';
import { isChild } from './family';
import type { BabyProfile, CareEvent, MensesEvent, MensesFlow } from './types';

/**
 * A period is logged one day at a time (see `MensesEvent`), so the periods have
 * to be reassembled on read. A gap of up to two days keeps the same period —
 * bleeding pauses, and a day gets missed — while three days apart is a new one.
 */
const SAME_PERIOD_GAP_DAYS = 2;

/**
 * Cycles outside this range are dropped from the averages. A span under 21 days
 * is more likely two periods logged as one start than a real cycle, and one over
 * 60 days is almost always a stretch of not logging — which is ordinary
 * postpartum, and exactly the case where averaging the gap in would poison every
 * prediction after it. Dropped cycles are still listed, and still counted.
 */
const MIN_CYCLE_DAYS = 21;
const MAX_CYCLE_DAYS = 60;

/** How many recent cycles the average is taken over — a year is not the point. */
const RECENT_CYCLES = 6;

/** Below this there is no cycle length to speak of, so nothing is predicted. */
const MIN_CYCLES_TO_PREDICT = 2;

/**
 * The luteal phase — ovulation to the next period — is the stable half of a
 * cycle at around 14 days, whatever the cycle's length. So ovulation is counted
 * *back* from the predicted next period, never forward from the last one.
 */
const LUTEAL_DAYS = 14;

/**
 * Sperm can wait about five days; the egg lasts about one. The window is the
 * union, which is why it opens well before ovulation and closes just after.
 */
const FERTILE_DAYS_BEFORE = 5;
const FERTILE_DAYS_AFTER = 1;

/**
 * The window never closes tighter than a day either side of the average. Cycles
 * that have all run to exactly the same length still do not arrive to the day,
 * and a single-date window would read as a promise the arithmetic cannot keep.
 */
const MIN_WINDOW_PAD_DAYS = 1;

/** Spread of recent cycle lengths that the confidence bands read from. */
const TIGHT_SPREAD_DAYS = 3;
const LOOSE_SPREAD_DAYS = 7;

const DAY_MS = 86_400_000;

export type CyclePhase = 'period' | 'follicular' | 'fertile' | 'ovulation' | 'luteal';
export type PredictionConfidence = 'low' | 'medium' | 'high';

/**
 * Whether there is a cycle to speak of at all.
 *
 * - `pregnant` — a baby is on the way, so periods have stopped.
 * - `postpartum` — a baby has arrived and no period has come back yet.
 * - `cycling` — periods logged since the last birth.
 */
export type CycleStatus = 'cycling' | 'pregnant' | 'postpartum';

/**
 * What the household's babies mean for the cycle. Without it a pregnancy reads
 * as one enormous cycle — the screen that prompted this said "cycle day 291",
 * counting straight through a pregnancy and out the other side.
 */
export interface CycleContext {
  /**
   * The most recent birth. Periods before it belong to a previous chapter: a
   * "cycle" spanning conception to birth is not a cycle, and averaging one in
   * would wreck every figure after it.
   */
  lastBirthKey?: string;
  /** Due date of a baby not yet born — cycles are paused until then. */
  expectingDueKey?: string;
}

/** Reads the babies' profiles for what they imply about the cycle. */
export function getCycleContext(profiles: BabyProfile[]): CycleContext {
  const children = profiles.filter(isChild);
  const births = children.map((child) => child.birthDate).filter((date): date is string => Boolean(date));
  // Expecting means a child on the tracker with no birth logged. An overdue due
  // date still counts — the pregnancy ends when the birth is logged, not when
  // the calendar says it should have.
  const expecting = children
    .filter((child) => !child.birthDate && child.dueDate)
    .map((child) => child.dueDate as string)
    .sort();

  return {
    expectingDueKey: expecting[0] ? getLocalDateKey(expecting[0]) : undefined,
    lastBirthKey: births.length > 0 ? getLocalDateKey(births.map(getLocalDateKey).sort().pop() as string) : undefined
  };
}

export interface PeriodRecord {
  /** Local date key of the first logged bleeding day. */
  startKey: string;
  endKey: string;
  /** Days of bleeding logged, counting the span end to end. */
  days: number;
  flows: MensesFlow[];
  /** Days from this period's start to the next one's — undefined for the current. */
  cycleLengthDays?: number;
  /** Whether that length counted toward the averages (see MIN/MAX_CYCLE_DAYS). */
  cycleCounted: boolean;
}

export interface CycleStats {
  /** Oldest first, so the most recent period is the last entry. */
  periods: PeriodRecord[];
  averageCycleDays: number | null;
  shortestCycleDays: number | null;
  longestCycleDays: number | null;
  /** Longest minus shortest of the counted cycles — how regular this is. */
  spreadDays: number | null;
  averagePeriodDays: number | null;
  /** Cycles that counted toward the average, and how many were dropped. */
  countedCycles: number;
  droppedCycles: number;
}

export interface CyclePrediction {
  nextPeriodKey: string;
  /** The earliest-to-latest range recent cycles actually ran to. */
  windowStartKey: string;
  windowEndKey: string;
  ovulationKey: string;
  fertileStartKey: string;
  fertileEndKey: string;
  confidence: PredictionConfidence;
  /** Plain-language account of what the estimate was built from. */
  basis: string;
}

export interface CycleToday {
  status: CycleStatus;
  /** 1 on the first day of the current period. Null when there is no cycle. */
  dayOfCycle: number | null;
  phase: CyclePhase | null;
  /** Negative once the predicted date has passed, so "3 days late" can be said. */
  daysUntilNextPeriod: number | null;
  prediction: CyclePrediction | null;
  stats: CycleStats;
  /** Days since the last birth, while waiting for the first period back. */
  daysSinceBirth: number | null;
  /** Days until the due date — negative once it has passed. */
  daysUntilDue: number | null;
}

function addDays(dateKey: string, days: number) {
  return getLocalDateKey(new Date(new Date(`${dateKey}T12:00:00`).getTime() + days * DAY_MS));
}

function daysBetween(fromKey: string, toKey: string) {
  return Math.round((new Date(`${toKey}T12:00:00`).getTime() - new Date(`${fromKey}T12:00:00`).getTime()) / DAY_MS);
}

function mean(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** One entry per bleeding day, oldest first, with the day's heaviest flow kept. */
function getBleedingDays(events: CareEvent[]) {
  const byDay = new Map<string, MensesFlow>();
  const rank: Record<MensesFlow, number> = { heavy: 3, light: 1, medium: 2, spotting: 0 };

  for (const event of events) {
    if (event.type !== 'menses') {
      continue;
    }

    const key = getLocalDateKey((event as MensesEvent).startedAt);
    const flow = (event as MensesEvent).flow;
    const existing = byDay.get(key);

    if (!existing || rank[flow] > rank[existing]) {
      byDay.set(key, flow);
    }
  }

  return [...byDay.entries()].sort(([left], [right]) => left.localeCompare(right));
}

/**
 * Bleeding days grouped back into periods, oldest first. `sinceKey` drops the
 * days before it — everything logged before the last birth belongs to a
 * previous chapter and must not run into this one.
 */
export function getPeriods(events: CareEvent[], sinceKey?: string): PeriodRecord[] {
  const days = getBleedingDays(events).filter(([key]) => !sinceKey || key >= sinceKey);
  const periods: PeriodRecord[] = [];

  for (const [key, flow] of days) {
    const current = periods[periods.length - 1];

    if (current && daysBetween(current.endKey, key) <= SAME_PERIOD_GAP_DAYS) {
      current.endKey = key;
      current.days = daysBetween(current.startKey, key) + 1;
      current.flows.push(flow);
      continue;
    }

    periods.push({ cycleCounted: false, days: 1, endKey: key, flows: [flow], startKey: key });
  }

  // A cycle is start-to-start, so every period but the last has one.
  periods.forEach((period, index) => {
    const next = periods[index + 1];

    if (!next) {
      return;
    }

    const length = daysBetween(period.startKey, next.startKey);
    period.cycleLengthDays = length;
    period.cycleCounted = length >= MIN_CYCLE_DAYS && length <= MAX_CYCLE_DAYS;
  });

  return periods;
}

export function getCycleStats(events: CareEvent[], sinceKey?: string): CycleStats {
  const periods = getPeriods(events, sinceKey);
  const lengths = periods.filter((period) => period.cycleCounted).map((period) => period.cycleLengthDays as number);
  const recent = lengths.slice(-RECENT_CYCLES);
  // Only finished periods say how long a period runs; the current one is still
  // going, and counting it would drag the average down every month.
  const finished = periods.slice(0, -1);
  const dropped = periods.filter((period) => period.cycleLengthDays != null && !period.cycleCounted).length;

  return {
    averageCycleDays: recent.length > 0 ? Math.round(mean(recent)) : null,
    averagePeriodDays: finished.length > 0 ? Math.round(mean(finished.map((period) => period.days)) * 10) / 10 : null,
    countedCycles: recent.length,
    droppedCycles: dropped,
    longestCycleDays: recent.length > 0 ? Math.max(...recent) : null,
    periods,
    shortestCycleDays: recent.length > 0 ? Math.min(...recent) : null,
    spreadDays: recent.length > 0 ? Math.max(...recent) - Math.min(...recent) : null
  };
}

function confidenceFromSpread(spread: number, cycles: number): PredictionConfidence {
  if (cycles < 3 || spread > LOOSE_SPREAD_DAYS) {
    return 'low';
  }

  return spread <= TIGHT_SPREAD_DAYS ? 'high' : 'medium';
}

/**
 * The next period, and the fertile window before it. Returns null under
 * `MIN_CYCLES_TO_PREDICT` counted cycles rather than projecting one gap into a
 * calendar — the same line `predictNextDiaper` draws.
 *
 * Informational only. This is an estimate from logged dates, not a contraceptive
 * method and not a fertility test.
 */
export function predictCycle(events: CareEvent[], stats = getCycleStats(events)): CyclePrediction | null {
  const last = stats.periods[stats.periods.length - 1];

  if (!last || stats.averageCycleDays == null || stats.countedCycles < MIN_CYCLES_TO_PREDICT) {
    return null;
  }

  const shortest = stats.shortestCycleDays ?? stats.averageCycleDays;
  const longest = stats.longestCycleDays ?? stats.averageCycleDays;
  const nextPeriodKey = addDays(last.startKey, stats.averageCycleDays);
  const ovulationKey = addDays(nextPeriodKey, -LUTEAL_DAYS);

  return {
    basis: `${stats.countedCycles} cycle${stats.countedCycles === 1 ? '' : 's'}, averaging ${stats.averageCycleDays} days`,
    confidence: confidenceFromSpread(stats.spreadDays ?? 0, stats.countedCycles),
    fertileEndKey: addDays(ovulationKey, FERTILE_DAYS_AFTER),
    fertileStartKey: addDays(ovulationKey, -FERTILE_DAYS_BEFORE),
    nextPeriodKey,
    ovulationKey,
    // Opens at the shortest cycle seen and closes at the longest, never tighter
    // than a day either side of the average.
    windowEndKey: addDays(last.startKey, Math.max(longest, stats.averageCycleDays + MIN_WINDOW_PAD_DAYS)),
    windowStartKey: addDays(last.startKey, Math.min(shortest, stats.averageCycleDays - MIN_WINDOW_PAD_DAYS))
  };
}

/**
 * Where today sits: cycle day, phase, and what is predicted next — or why there
 * is no cycle to report. A pregnancy pauses it; a birth restarts it, and the
 * periods from before that birth are left behind rather than averaged in.
 */
export function getCycleToday(events: CareEvent[], now = new Date(), context: CycleContext = {}): CycleToday | null {
  const todayKey = getLocalDateKey(now);
  const stats = getCycleStats(events, context.lastBirthKey);
  const last = stats.periods[stats.periods.length - 1];

  const base = {
    dayOfCycle: null,
    daysSinceBirth: context.lastBirthKey ? daysBetween(context.lastBirthKey, todayKey) : null,
    daysUntilDue: context.expectingDueKey ? daysBetween(todayKey, context.expectingDueKey) : null,
    daysUntilNextPeriod: null,
    phase: null,
    prediction: null,
    stats
  };

  // A baby on the way comes first: periods have stopped, and whatever was
  // logged before conception is not a cycle in progress.
  if (context.expectingDueKey) {
    return { ...base, status: 'pregnant' as const };
  }

  // Born, and nothing back yet. How long that takes varies enormously, so the
  // app says how long it has been and nothing more.
  if (!last) {
    return context.lastBirthKey ? { ...base, status: 'postpartum' as const } : null;
  }

  const prediction = predictCycle(events, stats);
  const dayOfCycle = daysBetween(last.startKey, todayKey) + 1;
  const bleeding = todayKey >= last.startKey && todayKey <= last.endKey;

  let phase: CyclePhase = 'luteal';

  if (bleeding) {
    phase = 'period';
  } else if (prediction) {
    if (todayKey === prediction.ovulationKey) {
      phase = 'ovulation';
    } else if (todayKey >= prediction.fertileStartKey && todayKey <= prediction.fertileEndKey) {
      phase = 'fertile';
    } else if (todayKey < prediction.fertileStartKey) {
      phase = 'follicular';
    }
  } else {
    phase = 'follicular';
  }

  return {
    ...base,
    dayOfCycle: Math.max(1, dayOfCycle),
    daysUntilNextPeriod: prediction ? daysBetween(todayKey, prediction.nextPeriodKey) : null,
    phase,
    prediction,
    status: 'cycling' as const
  };
}

export const cyclePhaseLabels: Record<CyclePhase, string> = {
  fertile: 'Fertile window',
  follicular: 'Follicular',
  luteal: 'Luteal',
  ovulation: 'Ovulation day',
  period: 'Period'
};

/** How the cycle tile reads when there is no cycle running. */
export function describeCycleStatus(cycle: CycleToday): { detail: string; headline: string } {
  if (cycle.status === 'pregnant') {
    const days = cycle.daysUntilDue;

    return {
      detail: days == null ? 'Cycle paused' : days >= 0 ? `${Math.ceil(days / 7)} weeks to go` : `${Math.abs(days)} days past the due date`,
      headline: 'Expecting'
    };
  }

  if (cycle.status === 'postpartum') {
    const days = cycle.daysSinceBirth ?? 0;

    return {
      detail: days < 14 ? `${days} day${days === 1 ? '' : 's'} since the birth` : `${Math.floor(days / 7)} weeks since the birth`,
      headline: 'No period yet'
    };
  }

  return { detail: cycle.phase ? cyclePhaseLabels[cycle.phase] : '', headline: String(cycle.dayOfCycle ?? '—') };
}
