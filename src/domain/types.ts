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

/**
 * Recorded because growth standards are sex-specific. Only the WHO boys' curves
 * are bundled today, so `girl` still charts against them — `GrowthStandards`
 * says so rather than quietly comparing against the wrong reference.
 */
export type BabyGender = 'boy' | 'girl' | 'other';

/**
 * Who a profile is. A row written before parents existed has no `kind`, and
 * every one of those is a child — so the default is `child`, never a guess.
 */
export type ProfileKind = 'child' | 'parent';

/**
 * What a parent is tracking as. `mom` is the only role offered cycle tracking,
 * because that is the one the feature is about; `parent` is there so a
 * household that does not read as mom/dad still has somewhere to land.
 */
export type ParentRole = 'mom' | 'dad' | 'parent';
export type MeasurementSystem = 'american' | 'metric';
export type WeightDisplay = 'pounds-ounces' | 'ounces';

export const babyGenderLabels: Record<BabyGender, string> = {
  boy: 'Boy',
  girl: 'Girl',
  other: 'Prefer not to say'
};

export const parentRoleLabels: Record<ParentRole, string> = {
  dad: 'Dad',
  mom: 'Mom',
  parent: 'Parent'
};

export interface PreferredUnits {
  system: MeasurementSystem;
  weightDisplay: WeightDisplay;
}

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
  /**
   * @deprecated The guardians are the parent profiles now (`kind: 'parent'`,
   * with a `phone`), so they are one record instead of two that drift apart.
   * Still read for a household that has not added parents yet, and still
   * written back untouched — history is never rewritten.
   */
  guardians?: CareContact[];
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

/**
 * One tracked person — a child or a parent. Named for the child case it started
 * as; renaming it would churn every module for no gain. A parent carries no
 * `dueDate` and no `gender`, and a child carries no `parentRole`.
 */
export interface BabyProfile extends BaseRecord {
  birthDate?: string;
  careInfo?: CareInfo;
  /** A child's due date. Never set on a parent — see `kind`. */
  dueDate?: string;
  gender?: BabyGender;
  kind?: ProfileKind;
  name: string;
  parentRole?: ParentRole;
  /** Contact number. A parent's — this is the guardian list for the Key Info card. */
  phone?: string;
  preferredUnits?: PreferredUnits;
  timezone: string;
}

interface BaseCareEvent extends BaseRecord {
  babyId: string;
  /**
   * Who did it — the profile id of a tracked parent. Optional, and empty on
   * every row logged before the field existed: an entry with no caregiver is
   * "not recorded", never a guess at whoever was most likely on.
   */
  caregiverId?: string;
  startedAt: string;
  endedAt?: string;
  notes?: string;
}

export type NursingSide = 'left' | 'right' | 'both';
export type BottleContents = 'breastmilk' | 'formula' | 'mixed' | 'other';
export type DiaperKind = 'wet' | 'dirty' | 'both';
export type DiaperPoopSize = 'small' | 'medium' | 'large';
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
  /**
   * Stool color as a `stool-colors.csv` id (see `getStoolColors`). Rows logged
   * against the old free-text box can still hold anything, so reads resolve it
   * through `domain/diaperDetails.ts` and keep an unrecognized word as written.
   */
  color?: string;
  kind: DiaperKind;
  poopSize?: DiaperPoopSize;
  type: 'diaper';
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

export type MensesFlow = 'spotting' | 'light' | 'medium' | 'heavy';

export const mensesFlowLabels: Record<MensesFlow, string> = {
  heavy: 'Heavy',
  light: 'Light',
  medium: 'Medium',
  spotting: 'Spotting'
};

/**
 * One *day* of a period, not a whole period. People log bleeding as it happens
 * and miss the odd day, so `domain/cycle.ts` groups the days back into periods
 * rather than asking anyone to remember to close one out.
 */
export interface MensesEvent extends BaseCareEvent {
  type: 'menses';
  flow: MensesFlow;
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
  | MensesEvent
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
  /**
   * The first child, kept so an export still opens in a build that predates
   * multiple children. `profiles` is the real list; readers prefer it.
   */
  profile: BabyProfile;
  profiles?: BabyProfile[];
  /** Every child's events, each row carrying its own `babyId`. */
  events: CareEvent[];
}

/** Everything the UI renders, read in one round trip. See `domain/snapshot.ts`. */
export interface TrackerSnapshot {
  /** The child being shown — `query.babyId` when it matches, else the first. */
  profile: BabyProfile;
  /** Every child on this tracker, oldest first, for the switcher. */
  profiles: BabyProfile[];
  /** Only the active person's events; anyone else's rows never mix in. */
  events: CareEvent[];
  /**
   * Every child's entries — populated only when the active profile is a parent,
   * whose report is partly about the babies. A child's own view has no use for
   * a sibling's rows, and carrying them would churn its fingerprint.
   */
  childEvents?: CareEvent[];
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
  menses: 'Period',
  milestone: 'Milestone',
  mood: 'Mood',
  note: 'Note',
  pump: 'Pumping',
  sleep: 'Sleep',
  temperature: 'Temperature',
  tummytime: 'Tummy time',
  vaccine: 'Vaccine'
};
