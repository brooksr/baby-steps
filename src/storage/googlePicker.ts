import { getGoogleSheetsAccessToken } from './googleSheetsAuth';
import { GOOGLE_API_KEY, GOOGLE_APP_ID } from './googleSetup';

/**
 * Hands one existing spreadsheet to the app. Under the `drive.file` scope the
 * app can only reach files it created — or a file the user picks in the Google
 * Picker, which grants access to exactly that file. Picking the build's own
 * sheet once is what lets the app share it with the people a family adds,
 * instead of an admin sharing it by hand. `setAppId` is what ties the grant to
 * this app, so the project number is required, not decorative.
 */

const GAPI_SCRIPT = 'https://apis.google.com/js/api.js';

interface PickerDoc {
  id?: string;
}

interface PickerResponse {
  action?: string;
  docs?: PickerDoc[];
}

interface PickerBuilder {
  addView(view: unknown): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
  setAppId(id: string): PickerBuilder;
  setCallback(callback: (response: PickerResponse) => void): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
}

interface PickerNamespace {
  Action: { CANCEL: string; PICKED: string };
  DocsView: new (viewId?: string) => { setFileIds(ids: string): unknown; setMode(mode: string): unknown };
  DocsViewMode: { LIST: string };
  PickerBuilder: new () => PickerBuilder;
  ViewId: { SPREADSHEETS: string };
}

declare global {
  interface Window {
    gapi?: { load(name: string, callback: () => void): void };
  }
}

let pickerReady: Promise<PickerNamespace> | null = null;

function loadPicker(): Promise<PickerNamespace> {
  if (pickerReady) {
    return pickerReady;
  }

  pickerReady = new Promise<PickerNamespace>((resolve, reject) => {
    const ready = () => window.gapi?.load('picker', () => resolve((window as unknown as { google: { picker: PickerNamespace } }).google.picker));

    if (window.gapi) {
      ready();
      return;
    }

    const script = document.createElement('script');
    script.src = GAPI_SCRIPT;
    script.async = true;
    script.onload = ready;
    script.onerror = () => {
      pickerReady = null;
      reject(new Error('Unable to load the Google Picker.'));
    };
    document.head.append(script);
  });

  return pickerReady;
}

/**
 * Opens the Picker on this one spreadsheet. Resolves true once it was picked,
 * false if the picker was closed without picking it.
 */
export async function pickFamilySheet(spreadsheetId: string): Promise<boolean> {
  const [picker, token] = await Promise.all([loadPicker(), getGoogleSheetsAccessToken()]);
  const view = new picker.DocsView(picker.ViewId.SPREADSHEETS);
  view.setFileIds(spreadsheetId);
  view.setMode(picker.DocsViewMode.LIST);

  return new Promise<boolean>((resolve) => {
    new picker.PickerBuilder()
      .addView(view)
      .setAppId(GOOGLE_APP_ID)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setOAuthToken(token)
      .setTitle('Select the family sheet so BabySteps can share it')
      .setCallback((response) => {
        if (response.action === picker.Action.PICKED) {
          // The view is filtered to this one file, so anything picked is it.
          resolve((response.docs ?? []).length > 0);
        } else if (response.action === picker.Action.CANCEL) {
          resolve(false);
        }
      })
      .build()
      .setVisible(true);
  });
}
