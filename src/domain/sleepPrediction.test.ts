import { describe, expect, it } from 'vitest';
import { predictNextSleepChange } from './sleepPrediction';
import type { CareEvent } from './types';

const MINUTE = 60_000;

const base = {
  babyId: 'avery-example',
  createdAt: '2026-09-10T12:00:00.000Z',
  syncState: 'local' as const,
  updatedAt: '2026-09-10T12:00:00.000Z'
};

/** Local wall-clock times, so night/day reads the same in any test zone. */
function at(day: number, hour: number, minute = 0) {
  return new Date(2026, 8, day, hour, minute);
}

function sleep(start: Date, minutes: number, id = start.toISOString()): CareEvent {
  return {
    ...base,
    endedAt: new Date(start.getTime() + minutes * MINUTE).toISOString(),
    id: `sleep-${id}`,
    startedAt: start.toISOString(),
    type: 'sleep'
  };
}

/** Three days of a 9am and a 1pm nap, 90 minutes each, with 2.5h up between. */
function napDays(): CareEvent[] {
  return [7, 8, 9].flatMap((day) => [sleep(at(day, 9), 90), sleep(at(day, 13), 90)]);
}

describe('predictNextSleepChange', () => {
  it('declines with too few sleeps to read a rhythm from', () => {
    const events = [sleep(at(9, 9), 90), sleep(at(9, 13), 90)];

    expect(predictNextSleepChange(events, { now: at(9, 15) })).toBeNull();
    expect(predictNextSleepChange([], { asleepSince: at(9, 15).toISOString(), now: at(9, 15, 30) })).toBeNull();
  });

  it('predicts the next nap from the usual time awake after a daytime sleep', () => {
    const prediction = predictNextSleepChange(napDays(), { now: at(9, 15) });

    expect(prediction?.transition).toBe('sleep');
    expect(prediction?.isNight).toBe(false);
    // The 10:30 → 1pm gaps are the only day wakes: 2.5h after the 2:30pm wake.
    expect(prediction?.typicalMinutes).toBe(150);
    expect(new Date(prediction!.expectedAt).getTime()).toBe(at(9, 17).getTime());
    expect(prediction?.minutesAway).toBe(120);
  });

  it('predicts waking from the usual length of the same kind of sleep', () => {
    const events = [...napDays(), ...[6, 7, 8].map((day) => sleep(at(day, 20), 600))];

    const nap = predictNextSleepChange(events, { asleepSince: at(10, 9).toISOString(), now: at(10, 9, 30) });
    expect(nap?.transition).toBe('wake');
    expect(nap?.typicalMinutes).toBe(90);

    const night = predictNextSleepChange(events, { asleepSince: at(9, 20).toISOString(), now: at(9, 22) });
    expect(night?.isNight).toBe(true);
    expect(night?.typicalMinutes).toBe(600);
    expect(new Date(night!.expectedAt).getTime()).toBe(at(10, 6).getTime());
  });

  it('keeps the window between 15 minutes and an hour either side', () => {
    const prediction = predictNextSleepChange(napDays(), { now: at(9, 15) });
    const half = (Date.parse(prediction!.windowEndAt) - Date.parse(prediction!.expectedAt)) / MINUTE;

    expect(half).toBe(15);
  });

  it('says nothing once the log has plainly gone quiet', () => {
    expect(predictNextSleepChange(napDays(), { now: at(9, 22) })).toBeNull();
  });

  it('merges overlapping entries for the same sleep', () => {
    const events = [...napDays(), sleep(at(9, 13, 30), 30, 'dup')];

    expect(predictNextSleepChange(events, { now: at(9, 15) })?.typicalMinutes).toBe(150);
  });
});
