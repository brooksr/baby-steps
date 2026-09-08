// Diaper color and poop size as *fields*, and how to recover them from rows
// that only ever had free text. The selector and the size buttons are new; the
// log they join is not, so every read path funnels old rows through here
// (`domain/legacyEvents.ts`) rather than rewriting history.

import { getStoolColorById } from './reference';
import type { DiaperPoopSize } from './types';

/** What a new dirty diaper opens on, per the reference sheet's first row. */
export const DEFAULT_STOOL_COLOR = 'normal';

const poopSizes: DiaperPoopSize[] = ['small', 'medium', 'large'];

/**
 * Words caregivers actually type. Colors were free text before the selector
 * existed, and size was never a field at all — both mostly ended up in the
 * note ("big yellow blowout"), which is the only place that history survives.
 */
const colorKeywords: Record<string, string[]> = {
  black: ['black', 'meconium', 'tarry'],
  gray: ['gray', 'grey', 'clay', 'chalky'],
  green: ['green'],
  normal: ['normal', 'yellow', 'mustard', 'seedy', 'brown', 'tan'],
  red: ['red', 'blood', 'bloody'],
  white: ['white']
};

const sizeKeywords: Record<DiaperPoopSize, string[]> = {
  large: ['large', 'big', 'huge', 'massive', 'blowout', 'blow-out'],
  medium: ['medium', 'moderate', 'regular', 'average'],
  small: ['small', 'little', 'tiny', 'smear', 'skid']
};

/**
 * The keyword that appears *first* in the text wins. A note reads left to
 * right, so "small at first, then a big one" is describing a small change and
 * amending it — and picking by position beats ranking the vocabulary.
 */
function matchKeyword<T extends string>(text: string, keywords: Record<T, string[]>): T | undefined {
  let best: { index: number; key: T } | undefined;

  for (const [key, words] of Object.entries(keywords) as Array<[T, string[]]>) {
    for (const word of words) {
      const index = text.search(new RegExp(`\\b${word}\\b`, 'i'));

      if (index >= 0 && (!best || index < best.index)) {
        best = { index, key };
      }
    }
  }

  return best?.key;
}

/**
 * Resolve a stored color to a reference id. An unrecognized value is handed
 * back as written — a caregiver's "olive" is worth showing verbatim, and
 * dropping it would lose the only record of it.
 */
export function normalizeStoolColor(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const id = trimmed.toLowerCase();

  return getStoolColorById(id) ? id : matchKeyword(trimmed, colorKeywords) ?? trimmed;
}

export function normalizePoopSize(value: string | undefined): DiaperPoopSize | undefined {
  const size = value?.trim().toLowerCase() as DiaperPoopSize | undefined;
  return size && poopSizes.includes(size) ? size : undefined;
}

/** Color and size as described in a note, for rows logged before the fields existed. */
export function inferDiaperDetailsFromNotes(notes: string | undefined): { color?: string; poopSize?: DiaperPoopSize } {
  if (!notes?.trim()) {
    return {};
  }

  return {
    color: matchKeyword(notes, colorKeywords),
    poopSize: matchKeyword(notes, sizeKeywords)
  };
}
