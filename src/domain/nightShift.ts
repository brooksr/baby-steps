import { getLocalDateKey } from './dates';
import type { BabyProfile, CareEvent, CreateCareEventInput } from './types';

/**
 * Who is on duty at what hour. A household that splits the night — one parent
 * takes the small hours, the other takes the early morning — can say so once
 * here rather than picking a name on every entry.
 *
 * Times are `HH:MM` local. A window whose end is at or before its start wraps
 * past midnight, which is what a night shift does.
 */
export interface Shift {
  start: string;
  end: string;
  caregiverId: string;
}

/** 9:30pm–5am and 5am–9am: the split this was built for. */
export const DEFAULT_NIGHT_SHIFT = { end: '05:00', start: '21:30' };
export const DEFAULT_MORNING_SHIFT = { end: '09:00', start: '05:00' };

/**
 * When everyone is in bed. **Both parents sleep the same hours** — the shifts
 * decide who gets up, not who is asleep. Whoever is not on duty sleeps through,
 * which is exactly the difference the rest figures are there to show.
 */
export const DEFAULT_SLEEP_WINDOW = { end: '05:00', start: '21:30' };

/**
 * The morning nap the night-shift parent gets while the other one is on. Keyed
 * to the night before by `getNightKey`, so it adds to that night's rest rather
 * than opening a row of its own — which is how it is actually lived.
 */
export const DEFAULT_NAP_WINDOW = { end: '08:00', start: '06:00' };

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const MINUTES_PER_DAY = 1440;

export function toMinuteOfDay(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

export function formatShiftTime(time: string) {
  const minutes = toMinuteOfDay(time);
  const hour = Math.floor(minutes / 60);
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minutes % 60).padStart(2, '0')} ${suffix}`;
}

/** Whether a local time-of-day falls inside a window, wrapping past midnight. */
export function isWithinShift(minuteOfDay: number, shift: Pick<Shift, 'end' | 'start'>) {
  const start = toMinuteOfDay(shift.start);
  const end = toMinuteOfDay(shift.end);

  return start < end ? minuteOfDay >= start && minuteOfDay < end : minuteOfDay >= start || minuteOfDay < end;
}

function minuteOfDayOf(iso: string) {
  const at = new Date(iso);
  return at.getHours() * 60 + at.getMinutes();
}

/** The first shift covering this instant, or none. */
export function shiftFor(iso: string, shifts: Shift[]): Shift | undefined {
  const minute = minuteOfDayOf(iso);
  return shifts.find((shift) => shift.caregiverId && isWithinShift(minute, shift));
}

export interface AttributionPlan {
  /** Entries the rule would newly attribute, with who to. */
  assignments: Array<{ caregiverId: string; event: CareEvent }>;
  /** Entries in range that already name someone, and are therefore left alone. */
  alreadyAttributed: number;
  /** Entries in range that no shift covers. */
  uncovered: number;
}

/**
 * What applying the shifts to entries already logged would change.
 *
 * **An entry that already names someone is never overwritten** — a caregiver
 * recorded by hand is better evidence than a rule about what time it was, and a
 * bulk pass must not quietly bury it.
 */
export function planAttribution(events: CareEvent[], shifts: Shift[], fromKey: string): AttributionPlan {
  const plan: AttributionPlan = { alreadyAttributed: 0, assignments: [], uncovered: 0 };

  for (const event of events) {
    if (getLocalDateKey(event.startedAt) < fromKey) {
      continue;
    }

    if (event.caregiverId) {
      plan.alreadyAttributed += 1;
      continue;
    }

    const shift = shiftFor(event.startedAt, shifts);

    if (!shift) {
      plan.uncovered += 1;
      continue;
    }

    plan.assignments.push({ caregiverId: shift.caregiverId, event });
  }

  return plan;
}

/**
 * The nights a shift covers, as one sleep entry per night — the span someone
 * went down and got up, not the rest they actually got. What the baby did in
 * between is the report's job (`getRest`), so the stored entry stays a plain
 * record of when they were in bed.
 *
 * Ids are derived from the parent, the night and the window, so running this
 * twice proposes the same entries rather than a second set — and a nap never
 * collides with the night it belongs to.
 */
export function planParentSleeps(
  parent: BabyProfile,
  shift: Pick<Shift, 'end' | 'start'>,
  fromKey: string,
  toKey: string
): CreateCareEventInput[] {
  const slot = shift.start.replace(':', '');
  const start = toMinuteOfDay(shift.start);
  const end = toMinuteOfDay(shift.end);
  // A window that wraps ends on the following day; one that does not ends the
  // same evening.
  const lengthMinutes = start < end ? end - start : MINUTES_PER_DAY - start + end;
  const nights: CreateCareEventInput[] = [];

  for (let day = new Date(`${fromKey}T12:00:00`); getLocalDateKey(day) <= toKey; day = new Date(day.getTime() + DAY_MS)) {
    const dateKey = getLocalDateKey(day);
    const startedAt = new Date(`${dateKey}T00:00:00`);
    startedAt.setMinutes(start);
    const endedAt = new Date(startedAt.getTime() + lengthMinutes * MINUTE_MS);

    // A night still to come is not a night anyone slept.
    if (endedAt.getTime() > Date.now()) {
      break;
    }

    nights.push({
      babyId: parent.id,
      endedAt: endedAt.toISOString(),
      id: `sleep_${parent.id}_${dateKey}_${slot}`,
      startedAt: startedAt.toISOString(),
      type: 'sleep'
    });
  }

  return nights;
}

/** What the Settings tool asks for: who is on each shift, and how far back. */
export interface ShiftPlan {
  from: string;
  /** The hours both parents are in bed. Defaults to `DEFAULT_SLEEP_WINDOW`. */
  sleep?: { start: string; end: string };
  night?: Shift;
  morning?: Shift;
  /** Who gets the morning nap, if anyone, and when. */
  nap?: Shift;
}

export interface ShiftResult {
  sleepsAdded: number;
  attributed: number;
  /** Entries the pass deliberately left alone. */
  skipped: number;
}
