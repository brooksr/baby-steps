import { formatShortDate, getLocalDateKey } from './dates';
import type { CareEvent } from './types';

const DAY_MS = 24 * 60 * 60_000;

/**
 * An inclusive span of local calendar days, held as `YYYY-MM-DD` keys. An empty
 * string leaves that end open, so one shape covers a preset, a half-open span,
 * and no filter at all (`ALL_TIME`) without a separate "enabled" flag.
 */
export interface DateRange {
  from: string;
  to: string;
}

export type DateRangePresetId = '7d' | '30d' | '90d' | 'all';

export const ALL_TIME: DateRange = { from: '', to: '' };

// Labels stay this short so a chip fits on one line at phone width — the
// summary line under the presets spells the chosen span out in full.
export const DATE_RANGE_PRESETS: Array<{ days: number | null; id: DateRangePresetId; label: string }> = [
  { days: 7, id: '7d', label: '7d' },
  { days: 30, id: '30d', label: '30d' },
  { days: 90, id: '90d', label: '90d' },
  // Not bare "All" — the Log already has an All/First year scope control, and
  // two adjacent "All" buttons meaning different things reads as a bug.
  { days: null, id: 'all', label: 'All time' }
];

/** The last `days` calendar days, today included — "7 days" ends today. */
export function getPresetRange(id: DateRangePresetId, now = new Date()): DateRange {
  const preset = DATE_RANGE_PRESETS.find((option) => option.id === id);

  if (!preset?.days) {
    return ALL_TIME;
  }

  return {
    from: getLocalDateKey(new Date(now.getTime() - (preset.days - 1) * DAY_MS)),
    to: getLocalDateKey(now)
  };
}

/** Which preset a range matches, or null when it's a hand-picked span. */
export function matchPreset(range: DateRange, now = new Date()): DateRangePresetId | null {
  const match = DATE_RANGE_PRESETS.find((preset) => {
    const candidate = getPresetRange(preset.id, now);
    return candidate.from === range.from && candidate.to === range.to;
  });

  return match?.id ?? null;
}

/**
 * Picking the end dates out of order is a slip, not a request for nothing —
 * read a reversed pair as the span the person clearly meant.
 */
export function normalizeRange(range: DateRange): DateRange {
  if (range.from && range.to && range.from > range.to) {
    return { from: range.to, to: range.from };
  }

  return range;
}

export function isRangeActive(range: DateRange) {
  return Boolean(range.from || range.to);
}

export function isDateKeyInRange(dateKey: string, range: DateRange) {
  const { from, to } = normalizeRange(range);

  return (!from || dateKey >= from) && (!to || dateKey <= to);
}

/** Ranges are calendar days in the viewer's zone, so compare on the local key. */
export function isInRange(iso: string, range: DateRange) {
  return isDateKeyInRange(getLocalDateKey(iso), range);
}

export function filterEventsByRange<T extends CareEvent>(events: T[], range: DateRange): T[] {
  if (!isRangeActive(range)) {
    return events;
  }

  return events.filter((event) => isInRange(event.startedAt, range));
}

// Anchored at midday so a date key never slips a day when it is parsed.
function formatKey(dateKey: string) {
  return formatShortDate(`${dateKey}T12:00:00`);
}

export function formatRangeLabel(range: DateRange) {
  const { from, to } = normalizeRange(range);

  if (!from && !to) {
    return 'All time';
  }

  if (!from) {
    return `Through ${formatKey(to)}`;
  }

  if (!to) {
    return `${formatKey(from)} onward`;
  }

  return from === to ? formatKey(from) : `${formatKey(from)} – ${formatKey(to)}`;
}

/** Inclusive day count, or null while either end is still open. */
export function getRangeDays(range: DateRange): number | null {
  const { from, to } = normalizeRange(range);

  if (!from || !to) {
    return null;
  }

  const start = new Date(`${from}T12:00:00`).getTime();
  const end = new Date(`${to}T12:00:00`).getTime();

  return Math.round((end - start) / DAY_MS) + 1;
}
