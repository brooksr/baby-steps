import type { BabyProfile, CareEvent, ShoppingItem, TaskItem, TrackerExport } from './types';

export type RecordCollection = 'events' | 'nursery' | 'profiles' | 'shopping' | 'tasks';
export interface MutationCommand {
  action: 'archive' | 'remove' | 'restore' | 'save';
  collection: RecordCollection;
  expectedRevision: number;
  id: string;
  operationId: string;
  patch?: Record<string, unknown>;
}
export interface MutationResult {
  collection: RecordCollection;
  deletedAt?: string;
  id: string;
  payload: Record<string, unknown>;
  revision: number;
  related?: Array<Omit<MutationResult,'related'>>;
}
export interface BootstrapData {
  accountId: string;
  actorProfileId: string;
  cursor: { after: number; familyId: string };
  data: TrackerExport;
  familyId: string;
  revisions: Record<string, number>;
  role: 'caregiver' | 'parent';
}
export type InternalDocument = BabyProfile | CareEvent | ShoppingItem | TaskItem;
export interface InternalFamily { familyId: string; name: string; role: 'caregiver' | 'parent' }
