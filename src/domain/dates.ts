import { DEFAULT_PROFILE_ID, THEO_DUE_DATE, type BabyProfile } from './types';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function getDeviceTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
}

export function createDefaultBabyProfile(now = new Date()): BabyProfile {
  const timestamp = now.toISOString();

  return {
    id: DEFAULT_PROFILE_ID,
    name: 'Theo Roche',
    dueDate: THEO_DUE_DATE,
    timezone: getDeviceTimezone(),
    createdAt: timestamp,
    updatedAt: timestamp,
    syncState: 'local'
  };
}

export function addMinutes(iso: string, minutes: number) {
  return new Date(new Date(iso).getTime() + minutes * MINUTE).toISOString();
}

export function minutesBetween(startIso: string, endIso?: string) {
  if (!endIso) {
    return 0;
  }

  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / MINUTE));
}

export function toDateTimeInputValue(iso: string) {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * MINUTE);
  return local.toISOString().slice(0, 16);
}

export function fromDateTimeInputValue(value: string) {
  return new Date(value).toISOString();
}

export function getLocalDateKey(value: string | Date) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = typeof value === 'string' ? new Date(value) : value;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function isSameLocalDate(iso: string, dateKey: string) {
  return getLocalDateKey(iso) === dateKey;
}

export function formatClock(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(iso));
}

export function formatShortDate(isoOrDate: string | Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate);
}

export function formatAgo(iso: string, now = new Date()) {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / MINUTE));
  return minutes < 1 ? 'just now' : `${formatDuration(minutes)} ago`;
}

export function formatDuration(minutes: number) {
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

export function getDueDateStatus(profile: BabyProfile, now = new Date()) {
  if (profile.birthDate) {
    const birthAtNoon = new Date(`${getLocalDateKey(profile.birthDate)}T12:00:00`);
    const ageDays = Math.max(0, Math.floor((now.getTime() - birthAtNoon.getTime()) / DAY));

    if (ageDays === 0) {
      return 'Born today';
    }

    return ageDays === 1 ? '1 day old' : `${ageDays} days old`;
  }

  const dueAtNoon = new Date(`${profile.dueDate}T12:00:00`);
  const diffDays = Math.ceil((dueAtNoon.getTime() - now.getTime()) / DAY);

  if (diffDays > 1) {
    return `Due in ${diffDays} days`;
  }

  if (diffDays === 1) {
    return 'Due tomorrow';
  }

  if (diffDays === 0) {
    return 'Due today';
  }

  const ageDays = Math.abs(diffDays);
  return ageDays === 1 ? '1 day old' : `${ageDays} days old`;
}

export function getDaysUntilDue(profile: BabyProfile, now = new Date()) {
  if (profile.birthDate) {
    return 0;
  }

  const dueAtNoon = new Date(`${profile.dueDate}T12:00:00`);
  return Math.max(0, Math.ceil((dueAtNoon.getTime() - now.getTime()) / DAY));
}

export function getAgeDays(profile: BabyProfile, now = new Date()) {
  if (!profile.birthDate) {
    return 0;
  }

  const birthAtNoon = new Date(`${getLocalDateKey(profile.birthDate)}T12:00:00`);
  return Math.max(0, Math.floor((now.getTime() - birthAtNoon.getTime()) / DAY));
}
