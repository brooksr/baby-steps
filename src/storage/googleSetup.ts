/**
 * Deployment settings that describe the Google project, not the family. All
 * optional: a clone without them simply shows the generic wording.
 *
 * - `VITE_GOOGLE_CLOUD_PROJECT` — the project id, so the admin checklist can
 *   link straight to its Audience page.
 * - `VITE_GOOGLE_OAUTH_PUBLISHED` — `true` once the consent screen is "In
 *   production". Until then only listed test users can sign in at all, and the
 *   checklist says so. Google offers no API to add a test user.
 * - `VITE_GOOGLE_API_KEY` + `VITE_GOOGLE_APP_ID` (the project *number*) — the
 *   Google Picker, which is how the build's own sheet is handed to the app so
 *   it can share it (`googlePicker.ts`).
 */
const env = import.meta.env;

export const GOOGLE_CLOUD_PROJECT = String(env.VITE_GOOGLE_CLOUD_PROJECT ?? '').trim();
export const GOOGLE_OAUTH_PUBLISHED = String(env.VITE_GOOGLE_OAUTH_PUBLISHED ?? '').trim() === 'true';
export const GOOGLE_API_KEY = String(env.VITE_GOOGLE_API_KEY ?? '').trim();
export const GOOGLE_APP_ID = String(env.VITE_GOOGLE_APP_ID ?? '').trim();

/** Where an admin adds a test user — the project's own page when it is known. */
export function getTestUsersUrl(): string {
  return GOOGLE_CLOUD_PROJECT
    ? `https://console.cloud.google.com/auth/audience?project=${encodeURIComponent(GOOGLE_CLOUD_PROJECT)}`
    : 'https://console.cloud.google.com/auth/audience';
}

export function hasPickerConfig(): boolean {
  return Boolean(GOOGLE_API_KEY && GOOGLE_APP_ID);
}
