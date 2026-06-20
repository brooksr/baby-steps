import type { BabyProfile, CareEvent, CreateCareEventInput, TrackerExport } from '../domain/types';
import { GoogleAuthRequiredError, hasGoogleClientId, requestGoogleSheetsAccessToken } from './googleSheetsAuth';
import { createGoogleSheetsBabyTrackerStore, GOOGLE_SHEET_ID, GOOGLE_SHEET_URL, GoogleSheetsApi } from './googleSheetsStore';
import { createLocalBabyTrackerStore, type BabyTrackerStore, type EventQuery, type ImportOptions, type StoreStatus } from './store';

export function createHybridBabyTrackerStore(): BabyTrackerStore {
  const localStore = createLocalBabyTrackerStore();
  let sheetStore: BabyTrackerStore | null = null;
  let backend: StoreStatus['backend'] = 'local';
  let message = hasGoogleClientId()
    ? 'Connect Google Sheets to read and write the shared tracker.'
    : 'Local fallback is active. Add VITE_GOOGLE_CLIENT_ID to enable browser writes to the shared Google Sheet.';

  function currentStore() {
    return sheetStore ?? localStore;
  }

  function getStatus(): StoreStatus {
    return {
      backend,
      configured: hasGoogleClientId(),
      connected: Boolean(sheetStore),
      message,
      sheetId: GOOGLE_SHEET_ID,
      sheetUrl: GOOGLE_SHEET_URL
    };
  }

  async function connect() {
    const localData = await localStore.exportData();
    const api = new GoogleSheetsApi(() => requestGoogleSheetsAccessToken(true));
    sheetStore = createGoogleSheetsBabyTrackerStore(api);
    const sheetProfile = await sheetStore.initialize();
    if (localData.events.length > 0) {
      await sheetStore.importData(
        {
          ...localData,
          profile: {
            ...sheetProfile,
            birthDate: sheetProfile.birthDate ?? localData.profile.birthDate
          }
        },
        { mode: 'merge' }
      );
    }
    backend = 'google-sheets';
    message =
      localData.events.length > 0
        ? `Writing to the shared Google Sheet. Synced ${localData.events.length} local entries.`
        : 'Writing to the shared Google Sheet.';
  }

  async function trySheet<T>(operation: () => Promise<T>, fallback: () => Promise<T>) {
    if (sheetStore) {
      return operation();
    }

    return fallback();
  }

  return {
    addEvent(input: CreateCareEventInput) {
      return trySheet(() => currentStore().addEvent(input), () => localStore.addEvent(input));
    },
    async clear() {
      await currentStore().clear();
    },
    close() {
      localStore.close();
      sheetStore?.close();
    },
    connect,
    deleteEvent(id: string) {
      return trySheet(() => currentStore().deleteEvent(id), () => localStore.deleteEvent(id));
    },
    exportData() {
      return trySheet(() => currentStore().exportData(), () => localStore.exportData());
    },
    getProfile(): Promise<BabyProfile | undefined> {
      return trySheet(() => currentStore().getProfile(), () => localStore.getProfile());
    },
    getStatus,
    importData(data: TrackerExport, options?: ImportOptions) {
      return trySheet(() => currentStore().importData(data, options), () => localStore.importData(data, options));
    },
    async initialize() {
      try {
        return await currentStore().initialize();
      } catch (error) {
        if (error instanceof GoogleAuthRequiredError) {
          backend = 'local';
          message = 'Local fallback is active until Google Sheets is connected.';
          return localStore.initialize();
        }

        throw error;
      }
    },
    listEvents(query?: EventQuery): Promise<CareEvent[]> {
      return trySheet(() => currentStore().listEvents(query), () => localStore.listEvents(query));
    },
    saveProfile(profile: Partial<BabyProfile>) {
      return trySheet(() => currentStore().saveProfile(profile), () => localStore.saveProfile(profile));
    },
    updateEvent(event: CareEvent) {
      return trySheet(() => currentStore().updateEvent(event), () => localStore.updateEvent(event));
    }
  };
}
