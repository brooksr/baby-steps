import { getLocalDateKey } from './dates';
import { getRangeDays, type DateRange } from './dateRange';
import type { CareEvent } from './types';

/** The measurement a check-up span counts from — a growth or birth row. */
export interface CheckupAnchor {
  dateKey: string;
  headCircumferenceIn?: number;
  lengthIn?: number;
  type: 'birth' | 'growth';
  weightOz?: number;
}

export interface CheckupSpan {
  anchor: CheckupAnchor;
  /** Inclusive days from the anchor day through today. */
  days: number;
  range: DateRange;
}

type MeasuredEvent = Extract<CareEvent, { type: 'birth' | 'growth' }>;

/** A row with no numbers on it says nothing about a visit, so it can't anchor one. */
function hasMeasurement(event: MeasuredEvent) {
  return event.weightOz != null || event.lengthIn != null || event.headCircumferenceIn != null;
}

/**
 * The stretch a pediatrician asks about: everything logged since the baby was
 * last measured, through today. Weights and lengths are taken at the visit, so
 * the last measurement is the last appointment. Birth counts as one, so the
 * first check-up span starts at the hospital rather than at nothing.
 *
 * A measurement dated ahead of today is skipped — an appointment penciled in
 * for next week must not collapse the span to nothing.
 */
export function getCheckupSpan(events: CareEvent[], now = new Date()): CheckupSpan | null {
  const today = getLocalDateKey(now);

  const anchors = events
    .filter((event): event is MeasuredEvent => (event.type === 'birth' || event.type === 'growth') && hasMeasurement(event))
    .map((event): CheckupAnchor => ({
      dateKey: getLocalDateKey(event.startedAt),
      headCircumferenceIn: event.headCircumferenceIn,
      lengthIn: event.lengthIn,
      type: event.type,
      weightOz: event.weightOz
    }))
    .filter((anchor) => anchor.dateKey <= today)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  const anchor = anchors[anchors.length - 1];

  if (!anchor) {
    return null;
  }

  const range: DateRange = { from: anchor.dateKey, to: today };

  return { anchor, days: getRangeDays(range) ?? 1, range };
}
