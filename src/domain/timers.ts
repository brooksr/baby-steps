export type TimerType = 'feed' | 'pump' | 'sleep' | 'tummytime';

const TIMER_ELIGIBLE = new Set<string>(['feed', 'pump', 'sleep', 'tummytime']);

export function isTimerType(type: string): type is TimerType {
  return TIMER_ELIGIBLE.has(type);
}

export interface ActiveTimers {
  feed?: { startedAt: string };
  pump?: { startedAt: string };
  sleep?: { startedAt: string };
  tummytime?: { startedAt: string };
}

const STORAGE_KEY = 'babysteps-timers';

/** Timers belong to a child, not to the device — twins can each be nursing. */
type StoredTimers = Record<string, ActiveTimers>;

function readStored(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function cleanTimers(value: unknown): ActiveTimers {
  if (!value || typeof value !== 'object') {
    return {};
  }

  // Drop retired keys (breastfeed/bottle) so a timer left running before the
  // feeding merge cannot stick around with nothing able to stop it.
  return Object.fromEntries(
    Object.entries(value as Record<string, { startedAt?: unknown }>).filter(
      ([type, timer]) => isTimerType(type) && typeof timer?.startedAt === 'string'
    )
  );
}

/**
 * Timers used to be one flat map for the one baby this app tracked. A device
 * still holding that shape hands those timers to the child asking for them —
 * back then there was only one — and the next write stores them nested.
 */
function isLegacyShape(stored: Record<string, unknown>) {
  return Object.keys(stored).some((key) => isTimerType(key));
}

export function loadActiveTimers(babyId: string): ActiveTimers {
  const stored = readStored();

  if (isLegacyShape(stored)) {
    return cleanTimers(stored);
  }

  return cleanTimers(stored[babyId]);
}

export function saveActiveTimers(babyId: string, timers: ActiveTimers): void {
  const stored = readStored();
  const next: StoredTimers = isLegacyShape(stored) ? {} : (stored as StoredTimers);

  if (Object.keys(timers).length > 0) {
    next[babyId] = timers;
  } else {
    delete next[babyId];
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function getElapsedSeconds(startedAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
}

export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}
