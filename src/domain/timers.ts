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

export function loadActiveTimers(): ActiveTimers {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Record<string, { startedAt: string }>) : {};
    // Drop retired keys (breastfeed/bottle) so a timer left running before the
    // feeding merge cannot stick around with nothing able to stop it.
    return Object.fromEntries(Object.entries(stored).filter(([type]) => isTimerType(type)));
  } catch {
    return {};
  }
}

export function saveActiveTimers(timers: ActiveTimers): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(timers));
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
