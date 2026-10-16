import type { NewProfileInput } from '../domain/family';
import type { NurseryData } from '../domain/nurserySensor';
import type { BabyProfile, CareEvent, CareEventType, CreateCareEventInput, ShoppingItem, TaskItem, TrackerExport, TrackerSnapshot } from '../domain/types';

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
  backend: 'local' | 'google-sheets' | 'internal';
  configured: boolean;
  connected: boolean;
  /** The family on this device — a legacy spreadsheet id or an internal opaque id. Unset until one is connected. */
  familyId?: string;
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
  /**
   * The nursery sensor's nightly summaries and sound episodes, read from the
   * family sheet. Null when there are none to read — offline, local-only, or a
   * sheet the sensor has never written to. Never part of `snapshot`: it is a
   * report's extra, and the poll should not pay for it every 45 seconds.
   */
  readNurseryData?(): Promise<NurseryData | null>;
  close(): void;
}
