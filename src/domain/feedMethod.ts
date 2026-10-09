import type { FeedMethod } from './types';

const FEED_METHOD_KEY = 'babysteps.feedMethod';

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The feed method this device last saved. A phone belongs to one person, and
 * the one who nurses and the one who gives bottles each want the form to open
 * on their own tab. Device-local, like the caregiver choice; nursing until a
 * feed has been saved here.
 */
export function getStoredFeedMethod(): FeedMethod {
  const stored = safeStorage()?.getItem(FEED_METHOD_KEY);
  return stored === 'bottle' ? 'bottle' : 'nursing';
}

export function storeFeedMethod(method: FeedMethod): void {
  safeStorage()?.setItem(FEED_METHOD_KEY, method);
}
