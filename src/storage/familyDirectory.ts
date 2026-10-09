import { normalizeEmail } from '../domain/family';
import { getGoogleSheetsAccessToken } from './googleSheetsAuth';
import { GOOGLE_SHEET_ID } from './googleSheetsStore';

/**
 * Which family a signed-in account opens. One family is one spreadsheet, and
 * its id is the family id — so two families never share a row, and nobody can
 * read another family's log through the app.
 *
 * - The build's own sheet (`VITE_GOOGLE_SHEET_ID`) is the first family.
 * - A family started in the app is a new spreadsheet in the starter's own
 *   Drive, created under the `drive.file` scope. That scope only reaches files
 *   this app created, which is exactly the list `listOwnFamilySheets` needs.
 * - Someone a family adds is shared on that spreadsheet (`shareFamilySheet`)
 *   and sent an invite link carrying the family id, since `drive.file` cannot
 *   list a file somebody else created.
 *
 * Every candidate is then checked for a profile carrying the signed-in email
 * before anything from it is shown (`domain/access.ts` `isFamilyMember`).
 */

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
/** Marks a spreadsheet as a BabySteps family, so the app can find its own. */
const FAMILY_PROPERTY = { key: 'babysteps', value: 'family' } as const;
/** Device-local: which family each signed-in email last opened. */
const FAMILY_STORAGE_KEY = 'babysteps.family';
/** Device-local: a family id from an invite link, tried first on the next connect. */
const JOIN_STORAGE_KEY = 'babysteps.joinFamily';
/** The invite link's query parameter. */
export const JOIN_PARAM = 'family';

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readFamilyMap(): Record<string, string> {
  try {
    const parsed = JSON.parse(safeStorage()?.getItem(FAMILY_STORAGE_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The family this email last opened on this device. */
export function getStoredFamilyId(email: string | undefined): string | undefined {
  const key = normalizeEmail(email);
  return key ? readFamilyMap()[key] : undefined;
}

export function storeFamilyId(email: string | undefined, familyId: string): void {
  const key = normalizeEmail(email);

  if (!key) {
    return;
  }

  safeStorage()?.setItem(FAMILY_STORAGE_KEY, JSON.stringify({ ...readFamilyMap(), [key]: familyId }));
}

/**
 * Picks a family id up from an invite link (`?family=…`) and takes it out of
 * the address bar, so a reload or a shared screenshot does not carry it on.
 */
export function takeJoinParam(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const url = new URL(window.location.href);
  const familyId = url.searchParams.get(JOIN_PARAM)?.trim();

  if (!familyId) {
    return;
  }

  safeStorage()?.setItem(JOIN_STORAGE_KEY, familyId);
  url.searchParams.delete(JOIN_PARAM);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export function getPendingJoinId(): string | undefined {
  return safeStorage()?.getItem(JOIN_STORAGE_KEY) ?? undefined;
}

export function clearPendingJoin(): void {
  safeStorage()?.removeItem(JOIN_STORAGE_KEY);
}

/** The link that opens BabySteps on this family — what an invite carries. */
export function getInviteLink(familyId: string): string {
  const base = typeof window === 'undefined' ? '' : `${window.location.origin}${import.meta.env.BASE_URL}`;
  return `${base}?${JOIN_PARAM}=${encodeURIComponent(familyId)}`;
}

/** The build's own sheet keeps the original local database; every other family gets its own. */
export function getLocalDbName(familyId: string | undefined): string {
  return !familyId || familyId === GOOGLE_SHEET_ID ? 'babysteps' : `babysteps-${familyId}`;
}

async function googleRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = await getGoogleSheetsAccessToken();
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers }
  });

  if (!response.ok) {
    throw new Error(`Google request failed (${response.status}): ${await response.text()}`);
  }

  return (await response.json()) as T;
}

/** Families this account started in the app — the spreadsheets `drive.file` can see. */
export async function listOwnFamilySheets(): Promise<string[]> {
  const query = `appProperties has { key='${FAMILY_PROPERTY.key}' and value='${FAMILY_PROPERTY.value}' } and mimeType='${SPREADSHEET_MIME}' and trashed=false`;
  const result = await googleRequest<{ files?: Array<{ id?: string }> }>(
    `${DRIVE_FILES_URL}?q=${encodeURIComponent(query)}&fields=files(id)&orderBy=createdTime&pageSize=20`
  );

  return (result.files ?? []).map((file) => file.id).filter((id): id is string => Boolean(id));
}

/**
 * A new, empty family spreadsheet in the signed-in account's Drive, laid out
 * the way the store expects: Events on the first tab (sheet id 0, which row
 * deletes address) and a Profile tab. The store writes the headers and adds the
 * list tabs itself on its first `initialize`.
 */
export async function createFamilySheet(title: string): Promise<string> {
  const file = await googleRequest<{ id: string }>(`${DRIVE_FILES_URL}?fields=id`, {
    body: JSON.stringify({
      appProperties: { [FAMILY_PROPERTY.key]: FAMILY_PROPERTY.value },
      mimeType: SPREADSHEET_MIME,
      name: title
    }),
    method: 'POST'
  });

  await googleRequest(`${SHEETS_URL}/${file.id}:batchUpdate`, {
    body: JSON.stringify({
      requests: [
        { updateSheetProperties: { fields: 'title', properties: { sheetId: 0, title: 'Events' } } },
        { addSheet: { properties: { title: 'Profile' } } }
      ]
    }),
    method: 'POST'
  });

  return file.id;
}

/**
 * Whether the app may share this family's sheet: true for a sheet it created or
 * one handed to it through the Picker. The build's own sheet starts out false
 * until someone does that once. `reason` says why not, for the one place that
 * has to explain it.
 */
export async function getSheetShareAccess(familyId: string): Promise<{ canShare: boolean; reason?: 'not-granted' | 'not-owner' | 'error'; detail?: string }> {
  try {
    const file = await googleRequest<{ capabilities?: { canShare?: boolean } }>(`${DRIVE_FILES_URL}/${familyId}?fields=capabilities(canShare)`);
    // Visible but not shareable: an editor on a sheet whose owner keeps sharing to themselves.
    return file.capabilities?.canShare ? { canShare: true } : { canShare: false, reason: 'not-owner' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // drive.file answers 404 for a file this app has not been given.
    return { canShare: false, detail, reason: /\(404\)/.test(detail) ? 'not-granted' : 'error' };
  }
}

/** How the one-time Picker step went — each outcome has its own explanation in Settings. */
export type ManageSheetResult =
  | { kind: 'not-picked' }
  | { count: number; kind: 'shared' }
  | { detail?: string; kind: 'refused'; reason: 'error' | 'not-granted' | 'not-owner' };

/** What the Picker step came to, in words that say what to do next. */
export function describeManageResult(result: ManageSheetResult): string {
  if (result.kind === 'shared') {
    const { count } = result;
    return `BabySteps can share this sheet now${count > 0 ? ` — shared with ${count} ${count === 1 ? 'person' : 'people'} already added` : ''}.`;
  }

  if (result.kind === 'not-picked') {
    return "Nothing was selected in Google's picker, so the sheet still has to be shared by hand.";
  }

  if (result.reason === 'not-owner') {
    return "BabySteps can see the sheet now, but this Google account isn't allowed to share it. Have the sheet's owner do this step, or let editors share it in the sheet's Share settings.";
  }

  if (result.reason === 'not-granted') {
    return "Google didn't give BabySteps access to the sheet you picked. The Picker's API key has to come from the same Google Cloud project as the sign-in (OAuth) client — check the key's project, then try again.";
  }

  return `Couldn't check the sheet after picking it. ${result.detail ?? ''}`.trim();
}

export async function canShareFamilySheet(familyId: string): Promise<boolean> {
  return (await getSheetShareAccess(familyId)).canShare;
}

export type ShareResult = 'already' | 'manual' | 'shared';

/**
 * Gives someone a family just added edit access to its spreadsheet, with an
 * invite link in Google's email. `manual` means the app could not: the build's
 * own sheet was not created by the app, so `drive.file` cannot share it, and
 * its owner shares it by hand as before.
 */
export async function shareFamilySheet(familyId: string, email: string): Promise<ShareResult> {
  const target = normalizeEmail(email);

  if (!target) {
    return 'manual';
  }

  try {
    const existing = await googleRequest<{ permissions?: Array<{ emailAddress?: string }> }>(
      `${DRIVE_FILES_URL}/${familyId}/permissions?fields=permissions(emailAddress)`
    );

    if ((existing.permissions ?? []).some((permission) => normalizeEmail(permission.emailAddress) === target)) {
      return 'already';
    }

    const message = `You've been added to a family on BabySteps. Open it here: ${getInviteLink(familyId)}`;
    await googleRequest(
      `${DRIVE_FILES_URL}/${familyId}/permissions?sendNotificationEmail=true&emailMessage=${encodeURIComponent(message)}`,
      {
        body: JSON.stringify({ emailAddress: target, role: 'writer', type: 'user' }),
        method: 'POST'
      }
    );

    return 'shared';
  } catch {
    return 'manual';
  }
}
