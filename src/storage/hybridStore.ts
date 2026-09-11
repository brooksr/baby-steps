import type { NewProfileInput } from '../domain/family';
import type { BabyProfile, CareEvent, CreateCareEventInput, ShoppingItem, TaskItem, TrackerExport, TrackerSnapshot } from '../domain/types';
import { getGoogleSheetsAccessToken, GoogleAuthRequiredError, hasGoogleClientId, requestGoogleSheetsAccessToken } from './googleSheetsAuth';
import { createGoogleSheetsBabyTrackerStore, GOOGLE_SHEET_ID, GOOGLE_SHEET_URL, GoogleSheetsApi } from './googleSheetsStore';
import { createLocalBabyTrackerStore, type BabyTrackerStore, type CaregiverAssignment, type EventQuery, type ImportOptions, type ShoppingItemInput, type StoreStatus, type TaskItemInput } from './store';

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

  async function connect(interactive = true) {
    // Gate on a token first: silent for an automatic (boot) reconnect, or
    // interactive when the user explicitly taps connect.
    await requestGoogleSheetsAccessToken(interactive);
    const localData = await localStore.exportData();
    const api = new GoogleSheetsApi(getGoogleSheetsAccessToken);
    // Only promote the sheet store once it has initialized — a half-connected
    // store would swallow reads that should still fall back to local.
    const connecting = createGoogleSheetsBabyTrackerStore(api);
    const sheetProfile = await connecting.initialize();
    sheetStore = connecting;
    const firstChild = {
      ...sheetProfile,
      birthDate: sheetProfile.birthDate ?? localData.profile.birthDate
    };
    // The first child keeps the sheet's row — that is the copy other caregivers
    // have been editing. Siblings added while offline come up alongside it.
    const localSiblings = (localData.profiles ?? [localData.profile]).filter(
      (child) => child.id !== localData.profile.id && child.id !== sheetProfile.id
    );

    if (
      localData.events.length > 0 ||
      localSiblings.length > 0 ||
      Boolean(localData.shopping?.length) ||
      Boolean(localData.tasks?.length)
    ) {
      await sheetStore.importData(
        {
          ...localData,
          profile: firstChild,
          profiles: [firstChild, ...localSiblings]
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
    addProfile(input: NewProfileInput) {
      return trySheet(() => currentStore().addProfile(input), () => localStore.addProfile(input));
    },
    archiveProfile(id: string) {
      return trySheet(() => currentStore().archiveProfile(id), () => localStore.archiveProfile(id));
    },
    assignCaregivers(assignments: CaregiverAssignment[]) {
      return trySheet(() => currentStore().assignCaregivers(assignments), () => localStore.assignCaregivers(assignments));
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
    listProfiles(): Promise<BabyProfile[]> {
      return trySheet(() => currentStore().listProfiles(), () => localStore.listProfiles());
    },
    listShoppingItems(): Promise<ShoppingItem[]> {
      return trySheet(() => currentStore().listShoppingItems(), () => localStore.listShoppingItems());
    },
    listTasks(): Promise<TaskItem[]> {
      return trySheet(() => currentStore().listTasks(), () => localStore.listTasks());
    },
    removeShoppingItem(id: string) {
      return trySheet(() => currentStore().removeShoppingItem(id), () => localStore.removeShoppingItem(id));
    },
    removeTask(id: string) {
      return trySheet(() => currentStore().removeTask(id), () => localStore.removeTask(id));
    },
    restoreProfile(id: string) {
      return trySheet(() => currentStore().restoreProfile(id), () => localStore.restoreProfile(id));
    },
    saveProfile(profile: Partial<BabyProfile>) {
      return trySheet(() => currentStore().saveProfile(profile), () => localStore.saveProfile(profile));
    },
    saveShoppingItem(input: ShoppingItemInput) {
      return trySheet(() => currentStore().saveShoppingItem(input), () => localStore.saveShoppingItem(input));
    },
    saveTask(input: TaskItemInput) {
      return trySheet(() => currentStore().saveTask(input), () => localStore.saveTask(input));
    },
    async snapshot(query?: EventQuery): Promise<TrackerSnapshot> {
      try {
        return await currentStore().snapshot(query);
      } catch (error) {
        if (error instanceof GoogleAuthRequiredError) {
          backend = 'local';
          message = 'Local fallback is active until Google Sheets is connected.';
          return localStore.snapshot(query);
        }

        throw error;
      }
    },
    updateEvent(event: CareEvent) {
      return trySheet(() => currentStore().updateEvent(event), () => localStore.updateEvent(event));
    }
  };
}
