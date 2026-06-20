export const DEFAULT_PROFILE_ID = 'theo-roche';
export const THEO_DUE_DATE = '2026-09-01';

export type SyncState = 'local' | 'synced' | 'conflict';

export interface BaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  syncState?: SyncState;
}

export interface BabyProfile extends BaseRecord {
  name: string;
  dueDate: string;
  birthDate?: string;
  timezone: string;
}

interface BaseCareEvent extends BaseRecord {
  babyId: string;
  startedAt: string;
  endedAt?: string;
  notes?: string;
}

export type NursingSide = 'left' | 'right' | 'both';
export type BottleContents = 'breastmilk' | 'formula' | 'mixed' | 'other';
export type DiaperKind = 'wet' | 'dirty' | 'both';
export type MedicationStatus = 'scheduled' | 'given' | 'skipped';

export interface BreastfeedEvent extends BaseCareEvent {
  type: 'breastfeed';
  side: NursingSide;
  durationMinutes: number;
}

export interface BottleEvent extends BaseCareEvent {
  type: 'bottle';
  amountOz: number;
  contents: BottleContents;
}

export interface PumpEvent extends BaseCareEvent {
  type: 'pump';
  amountOz: number;
  side: NursingSide;
}

export interface DiaperEvent extends BaseCareEvent {
  type: 'diaper';
  kind: DiaperKind;
  color?: string;
}

export interface SleepEvent extends BaseCareEvent {
  type: 'sleep';
}

export interface MedicationEvent extends BaseCareEvent {
  type: 'medication';
  medicationName: string;
  dose: string;
  scheduledAt?: string;
  givenAt?: string;
  status: MedicationStatus;
}

export interface AppointmentEvent extends BaseCareEvent {
  type: 'appointment';
  provider?: string;
  location?: string;
  reason: string;
}

export interface GrowthEvent extends BaseCareEvent {
  type: 'growth';
  weightOz?: number;
  lengthIn?: number;
  headCircumferenceIn?: number;
}

export interface BirthEvent extends BaseCareEvent {
  type: 'birth';
  weightOz?: number;
  lengthIn?: number;
  headCircumferenceIn?: number;
}

export interface NoteEvent extends BaseCareEvent {
  type: 'note';
  title?: string;
}

export type CareEvent =
  | BreastfeedEvent
  | BirthEvent
  | BottleEvent
  | PumpEvent
  | DiaperEvent
  | SleepEvent
  | MedicationEvent
  | AppointmentEvent
  | GrowthEvent
  | NoteEvent;

type PersistedCareEventFields = 'id' | 'babyId' | 'createdAt' | 'updatedAt' | 'syncState';
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type CreateCareEventInput = DistributiveOmit<CareEvent, PersistedCareEventFields> & {
  id?: string;
  babyId?: string;
  createdAt?: string;
  updatedAt?: string;
  syncState?: SyncState;
};

export interface TrackerExport {
  version: 1;
  exportedAt: string;
  profile: BabyProfile;
  events: CareEvent[];
}

export type CareEventType = CareEvent['type'];

export const careEventLabels: Record<CareEventType, string> = {
  appointment: 'Appointment',
  birth: 'Birth',
  bottle: 'Bottle',
  breastfeed: 'Nursing',
  diaper: 'Diaper',
  growth: 'Growth',
  medication: 'Medication',
  note: 'Note',
  pump: 'Pumping',
  sleep: 'Sleep'
};
