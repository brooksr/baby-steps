import type { BabyProfile, CareEvent } from './types';

/**
 * Key order differs between a locally built event and one parsed back out of
 * the sheet, so serialize deterministically — otherwise two identical reads
 * could fingerprint differently and churn the UI on every poll.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries.map(([key, entry]) => `${key}:${stableStringify(entry)}`).join(',')}}`;
}

/** FNV-1a — short, stable, and fast enough to run on every background poll. */
function hash(input: string) {
  let value = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }

  return (value >>> 0).toString(36);
}

export function eventsSignature(events: CareEvent[]) {
  return `${events.length}-${hash(events.map(stableStringify).join('|'))}`;
}

/**
 * A fingerprint of everything the UI renders. Background polls compare it and
 * only swap state when the shared sheet actually moved, so a quiet sheet costs
 * no re-renders and never interrupts what someone is doing.
 */
export function snapshotSignature(profile: BabyProfile | null | undefined, events: CareEvent[]) {
  return `${profile ? hash(stableStringify(profile)) : 'none'}~${eventsSignature(events)}`;
}
