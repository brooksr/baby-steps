import { inferDiaperDetailsFromNotes, normalizePoopSize, normalizeStoolColor } from './diaperDetails';
import type { CareEvent, CareEventType, DiaperEvent, FeedEvent } from './types';

/**
 * Nursing (`breastfeed`) and `bottle` were separate event types until they were
 * merged into one `feed` entry. Rows logged before that are still sitting in the
 * shared Google Sheet, in IndexedDB, and in old JSON exports, so every read path
 * funnels through `migrateStoredEvent` instead of rewriting stored history.
 */
type LegacyFeedEvent = Omit<FeedEvent, 'type' | 'method'> & {
  type: 'breastfeed' | 'bottle';
};

/**
 * Color was a free-text box and size was not a field at all, so a stored diaper
 * row can carry anything in either — including nothing, with the description
 * sitting in the note instead.
 */
type LooseDiaperEvent = Omit<DiaperEvent, 'poopSize'> & {
  poopSize?: string;
};

/** A record as it may exist in storage: current shape, or a pre-merge feed row. */
export type StoredCareEvent = CareEvent | LegacyFeedEvent | LooseDiaperEvent;

export type StoredCareEventType = CareEventType | LegacyFeedEvent['type'];

function isDiaperEvent(event: StoredCareEvent): event is LooseDiaperEvent {
  return event.type === 'diaper';
}

/**
 * Fill the color and size fields from what the row already says. A wet-only
 * change has no stool to describe, so its note is left alone.
 */
function migrateDiaperEvent(event: LooseDiaperEvent): DiaperEvent {
  const fromNotes = event.kind === 'wet' ? {} : inferDiaperDetailsFromNotes(event.notes);

  return {
    ...event,
    color: normalizeStoolColor(event.color) ?? fromNotes.color,
    poopSize: normalizePoopSize(event.poopSize) ?? fromNotes.poopSize
  };
}

function isLegacyFeedEvent(event: StoredCareEvent): event is LegacyFeedEvent {
  return event.type === 'breastfeed' || event.type === 'bottle';
}

export function migrateStoredEvent(event: StoredCareEvent): CareEvent {
  if (isDiaperEvent(event)) {
    return migrateDiaperEvent(event);
  }

  if (!isLegacyFeedEvent(event)) {
    return event;
  }

  const { type, ...rest } = event;

  return type === 'breastfeed'
    ? { ...rest, method: 'nursing', side: rest.side ?? 'both', type: 'feed' }
    : { ...rest, contents: rest.contents ?? 'breastmilk', method: 'bottle', type: 'feed' };
}

export function migrateStoredEvents(events: StoredCareEvent[]): CareEvent[] {
  return events.map(migrateStoredEvent);
}
