/**
 * Deployment settings that describe the Google project, not the family. All
 * optional: a clone without them simply shows the generic wording.
 *
 * - `VITE_GOOGLE_CLOUD_PROJECT` — the project id, so the admin checklist can
 *   link straight to its Audience page.
 * - `VITE_GOOGLE_OAUTH_PUBLISHED` — `true` once the consent screen is "In
 *   production". Until then only listed test users can sign in at all, and the
 *   checklist says so. Google offers no API to add a test user.
 * - `VITE_GOOGLE_API_KEY` — the Google Picker, which is how the build's own
 *   sheet is handed to the app so it can share it (`googlePicker.ts`). Its app
 *   id comes from the OAuth client id; `VITE_GOOGLE_APP_ID` is a fallback only.
 */
const env = import.meta.env;

export const GOOGLE_CLOUD_PROJECT = String(env.VITE_GOOGLE_CLOUD_PROJECT ?? '').trim();
export const GOOGLE_OAUTH_PUBLISHED = String(env.VITE_GOOGLE_OAUTH_PUBLISHED ?? '').trim() === 'true';
export const GOOGLE_API_KEY = String(env.VITE_GOOGLE_API_KEY ?? '').trim();
/**
 * The Picker's app id is the Cloud project *number* — which is also the numeric
 * prefix of the OAuth client id, so it is read from there. A mismatched id is
 * silent: the Picker still lets you pick, but grants this app nothing. An
 * explicit setting is only honoured if it is a number at all.
 */
function getAppId() {
  const configured = String(env.VITE_GOOGLE_APP_ID ?? '').trim();
  const fromClient = /^(\d+)-/.exec(String(env.VITE_GOOGLE_CLIENT_ID ?? '').trim())?.[1] ?? '';
  return fromClient || (/^\d+$/.test(configured) ? configured : '');
}

export const GOOGLE_APP_ID = getAppId();

/** Where an admin adds a test user — the project's own page when it is known. */
export function getTestUsersUrl(): string {
  return GOOGLE_CLOUD_PROJECT
    ? `https://console.cloud.google.com/auth/audience?project=${encodeURIComponent(GOOGLE_CLOUD_PROJECT)}`
    : 'https://console.cloud.google.com/auth/audience';
}

export function hasPickerConfig(): boolean {
  return Boolean(GOOGLE_API_KEY && GOOGLE_APP_ID);
}
