import Dexie, { type Table } from 'dexie';
import { createDefaultBabyProfile } from '../domain/dates';
import { DEFAULT_PROFILE_ID, type BabyProfile, type CareEvent, type CareEventType, type CreateCareEventInput, type TrackerExport } from '../domain/types';

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
  saveProfile(profile: Partial<BabyProfile>): Promise<BabyProfile>;
  addEvent(input: CreateCareEventInput): Promise<CareEvent>;
  updateEvent(event: CareEvent): Promise<CareEvent>;
  deleteEvent(id: string): Promise<void>;
  listEvents(query?: EventQuery): Promise<CareEvent[]>;
  exportData(): Promise<TrackerExport>;
  importData(data: TrackerExport, options?: ImportOptions): Promise<void>;
  clear(): Promise<void>;
  connect?(): Promise<void>;
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

  async function getProfile() {
    return (await db.profiles.get(DEFAULT_PROFILE_ID)) ?? (await db.profiles.toCollection().first());
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

  async function saveProfile(profilePatch: Partial<BabyProfile>) {
    const existing = (await getProfile()) ?? createDefaultBabyProfile();
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
    const profile = await initialize();
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

  async function deleteEvent(id: string) {
    await db.events.delete(id);
  }

  async function listEvents(query: EventQuery = {}) {
    const profile = await initialize();
    const babyId = query.babyId ?? profile.id;
    const events = await db.events.where('babyId').equals(babyId).toArray();

    return events
      .filter((event) => (query.type ? event.type === query.type : true))
      .filter((event) => (query.from ? event.startedAt >= query.from : true))
      .filter((event) => (query.to ? event.startedAt <= query.to : true))
      .sort((a, b) => {
        const result = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
        return query.sort === 'asc' ? result : -result;
      });
  }

  async function exportData(): Promise<TrackerExport> {
    const profile = await initialize();
    const events = await listEvents({ sort: 'asc' });

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      profile,
      events
    };
  }

  async function importData(data: TrackerExport, options: ImportOptions = {}) {
    assertTrackerExport(data);

    await db.transaction('rw', db.profiles, db.events, async () => {
      if (options.mode === 'replace') {
        await db.profiles.clear();
        await db.events.clear();
      }

      await db.profiles.put({
        ...data.profile,
        syncState: 'local',
        updatedAt: new Date().toISOString()
      });

      if (data.events.length > 0) {
        await db.events.bulkPut(
          data.events.map((event) => ({
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
    clear,
    close: () => db.close(),
    deleteEvent,
    exportData,
    getProfile,
    importData,
    initialize,
    listEvents,
    saveProfile,
    updateEvent
  };
}

export const trackerStore = createLocalBabyTrackerStore();
