import Dexie, { type Table } from 'dexie';
import { createFamilyProfile, isChild, isParent, sortProfiles, type NewProfileInput } from '../domain/family';
import { createDefaultBabyProfile } from '../domain/dates';
import { migrateStoredEvents, type StoredCareEvent } from '../domain/legacyEvents';
import { type BabyProfile, type CareEvent, type CareEventType, type CreateCareEventInput, type TrackerExport, type TrackerSnapshot } from '../domain/types';

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
   * Removes a child from the switcher. Its entries stay where they are —
   * history is never rewritten, here or anywhere else.
   */
  deleteProfile(id: string): Promise<void>;
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
  /** Profile + events in one read, for cheap background polling. */
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

  constructor(dbName = DEFAULT_DB_NAME) {
    super(dbName);
    this.version(1).stores({
      events: 'id, babyId, type, startedAt, updatedAt, syncState',
      profiles: 'id, dueDate, updatedAt'
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

  /** The child a query is about: the one it named, or the first one. */
  async function resolveProfile(babyId?: string) {
    const profiles = await listProfiles();

    if (profiles.length === 0) {
      return initialize();
    }

    return profiles.find((profile) => profile.id === babyId) ?? profiles[0];
  }

  async function addProfile(input: NewProfileInput) {
    const profile = createFamilyProfile(input, await listProfiles());

    await db.profiles.put(profile);
    return profile;
  }

  /** The child's entries stay in the table — removing it is not a purge. */
  async function deleteProfile(id: string) {
    await db.profiles.delete(id);
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

  async function snapshot(query: EventQuery = {}): Promise<TrackerSnapshot> {
    await initialize();
    const profiles = await listProfiles();
    const profile = profiles.find((person) => person.id === query.babyId) ?? profiles[0];
    const events = await listEvents({ ...query, babyId: profile.id });

    if (!isParent(profile)) {
      return { events, profile, profiles };
    }

    // A parent's report is partly about the babies, so their rows come along.
    const childIds = new Set(profiles.filter(isChild).map((person) => person.id));
    const stored = (await db.events.toArray()) as StoredCareEvent[];
    const childEvents = migrateStoredEvents(stored).filter((event) => childIds.has(event.babyId));

    return { childEvents, events, profile, profiles };
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
      events
    };
  }

  async function importData(data: TrackerExport, options: ImportOptions = {}) {
    assertTrackerExport(data);

    // An export taken before this app tracked siblings carries one profile.
    const incomingProfiles = data.profiles?.length ? data.profiles : [data.profile];

    await db.transaction('rw', db.profiles, db.events, async () => {
      if (options.mode === 'replace') {
        await db.profiles.clear();
        await db.events.clear();
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
    });
  }

  async function clear() {
    await db.transaction('rw', db.profiles, db.events, async () => {
      await db.events.clear();
      await db.profiles.clear();
    });
  }

  return {
    addEvent,
    addProfile,
    assignCaregivers,
    clear,
    close: () => db.close(),
    deleteEvent,
    deleteProfile,
    exportData,
    getProfile,
    importData,
    initialize,
    listEvents,
    listProfiles,
    saveProfile,
    snapshot,
    updateEvent
  };
}

export const trackerStore = createLocalBabyTrackerStore();
