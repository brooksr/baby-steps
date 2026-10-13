import { formatClock, formatDuration } from './dates';
import type { CareEvent, CareEventType } from './types';

/**
 * What the log says around a bout of crying. The nursery phone hears *that* a
 * baby cried, never *why* — its model has one "baby cry" class, and the audio
 * is not kept to ask anything better of later. So this reads the household's own
 * entries instead: how long since the last feed and change against this baby's
 * usual gap, how long since the baby last woke, and any temperature or medicine
 * logged shortly before.
 *
 * These are facts with a nudge, not a cause. Pain, illness, being too hot or
 * too cold, overstimulation or wanting company leave nothing in a care log, and
 * nothing here pretends to read them.
 */

/** Gaps are taken from this many recent intervals; fewer than `MIN_GAPS` and there is no usual. */
const RECENT_GAPS = 10;
const MIN_GAPS = 4;
/** A gap this long is an unlogged stretch, not this baby's rhythm. */
const MAX_GAP_MINUTES = 6 * 60;
/** How far back a temperature or medicine counts as context. */
export const RECENT_CARE_HOURS = 6;
const MINUTE_MS = 60_000;

export interface CryClue {
  /** The last one before the cry. */
  at: string;
  minutesBefore: number;
  /** Median of this baby's recent gaps, when there are enough to call one usual. */
  usualMinutes: number | null;
  /** Past the usual gap — worth checking first. */
  due: boolean;
}

export interface CryContext {
  feed: CryClue | null;
  change: CryClue | null;
  /** Since the last logged sleep ended. Null while one was running, or none was logged that day. */
  awakeMinutes: number | null;
  /** Asleep by the log when the crying was heard. */
  duringSleep: boolean;
  /** Temperatures and medicines in the hours before. */
  recentCare: Array<{ at: string; type: Extract<CareEventType, 'medication' | 'temperature'> }>;
}

const timeOf = (iso: string) => new Date(iso).getTime();

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function getClue(events: CareEvent[], type: CareEventType, at: number): CryClue | null {
  const times = events
    .filter((event) => event.type === type)
    .map((event) => timeOf(event.startedAt))
    .filter((time) => time <= at)
    .sort((left, right) => left - right);

  if (times.length === 0) {
    return null;
  }

  const last = times[times.length - 1];
  const gaps = times
    .slice(1)
    .map((time, index) => (time - times[index]) / MINUTE_MS)
    .filter((gap) => gap > 0 && gap <= MAX_GAP_MINUTES)
    .slice(-RECENT_GAPS);
  const usualMinutes = gaps.length >= MIN_GAPS ? Math.round(median(gaps)) : null;
  const minutesBefore = Math.round((at - last) / MINUTE_MS);

  return { at: new Date(last).toISOString(), due: usualMinutes !== null && minutesBefore >= usualMinutes, minutesBefore, usualMinutes };
}

export function getCryContext(events: CareEvent[], startedAt: string): CryContext {
  const at = timeOf(startedAt);
  const sleeps = events
    .filter((event) => event.type === 'sleep' && timeOf(event.startedAt) <= at)
    .map((event) => ({ end: event.endedAt ? timeOf(event.endedAt) : Number.POSITIVE_INFINITY, start: timeOf(event.startedAt) }));
  const duringSleep = sleeps.some((sleep) => sleep.end > at);
  const lastWoke = sleeps.filter((sleep) => sleep.end <= at).reduce((latest, sleep) => Math.max(latest, sleep.end), Number.NEGATIVE_INFINITY);
  const awakeMinutes = !duringSleep && at - lastWoke <= MAX_GAP_MINUTES * 2 * MINUTE_MS ? Math.round((at - lastWoke) / MINUTE_MS) : null;
  const since = at - RECENT_CARE_HOURS * 60 * MINUTE_MS;

  return {
    awakeMinutes,
    change: getClue(events, 'diaper', at),
    duringSleep,
    feed: getClue(events, 'feed', at),
    recentCare: events
      .filter((event): event is Extract<CareEvent, { type: 'medication' | 'temperature' }> => event.type === 'medication' || event.type === 'temperature')
      .filter((event) => timeOf(event.startedAt) >= since && timeOf(event.startedAt) <= at)
      .map((event) => ({ at: event.startedAt, type: event.type }))
      .sort((left, right) => left.at.localeCompare(right.at))
  };
}

/** The context as short phrases, the due ones first: "fed 3h 10m before (usually 2h 45m)". */
export function describeCryContext(context: CryContext) {
  const clue = (verb: string, item: CryClue | null) =>
    item && {
      due: item.due,
      text: `${verb} ${formatDuration(item.minutesBefore)} before${item.usualMinutes !== null ? ` (usually ${formatDuration(item.usualMinutes)})` : ''}`
    };
  const phrases = [clue('fed', context.feed), clue('changed', context.change)].filter((phrase): phrase is { due: boolean; text: string } => Boolean(phrase));

  if (context.duringSleep) {
    phrases.push({ due: false, text: 'during a logged sleep' });
  } else if (context.awakeMinutes !== null) {
    phrases.push({ due: false, text: `awake ${formatDuration(context.awakeMinutes)}` });
  }

  for (const type of new Set(context.recentCare.map((care) => care.type))) {
    phrases.push({ due: false, text: type === 'temperature' ? `temperature taken in the ${RECENT_CARE_HOURS}h before` : `medicine logged in the ${RECENT_CARE_HOURS}h before` });
  }

  return phrases.sort((left, right) => Number(right.due) - Number(left.due));
}

/** `mood-scale.csv`'s "Crying": actively crying, needs soothing, feeding, or a change. */
export const CRYING_MOOD_LEVEL = 4;
/** A mood entry this close to a bout already records it. */
const MARKED_MATCH_MINUTES = 5;

/** A bout of heard crying as the mood entry it becomes. */
export interface MarkedCry {
  notes: string;
  startedAt: string;
}

/** A crying-or-worse mood entry was logged at the bout — by hand or by marking it. */
export function isCryMarked(cry: { endedAt: string; startedAt: string }, events: CareEvent[]) {
  const margin = MARKED_MATCH_MINUTES * MINUTE_MS;
  return events.some(
    (event) =>
      event.type === 'mood' &&
      event.level >= CRYING_MOOD_LEVEL &&
      timeOf(event.startedAt) >= timeOf(cry.startedAt) - margin &&
      timeOf(event.startedAt) <= timeOf(cry.endedAt) + margin
  );
}

/** The mood entry for a bout, its note carrying where it came from and the log's context at the time. */
export function toCryMood(cry: { endedAt: string; startedAt: string }, events: CareEvent[]): MarkedCry {
  const clues = describeCryContext(getCryContext(events, cry.startedAt)).map((phrase) => phrase.text);
  return {
    notes: `Crying heard by the nursery sensor, ${formatClock(cry.startedAt)}–${formatClock(cry.endedAt)}${clues.length > 0 ? ` · ${clues.join('; ')}` : ''}`,
    startedAt: cry.startedAt
  };
}
