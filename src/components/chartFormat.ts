import { formatShortDate } from '../domain/dates';

export interface ChartPoint {
  label: string;
  value: number;
  /** Optional breakdown of `value`, stacked bottom-up in the bar. */
  parts?: number[];
}

export function formatParts(point: ChartPoint, partLabels: string[] | undefined) {
  if (!point.parts || !partLabels) {
    return '';
  }

  return ` (${point.parts.map((part, index) => `${formatBarValue(part)} ${partLabels[index]}`).join(' · ')})`;
}

/** Above this many bars there is no room for a number over each one. */
export const BAR_LABEL_LIMIT = 7;

export function formatStat(value: number, suffix = '') {
  // One decimal throughout: a second one is false precision on a count of
  // diapers, and it made the same number read two ways across the page.
  const rounded = Number(value.toFixed(1));
  return `${rounded.toLocaleString()}${suffix}`;
}

export function formatBarValue(value: number) {
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}`;
}

// Date keys are local days; anchor at midday so they never slip a day in parsing.
export function formatDayLabel(dateKey: string) {
  return formatShortDate(`${dateKey}T12:00:00`);
}
