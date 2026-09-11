import { createDefaultBabyProfile, getDeviceTimezone } from './dates';
import type { BabyGender, BabyProfile, ParentRole, PreferredUnits, ProfileKind } from './types';

// Keeps its original name: a device that already stored a choice under this key
// must not lose it just because the switcher grew to cover parents too.
const ACTIVE_PROFILE_KEY = 'babysteps.activeChild';
const CAREGIVER_KEY = 'babysteps.caregiver';

/** What to call someone whose profile has no usable name yet. */
const UNNAMED = 'Baby';

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Who this device logs as, remembered between entries. A phone belongs to one
 * person, so the quick-add form opens on whoever used it last rather than
 * asking every time — which is the difference between a field people fill in
 * and one they skip. Device-local, like the active-profile choice.
 */
export function getStoredCaregiverId(): string | undefined {
  return safeStorage()?.getItem(CAREGIVER_KEY) ?? undefined;
}

export function storeCaregiverId(id: string): void {
  const storage = safeStorage();

  if (!storage) {
    return;
  }

  // An entry saved with no caregiver clears the default rather than pinning the
  // previous one — "not recorded" is a choice, not a blank to be filled in.
  if (id) {
    storage.setItem(CAREGIVER_KEY, id);
  } else {
    storage.removeItem(CAREGIVER_KEY);
  }
}

/**
 * A row written before parents existed is a child — never a guess, just what
 * the app was when that row was written.
 */
export function getProfileKind(profile: Pick<BabyProfile, 'kind'>): ProfileKind {
  return profile.kind === 'parent' ? 'parent' : 'child';
}

export function isParent(profile: Pick<BabyProfile, 'kind'>): boolean {
  return getProfileKind(profile) === 'parent';
}

export function isChild(profile: Pick<BabyProfile, 'kind'>): boolean {
  return getProfileKind(profile) === 'child';
}

/**
 * Cycle tracking is offered to a parent whose role is `mom` — the role the
 * feature was asked for. Everyone else's profile simply never shows it.
 */
export function tracksCycle(profile: Pick<BabyProfile, 'kind' | 'parentRole'>): boolean {
  return isParent(profile) && profile.parentRole === 'mom';
}

/**
 * Which person this device is looking at. Device-local on purpose: the shared
 * sheet holds the whole family, but each caregiver's phone picks its own — one
 * parent switching to the twin must not move everyone else's screen.
 */
export function getStoredActiveProfileId(): string | undefined {
  return safeStorage()?.getItem(ACTIVE_PROFILE_KEY) ?? undefined;
}

export function storeActiveProfileId(id: string): void {
  safeStorage()?.setItem(ACTIVE_PROFILE_KEY, id);
}

/**
 * Children first, then parents, each oldest first — the app is a baby tracker,
 * so the switcher opens on the babies. Within a group the order is the order
 * they were added, and is the same on every device. `createdAt` can tie (an
 * import writes a batch in one go), so name breaks it rather than leaving it to
 * whatever order the table happened to return.
 */
export function sortProfiles(profiles: BabyProfile[]): BabyProfile[] {
  return [...profiles].sort((left, right) => {
    const byKind = Number(isParent(left)) - Number(isParent(right));

    if (byKind !== 0) {
      return byKind;
    }

    const byCreated = left.createdAt.localeCompare(right.createdAt);
    return byCreated !== 0 ? byCreated : left.name.localeCompare(right.name);
  });
}

/** Who an entry can be attributed to: the tracked parents, in switcher order. */
export function getCaregivers(profiles: BabyProfile[]): BabyProfile[] {
  return sortProfiles(profiles).filter(isParent);
}

/**
 * The caregiver to show on an entry. A parent removed from the family since is
 * unresolvable — history keeps the id, but there is no name left to print, so
 * the entry reads as unattributed rather than as a dangling id.
 */
export function getCaregiverName(profiles: BabyProfile[], caregiverId: string | undefined): string | undefined {
  if (!caregiverId) {
    return undefined;
  }

  const match = profiles.find((person) => person.id === caregiverId);
  return match ? getFirstName(match) : undefined;
}

/** First name only — the app talks about a child, not a filing entry. */
export function getFirstName(profile: Pick<BabyProfile, 'name'> | null | undefined): string {
  return profile?.name.trim().split(/\s+/)[0] || UNNAMED;
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

/**
 * A readable id, because it is what a caregiver sees in the shared sheet's
 * `babyId` column. Suffixed only on a collision, so the first person of a name
 * reads as plain `mila-roche`.
 */
export function createProfileId(name: string, existingIds: readonly string[] = []): string {
  const base = slugify(name) || 'child';
  const taken = new Set(existingIds);

  if (!taken.has(base)) {
    return base;
  }

  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }

  return `${base}-${Date.now().toString(36)}`;
}

export interface NewProfileInput {
  birthDate?: string;
  /** A child's due date. Leave unset for a parent. */
  dueDate?: string;
  gender?: BabyGender;
  kind?: ProfileKind;
  name: string;
  parentRole?: ParentRole;
  phone?: string;
  preferredUnits?: PreferredUnits;
  timezone?: string;
}

/**
 * A new person starts from the defaults rather than from whoever is on screen —
 * only the units and timezone carry over, since those describe the household,
 * not the person.
 *
 * Stamped strictly after the children already there: the switcher orders by
 * `createdAt`, and on a fresh device the first child is seeded lazily, so both
 * can otherwise land in the same millisecond and swap places.
 */
export function createFamilyProfile(input: NewProfileInput, existing: readonly BabyProfile[] = [], now = new Date()): BabyProfile {
  const latest = existing.reduce((newest, person) => (person.createdAt > newest ? person.createdAt : newest), '');
  const own = now.toISOString();
  const timestamp = own > latest ? own : new Date(new Date(latest).getTime() + 1).toISOString();
  const defaults = createDefaultBabyProfile(now);

  return {
    birthDate: input.birthDate || undefined,
    createdAt: timestamp,
    dueDate: input.dueDate || undefined,
    gender: input.gender,
    id: createProfileId(
      input.name,
      existing.map((person) => person.id)
    ),
    kind: input.kind ?? 'child',
    name: input.name.trim(),
    parentRole: input.parentRole,
    phone: input.phone?.trim() || undefined,
    preferredUnits: input.preferredUnits ?? defaults.preferredUnits,
    syncState: 'local',
    timezone: input.timezone ?? getDeviceTimezone(),
    updatedAt: timestamp
  };
}
