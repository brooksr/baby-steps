import Dexie, { type Table } from 'dexie';
import { createFamilyProfile, getActiveProfiles, isArchived, isChild, isParent, sortProfiles, type NewProfileInput } from '../domain/family';
import { createDefaultBabyProfile } from '../domain/dates';
import { migrateStoredEvents, type StoredCareEvent } from '../domain/legacyEvents';
import { DEFAULT_SHOPPING_CATEGORY, findItemByName, getCatalogSeed } from '../domain/shopping';
import { type BabyProfile, type CareEvent, type CareEventType, type CreateCareEventInput, type ShoppingItem, type TaskItem, type TrackerExport, type TrackerSnapshot } from '../domain/types';

const DEFAULT_DB_NAME = 'babysteps-theo';

export interface EventQuery {
  babyId?: string;
  from?: string;
  to?: string;
  type?: CareEventType;
  sort?: 'asc' | 'desc';
}

export interface ImportOptions {
  mode?: 'merge' | 'replace';
}

/**
 * A new or edited list row. `id` names an existing one; without it the store
 * creates one — which is what an add from the type-ahead box is.
 */
export type ShoppingItemInput = Partial<ShoppingItem> & { name?: string };
export type TaskItemInput = Partial<TaskItem> & { title?: string };

export interface CaregiverAssignment {
  id: string;
  caregiverId: string;
}

export interface StoreStatus {
  backend: 'local' | 'google-sheets';
  configured: boolean;
  connected: boolean;
  message: string;
  sheetId?: string;
  sheetUrl?: string;
}

export interface BabyTrackerStore {
  initialize(): Promise<BabyProfile>;
  getProfile(): Promise<BabyProfile | undefined>;
  /** Every child on this tracker, oldest first. */
  listProfiles(): Promise<BabyProfile[]>;
  /** Adds a sibling. Its events are the rows carrying the returned id. */
  addProfile(input: NewProfileInput): Promise<BabyProfile>;
  /**
   * Sets someone aside: they leave the switcher and every entry of theirs stays
   * exactly where it is. Reversible by `restoreProfile`, and it deletes nothing
   * — a family may be archiving a profile for the saddest of reasons.
   */
  archiveProfile(id: string): Promise<void>;
  /** Brings an archived profile back to the switcher. */
  restoreProfile(id: string): Promise<void>;
  /** Patches the child named by `profile.id`, or the first one when unset. */
  saveProfile(profile: Partial<BabyProfile>): Promise<BabyProfile>;
  addEvent(input: CreateCareEventInput): Promise<CareEvent>;
  updateEvent(event: CareEvent): Promise<CareEvent>;
  /**
   * Records who did a batch of entries, in one write. Only the caregiver is
   * touched — a bulk pass over months of history must not rewrite whole rows
   * that someone else may be editing.
   */
  assignCaregivers(assignments: CaregiverAssignment[]): Promise<void>;
  deleteEvent(id: string): Promise<void>;
  listEvents(query?: EventQuery): Promise<CareEvent[]>;
  /** The shopping list, every status. Bought items stay — they are the catalogue. */
  listShoppingItems(): Promise<ShoppingItem[]>;
  /** Adds or patches one item. An add with a name already on file patches that row. */
  saveShoppingItem(input: ShoppingItemInput): Promise<ShoppingItem>;
  removeShoppingItem(id: string): Promise<void>;
  listTasks(): Promise<TaskItem[]>;
  saveTask(input: TaskItemInput): Promise<TaskItem>;
  removeTask(id: string): Promise<void>;
  /** Profile, events and both household lists in one read, for cheap polling. */
  snapshot(query?: EventQuery): Promise<TrackerSnapshot>;
  exportData(): Promise<TrackerExport>;
  importData(data: TrackerExport, options?: ImportOptions): Promise<void>;
  clear(): Promise<void>;
  connect?(interactive?: boolean): Promise<void>;
  getStatus?(): StoreStatus;
  close(): void;
}

export class BabyStepsDatabase extends Dexie {
  profiles!: Table<BabyProfile, string>;
  events!: Table<CareEvent, string>;
  shopping!: Table<ShoppingItem, string>;
  tasks!: Table<TaskItem, string>;

  constructor(dbName = DEFAULT_DB_NAME) {
    super(dbName);
    this.version(1).stores({
      events: 'id, babyId, type, startedAt, updatedAt, syncState',
      profiles: 'id, dueDate, updatedAt'
    });
    // Version 2 adds the household lists. Dexie carries the existing tables
    // forward untouched, so a device that already holds a log keeps every row.
    this.version(2).stores({
      shopping: 'id, name, category, status, updatedAt',
      tasks: 'id, status, dueAt, assigneeId, updatedAt'
    });
  }
}

function createId(prefix: string) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function assertTrackerExport(data: TrackerExport) {
  if (data.version !== 1 || !data.profile || !Array.isArray(data.events)) {
    throw new Error('The selected file is not a BabySteps v1 export.');
  }
}

export function createLocalBabyTrackerStore(dbName = DEFAULT_DB_NAME): BabyTrackerStore {
  const db = new BabyStepsDatabase(dbName);

  async function listProfiles() {
    return sortProfiles(await db.profiles.toArray());
  }

  /** The first child — what every read falls back to when none is named. */
  async function getProfile() {
    return (await listProfiles())[0];
  }

  async function initialize() {
    const existing = await getProfile();

    if (existing) {
      return existing;
    }

    const profile = createDefaultBabyProfile();
    await db.profiles.put(profile);
    return profile;
  }

  /**
   * Who a query is about: the person it named, or the first one still in the
   * switcher. An archived profile is never landed on by default.
   */
  async function resolveProfile(babyId?: string) {
    const profiles = await listProfiles();

    if (profiles.length === 0) {
      return initialize();
    }

    const named = profiles.find((profile) => profile.id === babyId);

    if (named && !isArchived(named)) {
      return named;
    }

    return getActiveProfiles(profiles)[0] ?? named ?? profiles[0];
  }

  async function addProfile(input: NewProfileInput) {
    const profile = createFamilyProfile(input, await listProfiles());

    await db.profiles.put(profile);
    return profile;
  }

  /** Nothing leaves the table: archiving is a flag, and it can be undone. */
  async function setArchived(id: string, archivedAt: string | undefined) {
    const existing = await db.profiles.get(id);

    if (existing) {
      await db.profiles.put({ ...existing, archivedAt, syncState: 'local', updatedAt: new Date().toISOString() });
    }
  }

  async function archiveProfile(id: string) {
    await setArchived(id, new Date().toISOString());
  }

  async function restoreProfile(id: string) {
    await setArchived(id, undefined);
  }

  async function saveProfile(profilePatch: Partial<BabyProfile>) {
    const target = await resolveProfile(profilePatch.id);
    // A patch naming a child this device has never seen starts that child from
    // the defaults, rather than overwriting whoever happens to be first.
    const existing =
      profilePatch.id && target.id !== profilePatch.id ? { ...createDefaultBabyProfile(), id: profilePatch.id } : target;
    const timestamp = new Date().toISOString();
    const profile: BabyProfile = {
      ...existing,
      ...profilePatch,
      id: profilePatch.id ?? existing.id,
      createdAt: profilePatch.createdAt ?? existing.createdAt,
      updatedAt: timestamp,
      syncState: 'local'
    };

    await db.profiles.put(profile);
    return profile;
  }

  async function addEvent(input: CreateCareEventInput) {
    const profile = await resolveProfile(input.babyId);
    const timestamp = new Date().toISOString();
    const event = {
      ...input,
      babyId: input.babyId ?? profile.id,
      createdAt: input.createdAt ?? timestamp,
      id: input.id ?? createId('event'),
      syncState: input.syncState ?? 'local',
      updatedAt: input.updatedAt ?? timestamp
    } as CareEvent;

    await db.events.put(event);
    return event;
  }

  async function updateEvent(event: CareEvent) {
    const updated: CareEvent = {
      ...event,
      syncState: 'local',
      updatedAt: new Date().toISOString()
    };

    await db.events.put(updated);
    return updated;
  }

  async function assignCaregivers(assignments: CaregiverAssignment[]) {
    const timestamp = new Date().toISOString();

    await db.transaction('rw', db.events, async () => {
      for (const { caregiverId, id } of assignments) {
        const existing = await db.events.get(id);

        if (existing) {
          await db.events.put({ ...existing, caregiverId, syncState: 'local', updatedAt: timestamp });
        }
      }
    });
  }

  async function deleteEvent(id: string) {
    await db.events.delete(id);
  }

  async function listEvents(query: EventQuery = {}) {
    const profile = await resolveProfile(query.babyId);
    const babyId = query.babyId ?? profile.id;
    const stored = (await db.events.where('babyId').equals(babyId).toArray()) as StoredCareEvent[];
    const events = migrateStoredEvents(stored);

    return events
      .filter((event) => (query.type ? event.type === query.type : true))
      .filter((event) => (query.from ? event.startedAt >= query.from : true))
      .filter((event) => (query.to ? event.startedAt <= query.to : true))
      .sort((a, b) => {
        const result = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
        return query.sort === 'asc' ? result : -result;
      });
  }

  /**
   * Seeds the shipped catalogue the first time the table is empty, and never
   * again — a household that has cleared its list has cleared it on purpose.
   */
  async function seedShopping() {
    if ((await db.shopping.count()) > 0) {
      return;
    }

    const timestamp = new Date().toISOString();
    await db.shopping.bulkPut(
      getCatalogSeed().map((row) => ({
        ...row,
        createdAt: timestamp,
        id: createId('shop'),
        syncState: 'local' as const,
        updatedAt: timestamp
      }))
    );
  }

  async function listShoppingItems() {
    await seedShopping();
    return db.shopping.toArray();
  }

  async function saveShoppingItem(input: ShoppingItemInput) {
    const timestamp = new Date().toISOString();
    // An add whose name is already on file patches that row rather than making
    // a second one — one item, one row, is what makes the catalogue worth having.
    const existing = input.id
      ? await db.shopping.get(input.id)
      : input.name
        ? findItemByName(await db.shopping.toArray(), input.name)
        : undefined;
    const item: ShoppingItem = {
      category: DEFAULT_SHOPPING_CATEGORY,
      isFood: false,
      name: '',
      status: 'need',
      ...existing,
      ...input,
      createdAt: existing?.createdAt ?? timestamp,
      id: existing?.id ?? createId('shop'),
      syncState: 'local',
      updatedAt: timestamp
    };

    await db.shopping.put(item);
    return item;
  }

  async function removeShoppingItem(id: string) {
    await db.shopping.delete(id);
  }

  async function listTasks() {
    return db.tasks.toArray();
  }

  async function saveTask(input: TaskItemInput) {
    const timestamp = new Date().toISOString();
    const existing = input.id ? await db.tasks.get(input.id) : undefined;
    const task: TaskItem = {
      status: 'open',
      title: '',
      ...existing,
      ...input,
      createdAt: existing?.createdAt ?? timestamp,
      id: existing?.id ?? createId('task'),
      syncState: 'local',
      updatedAt: timestamp
    };

    await db.tasks.put(task);
    return task;
  }

  async function removeTask(id: string) {
    await db.tasks.delete(id);
  }

  async function snapshot(query: EventQuery = {}): Promise<TrackerSnapshot> {
    await initialize();
    const profiles = await listProfiles();
    const profile = await resolveProfile(query.babyId);
    const events = await listEvents({ ...query, babyId: profile.id });
    // The household lists belong to everyone, so they come back whoever is on
    // screen — the Shopping and To-Do tabs are not a child's or a parent's.
    const shopping = await listShoppingItems();
    const tasks = await listTasks();

    if (!isParent(profile)) {
      return { events, profile, profiles, shopping, tasks };
    }

    // A parent's report is partly about the babies, so their rows come along.
    const childIds = new Set(profiles.filter(isChild).map((person) => person.id));
    const stored = (await db.events.toArray()) as StoredCareEvent[];
    const childEvents = migrateStoredEvents(stored).filter((event) => childIds.has(event.babyId));

    return { childEvents, events, profile, profiles, shopping, tasks };
  }

  /** Every child and every child's entries — an export is the whole tracker. */
  async function exportData(): Promise<TrackerExport> {
    await initialize();
    const profiles = await listProfiles();
    const stored = (await db.events.toArray()) as StoredCareEvent[];
    const events = migrateStoredEvents(stored).sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    );

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: profiles[0],
      profiles,
      events,
      shopping: await db.shopping.toArray(),
      tasks: await db.tasks.toArray()
    };
  }

  async function importData(data: TrackerExport, options: ImportOptions = {}) {
    assertTrackerExport(data);

    // An export taken before this app tracked siblings carries one profile.
    const incomingProfiles = data.profiles?.length ? data.profiles : [data.profile];

    await db.transaction('rw', db.profiles, db.events, db.shopping, db.tasks, async () => {
      if (options.mode === 'replace') {
        await db.profiles.clear();
        await db.events.clear();
        await db.shopping.clear();
        await db.tasks.clear();
      }

      const timestamp = new Date().toISOString();
      await db.profiles.bulkPut(
        incomingProfiles.map((profile) => ({
          ...profile,
          syncState: 'local' as const,
          updatedAt: timestamp
        }))
      );

      if (data.events.length > 0) {
        await db.events.bulkPut(
          migrateStoredEvents(data.events).map((event) => ({
            ...event,
            syncState: 'local'
          }))
        );
      }

      // Absent in an export taken before the lists existed, which imports fine.
      if (data.shopping?.length) {
        await db.shopping.bulkPut(data.shopping.map((item) => ({ ...item, syncState: 'local' as const })));
      }

      if (data.tasks?.length) {
        await db.tasks.bulkPut(data.tasks.map((task) => ({ ...task, syncState: 'local' as const })));
      }
    });
  }

  async function clear() {
    await db.transaction('rw', db.profiles, db.events, db.shopping, db.tasks, async () => {
      await db.events.clear();
      await db.profiles.clear();
      await db.shopping.clear();
      await db.tasks.clear();
    });
  }

  return {
    addEvent,
    addProfile,
    archiveProfile,
    assignCaregivers,
    clear,
    close: () => db.close(),
    deleteEvent,
    exportData,
    getProfile,
    importData,
    initialize,
    listEvents,
    listProfiles,
    listShoppingItems,
    listTasks,
    removeShoppingItem,
    removeTask,
    restoreProfile,
    saveProfile,
    saveShoppingItem,
    saveTask,
    snapshot,
    updateEvent
  };
}

export const trackerStore = createLocalBabyTrackerStore();
