import { getDeviceTimezone } from './dates';

// Shared BabySteps Google Calendar (group calendar).
export const SHARED_CALENDAR_ID = '4042d3d229580db463fc0c9002e1e22744861e0c90f8c978405210ef1cbeaec3@group.calendar.google.com';

// "Add to your own Google Calendar" subscribe link (the cid deep-link).
export const SHARED_CALENDAR_SUBSCRIBE_URL =
  'https://calendar.google.com/calendar/u/0?cid=NDA0MmQzZDIyOTU4MGRiNDYzZmMwYzkwMDJlMWUyMjc0NDg2MWUwYzkwZjhjOTc4NDA1MjEwZWYxY2JlYWVjM0Bncm91cC5jYWxlbmRhci5nb29nbGUuY29t';

/** Build the iframe embed URL, defaulting to the device timezone. */
export function getCalendarEmbedUrl(timezone = getDeviceTimezone()) {
  const params = new URLSearchParams({ ctz: timezone, src: SHARED_CALENDAR_ID });
  return `https://calendar.google.com/calendar/embed?${params.toString()}`;
}
