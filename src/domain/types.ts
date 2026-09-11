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
  /**
   * Set when someone has been archived: they leave the switcher and every entry
   * they have stays exactly where it is. Nothing about a person is ever deleted
   * — a family may be setting a profile aside for the saddest of reasons, and a
   * record that can be brought back is the only kind worth offering.
   */
  archivedAt?: string;
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

/**
 * What a parent puts in — a meal, a snack, a drink. Kept apart from the baby's
 * `feed` on purpose: a feed is care given to someone else, an intake is one
 * person's own digestion, and the two are never the same row.
 */
export type IntakeKind = 'food' | 'drink';
export type IntakePortion = 'small' | 'medium' | 'large';

/**
 * What comes back out, and the symptoms alongside it. Bloating and cramping are
 * not outputs in any literal sense; they are what someone is trying to get
 * relief from, so they are logged on the same scale as the rest.
 */
export type OutputKind = 'pee' | 'poo' | 'fart' | 'burp' | 'vomit' | 'reflux' | 'bloating' | 'cramp';

export const intakeKindLabels: Record<IntakeKind, string> = {
  drink: 'Drink',
  food: 'Food'
};

export const intakePortionLabels: Record<IntakePortion, string> = {
  large: 'Large',
  medium: 'Medium',
  small: 'Small'
};

export const outputKindLabels: Record<OutputKind, string> = {
  bloating: 'Bloating',
  burp: 'Burp',
  cramp: 'Cramp',
  fart: 'Gas',
  pee: 'Pee',
  poo: 'Poo',
  reflux: 'Reflux',
  vomit: 'Vomit'
};

/**
 * One thing eaten or drunk. `items` is what someone actually types; `tags` is
 * the same thing as `food-triggers.csv` ids, and it is the half a later
 * association pass can count — "oat milk latte" and "flat white" are two
 * strings and one group.
 */
export interface IntakeEvent extends BaseCareEvent {
  type: 'intake';
  kind: IntakeKind;
  /** What it was, as written. Free text, never parsed for meaning. */
  items?: string;
  /** `food-triggers.csv` ids. Stored as written so an unknown id survives. */
  tags?: string[];
  portion?: IntakePortion;
  /** Volume drunk, in ounces — the same canonical unit as a bottle. */
  amountOz?: number;
  /** Caffeine in milligrams, when it is worth being exact about. */
  caffeineMg?: number;
}

/**
 * One thing that came out, or one symptom. `severity` is the single scale every
 * kind shares (1 slight — 5 severe), which is what makes them comparable at
 * all; `bristol` and `color` describe a stool and nothing else.
 */
export interface OutputEvent extends BaseCareEvent {
  type: 'output';
  kind: OutputKind;
  /** 1–5. How much of it, or how bad it was. */
  severity?: number;
  /** Bristol stool scale 1–7 (see `bristol-stool-scale.csv`). Poo only. */
  bristol?: number;
  /** A `stool-colors.csv` id. Poo only. */
  color?: string;
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
  | IntakeEvent
  | NoteEvent
  | OutputEvent
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

/**
 * The household lists. Neither is a `CareEvent` — a shopping item is not
 * something that happened to somebody at a time, it is a row with a state, and
 * forcing it into the event log would put it on every timeline and in every
 * daily count. They live on their own tabs, shared the same way everything else
 * is: whatever one parent checks off, the other one sees on the next poll.
 */
export type ShoppingStatus = 'need' | 'cart' | 'done';

/** Ordered the way a store is walked, which is the order the list renders in. */
export type ShoppingCategory =
  | 'produce'
  | 'bakery'
  | 'meat'
  | 'dairy'
  | 'frozen'
  | 'pantry'
  | 'drinks'
  | 'snacks'
  | 'baby'
  | 'health'
  | 'household'
  | 'cleaning'
  | 'personal'
  | 'pet';

export const shoppingStatusLabels: Record<ShoppingStatus, string> = {
  cart: 'In the cart',
  done: 'Bought',
  need: 'Need'
};

export const shoppingCategoryLabels: Record<ShoppingCategory, string> = {
  baby: 'Baby',
  bakery: 'Bakery',
  cleaning: 'Cleaning',
  dairy: 'Dairy & chilled',
  drinks: 'Drinks',
  frozen: 'Frozen',
  health: 'Health',
  household: 'Household',
  meat: 'Meat & fish',
  pantry: 'Pantry',
  personal: 'Personal care',
  pet: 'Pet',
  produce: 'Produce',
  snacks: 'Snacks'
};

/**
 * One thing to buy. An item is never removed when it is bought — it goes to
 * `done` and stays, which is what makes the list double as the household's
 * catalogue: the next trip re-adds it with one tap instead of retyping it, and
 * the edible ones are what the intake picker suggests from.
 */
export interface ShoppingItem extends BaseRecord {
  name: string;
  category: ShoppingCategory;
  /**
   * Something a parent might log eating or drinking. Not quite "edible" —
   * formula is food and is the baby's, so it is `false` here.
   */
  isFood: boolean;
  status: ShoppingStatus;
  /** How many, or how much — free text, because "2 lbs" and "3" are both answers. */
  quantity?: string;
  notes?: string;
  /** Profile id of whoever put it on the list. */
  addedBy?: string;
  completedAt?: string;
}

export type TaskStatus = 'open' | 'done';

/**
 * One shared job. `dueAt` is optional on purpose — most of what a household
 * needs to do has no date, and making one up turns a list of jobs into a
 * calendar full of things that are already late.
 */
export interface TaskItem extends BaseRecord {
  title: string;
  notes?: string;
  status: TaskStatus;
  /** When it is due. Absent means open-ended: it needs doing, not doing *then*. */
  dueAt?: string;
  /** Profile id it is on. Unassigned is anyone's, never a guess at whose. */
  assigneeId?: string;
  completedAt?: string;
  createdBy?: string;
}

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
  /** The household lists. Absent in an export taken before they existed. */
  shopping?: ShoppingItem[];
  tasks?: TaskItem[];
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
  /**
   * The household lists, read in the same round trip as everything else so one
   * parent checking an item off shows up on the other's screen at the next poll.
   */
  shopping: ShoppingItem[];
  tasks: TaskItem[];
}

export type CareEventType = CareEvent['type'];

export const careEventLabels: Record<CareEventType, string> = {
  appointment: 'Appointment',
  bath: 'Bath',
  birth: 'Birth',
  diaper: 'Diaper',
  feed: 'Feeding',
  growth: 'Growth',
  intake: 'Input',
  medication: 'Medication',
  menses: 'Period',
  milestone: 'Milestone',
  mood: 'Mood',
  note: 'Note',
  output: 'Output',
  pump: 'Pumping',
  sleep: 'Sleep',
  temperature: 'Temperature',
  tummytime: 'Tummy time',
  vaccine: 'Vaccine'
};
