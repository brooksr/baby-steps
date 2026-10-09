import { getClaimableParents, isFamilyMember } from '../domain/access';
import { createFamilyProfile, normalizeEmail, type NewProfileInput } from '../domain/family';
import type { BabyProfile, CareEvent, CreateCareEventInput, ParentRole, ShoppingItem, TaskItem, TrackerExport, TrackerSnapshot } from '../domain/types';
import {
  clearPendingJoin,
  createFamilySheet,
  getLocalDbName,
  getPendingJoinId,
  getStoredFamilyId,
  listOwnFamilySheets,
  shareFamilySheet,
  storeFamilyId,
  type ShareResult
} from './familyDirectory';
import { fetchGoogleEmail, getGoogleSheetsAccessToken, getStoredGoogleEmail, GoogleAuthRequiredError, hasGoogleClientId, requestGoogleSheetsAccessToken } from './googleSheetsAuth';
import { createGoogleSheetsBabyTrackerStore, getSheetUrl, GOOGLE_SHEET_ID, GoogleSheetsApi, GoogleSheetsRequestError, readFamilyProfiles } from './googleSheetsStore';
import { createLocalBabyTrackerStore, type BabyTrackerStore, type CaregiverAssignment, type EventQuery, type ImportOptions, type ShoppingItemInput, type StoreStatus, type TaskItemInput } from './store';

/**
 * The signed-in account belongs to no family this device can reach. Nothing is
 * shown from any sheet; the app offers to start a family, or — on a family that
 * has never recorded a parent's email — to say which parent this is.
 */
export class NoFamilyError extends Error {
  constructor(
    readonly email: string | undefined,
    readonly claim?: { familyId: string; parents: BabyProfile[] }
  ) {
    super('This Google account is not part of a family on BabySteps yet.');
    this.name = 'NoFamilyError';
  }
}

export interface NewFamilyInput {
  /** The first child, when there is one yet. */
  childName?: string;
  dueDate?: string;
  parentName: string;
  parentRole: ParentRole;
}

function isUnreachable(error: unknown) {
  // 403: not shared with this account. 404: no such sheet. 400: no Profile tab —
  // a spreadsheet that is not a BabySteps family.
  return error instanceof GoogleSheetsRequestError && [400, 403, 404].includes(error.status);
}

export function createHybridBabyTrackerStore(): BabyTrackerStore & {
  claimFamily(familyId: string, parentId: string): Promise<void>;
  createFamily(input: NewFamilyInput): Promise<void>;
  shareFamily(email: string): Promise<ShareResult>;
} {
  // Each family keeps its own offline copy, so one family's entries can never
  // be merged into another's sheet on the next connect.
  let localDbName = getLocalDbName(getStoredFamilyId(getStoredGoogleEmail()));
  let localStore = createLocalBabyTrackerStore(localDbName);
  let sheetStore: BabyTrackerStore | null = null;
  let familyId: string | undefined;
  let backend: StoreStatus['backend'] = 'local';
  const sheetsConfigured = () => hasGoogleClientId() && Boolean(GOOGLE_SHEET_ID);
  let message = sheetsConfigured()
    ? 'Connect Google Sheets to read and write the shared tracker.'
    : 'Local fallback is active. Add VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_SHEET_ID to enable Google Sheets sync.';

  function currentStore() {
    return sheetStore ?? localStore;
  }

  function switchLocalTo(id: string | undefined) {
    const name = getLocalDbName(id);

    if (name !== localDbName) {
      localStore.close();
      localStore = createLocalBabyTrackerStore(name);
      localDbName = name;
    }
  }

  function getStatus(): StoreStatus {
    const sheetId = familyId ?? GOOGLE_SHEET_ID;

    return {
      backend,
      configured: sheetsConfigured(),
      connected: Boolean(sheetStore),
      familyId,
      message,
      sheetId,
      sheetUrl: sheetId ? getSheetUrl(sheetId) : undefined
    };
  }

  function apiFor(id: string) {
    return new GoogleSheetsApi(getGoogleSheetsAccessToken, id);
  }

  /**
   * The family this account belongs to: the first sheet it can reach that holds
   * a current parent or caregiver with its email. An invite link is tried
   * first, then this device's last family, then the build's own sheet, then the
   * families this account started. A sheet it cannot open is skipped; any other
   * failure (a dropped connection) is thrown, so being offline never reads as
   * "no family".
   */
  async function findFamily(email: string | undefined) {
    const tried = new Set<string>();
    let claim: NoFamilyError['claim'];

    async function check(id: string | undefined) {
      if (!id || tried.has(id)) {
        return false;
      }

      tried.add(id);

      try {
        const profiles = await readFamilyProfiles(apiFor(id));

        if (isFamilyMember(profiles, email)) {
          return true;
        }

        const parents = getClaimableParents(profiles);

        if (!claim && parents.length > 0) {
          claim = { familyId: id, parents };
        }
      } catch (error) {
        if (!isUnreachable(error)) {
          throw error;
        }
      }

      return false;
    }

    for (const id of [getPendingJoinId(), getStoredFamilyId(email), GOOGLE_SHEET_ID]) {
      if (await check(id)) {
        return id as string;
      }
    }

    // A grant from before the Drive scope cannot list; that is "none found".
    const own = await listOwnFamilySheets().catch(() => [] as string[]);

    for (const id of own) {
      if (await check(id)) {
        return id;
      }
    }

    throw new NoFamilyError(email, claim);
  }

  async function connect(interactive = true) {
    if (!GOOGLE_SHEET_ID) {
      throw new Error('Add VITE_GOOGLE_SHEET_ID to connect Google Sheets.');
    }

    // Gate on a token first: silent for an automatic (boot) reconnect, or
    // interactive when the user explicitly taps connect.
    await requestGoogleSheetsAccessToken(interactive);
    const email = await fetchGoogleEmail();
    const found = await findFamily(email);

    familyId = found;
    storeFamilyId(email, found);
    clearPendingJoin();
    switchLocalTo(found);

    const localData = await localStore.exportData();
    // Only promote the sheet store once it has initialized — a half-connected
    // store would swallow reads that should still fall back to local.
    const connecting = createGoogleSheetsBabyTrackerStore(apiFor(found));
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

  /**
   * Starts a family: a new spreadsheet in this account's Drive, holding the
   * signed-in parent (with their email, so they can sign in again) and the
   * first child when one was named. Then connects to it like any other family.
   */
  async function createFamily(input: NewFamilyInput) {
    const email = normalizeEmail(await fetchGoogleEmail());

    if (!email) {
      throw new Error('Could not tell which Google account is signed in. Try signing in again.');
    }

    const id = await createFamilySheet(`BabySteps — ${input.parentName.trim()}'s family`);
    const store = createGoogleSheetsBabyTrackerStore(apiFor(id));
    const people: BabyProfile[] = [];
    const childName = input.childName?.trim();

    if (childName) {
      people.push(createFamilyProfile({ dueDate: input.dueDate || undefined, kind: 'child', name: childName }, people));
    }

    people.push(createFamilyProfile({ email, kind: 'parent', name: input.parentName.trim(), parentRole: input.parentRole }, people));

    for (const person of people) {
      await store.saveProfile(person);
    }

    storeFamilyId(email, id);
    await connect(false);
  }

  /** Records this account's email on a parent of a family that has none yet, then opens it. */
  async function claimFamily(id: string, parentId: string) {
    const email = normalizeEmail(await fetchGoogleEmail());
    const profiles = await readFamilyProfiles(apiFor(id));

    if (!email || !getClaimableParents(profiles).some((parent) => parent.id === parentId)) {
      throw new Error('This family has already set up sign-in. Ask a parent to add you in Settings → Family.');
    }

    await createGoogleSheetsBabyTrackerStore(apiFor(id)).saveProfile({ email, id: parentId });
    storeFamilyId(email, id);
    await connect(false);
  }

  function shareFamily(email: string) {
    return familyId ? shareFamilySheet(familyId, email) : Promise.resolve<ShareResult>('manual');
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
    claimFamily,
    connect,
    createFamily,
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
    shareFamily,
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
