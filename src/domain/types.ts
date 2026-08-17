export const DEFAULT_PROFILE_ID = 'theo-roche';
export const THEO_DUE_DATE = '2026-09-01';

export type SyncState = 'local' | 'synced' | 'conflict';

export interface BaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  syncState?: SyncState;
}

export interface CareContact {
  name: string;
  phone?: string;
  address?: string;
}

export type FeedingType = 'breastmilk' | 'formula' | 'combination';

export interface CareInfo {
  // Location / routing
  homeAddress?: string;

  // Care team
  hospital?: CareContact;
  ob?: CareContact;
  pediatrician?: CareContact;
  lactation?: CareContact;
  pharmacy?: CareContact;

  // People
  guardians?: CareContact[];        // parents / primary caregivers
  emergencyContacts?: CareContact[]; // backup contacts

  // Admin
  insurance?: { plan: string; memberId: string; phone: string };

  // Baby health
  babyBloodType?: string;
  babyAllergies?: string;

  // Feeding reference (for caregivers, separate from the event log)
  feedingType?: FeedingType;
  formulaBrand?: string;
  bottleAmountOz?: number;
  feedingNotes?: string;

  // Sleep & soothing
  safeSleep?: string;
  sleepRoutine?: string;
  soothingMethods?: string;

  // Standing medications (name + dose + schedule, not individual log entries)
  currentMedications?: string;

  // Skin & diapering
  skinNotes?: string;
}

export interface BabyProfile extends BaseRecord {
  name: string;
  dueDate: string;
  birthDate?: string;
  timezone: string;
  careInfo?: CareInfo;
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
export type FeedMethod = 'nursing' | 'bottle';
export type MedicationStatus = 'scheduled' | 'given' | 'skipped';

/**
 * One feeding, however it happened. Nursing and bottle used to be separate
 * event types; they are one entry now because both duration and amount are
 * situational — a bottle is rarely timed, and a nursing session rarely has a
 * known volume. See `domain/legacyEvents.ts` for how older rows are read.
 */
export interface FeedEvent extends BaseCareEvent {
  type: 'feed';
  method: FeedMethod;
  /** Minutes at the breast (or on the bottle) — optional. */
  durationMinutes?: number;
  /** Ounces taken — optional. */
  amountOz?: number;
  /** Side nursed on. */
  side?: NursingSide;
  /** What was in the bottle. */
  contents?: BottleContents;
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

/** A bath. Nothing to measure — the time it happened is the whole point. */
export interface BathEvent extends BaseCareEvent {
  type: 'bath';
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

export interface TemperatureEvent extends BaseCareEvent {
  type: 'temperature';
  /** Canonical temperature in Celsius. */
  celsius: number;
}

export interface TummyTimeEvent extends BaseCareEvent {
  type: 'tummytime';
  durationMinutes: number;
}

export interface MoodEvent extends BaseCareEvent {
  type: 'mood';
  /** Mood/fussiness level 1–5 (see mood-scale.csv). */
  level: number;
}

export interface MilestoneEvent extends BaseCareEvent {
  type: 'milestone';
  /** Reference id from developmental-milestones.csv (see getMilestones). */
  refId: string;
}

export interface VaccineEvent extends BaseCareEvent {
  type: 'vaccine';
  /** Reference id from vaccination-schedule.csv (see getVaccinationSchedule). */
  refId: string;
}

export type CareEvent =
  | BathEvent
  | BirthEvent
  | FeedEvent
  | PumpEvent
  | DiaperEvent
  | SleepEvent
  | MedicationEvent
  | AppointmentEvent
  | GrowthEvent
  | NoteEvent
  | TemperatureEvent
  | TummyTimeEvent
  | MoodEvent
  | MilestoneEvent
  | VaccineEvent;

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
  bath: 'Bath',
  birth: 'Birth',
  diaper: 'Diaper',
  feed: 'Feeding',
  growth: 'Growth',
  medication: 'Medication',
  milestone: 'Milestone',
  mood: 'Mood',
  note: 'Note',
  pump: 'Pumping',
  sleep: 'Sleep',
  temperature: 'Temperature',
  tummytime: 'Tummy time',
  vaccine: 'Vaccine'
};
