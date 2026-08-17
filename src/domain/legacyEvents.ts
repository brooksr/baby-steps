import type { CareEvent, CareEventType, FeedEvent } from './types';

/**
 * Nursing (`breastfeed`) and `bottle` were separate event types until they were
 * merged into one `feed` entry. Rows logged before that are still sitting in the
 * shared Google Sheet, in IndexedDB, and in old JSON exports, so every read path
 * funnels through `migrateStoredEvent` instead of rewriting stored history.
 */
type LegacyFeedEvent = Omit<FeedEvent, 'type' | 'method'> & {
  type: 'breastfeed' | 'bottle';
};

/** A record as it may exist in storage: current shape, or a pre-merge feed row. */
export type StoredCareEvent = CareEvent | LegacyFeedEvent;

export type StoredCareEventType = CareEventType | LegacyFeedEvent['type'];

function isLegacyFeedEvent(event: StoredCareEvent): event is LegacyFeedEvent {
  return event.type === 'breastfeed' || event.type === 'bottle';
}

export function migrateStoredEvent(event: StoredCareEvent): CareEvent {
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
