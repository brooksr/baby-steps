// Deterministic "first month of life" sample dataset for verification.
//
// It covers every event type across 30 days with realistic variation, and
// deliberately drives a few days into WARNING (below newborn expectations) and
// DANGER (fever) so the Dashboard/Reports assessments can be checked by eye.
//
// Planted markers (see SEED_MARKERS):
//   - Day 3:  too few wet diapers (2 < 3) and feeds (6 < 8)  → newborn WARNING
//   - Day 12: too few feeds (7 < 8)                          → newborn WARNING
//   - Day 10: temperature 38.6 °C                            → Fever (DANGER)
//   - Day 20: temperature 36.1 °C                            → Low (variation)
//   - Day 30: temperature 39.3 °C (latest reading)           → High fever (DANGER banner)
//   - Day 14: head circumference above WHO +2 SD             → growth ABOVE range
//   - Day 28: length below WHO -2 SD                         → growth BELOW range

import { createDefaultBabyProfile, getLocalDateKey } from '../dates';
import { getNewbornExpectation } from '../growth/newbornExpectations';
import { DEFAULT_PROFILE_ID, type BabyProfile, type CareEvent, type TrackerExport } from '../types';

const DAY_MS = 24 * 60 * 60_000;
const SEED_DAYS = 30;

export const SEED_MARKERS = {
  belowRangeGrowthDay: 28,
  feverDay: 10,
  highFeverDay: 30,
  lowTempDay: 20,
  warningDays: [3, 12]
} as const;

/** Default birth date so the whole sample month sits in the recent past. */
export function defaultSeedBirthDate(now = new Date()): string {
  return getLocalDateKey(new Date(now.getTime() - SEED_DAYS * DAY_MS));
}

function plannedFeeds(day: number): number {
  if (day === 1) return 6; // day 1 minimum is 3
  if (day === 3) return 6; // WARNING: below 8
  if (day === 12) return 7; // WARNING: below 8
  return 8;
}

function plannedWetDiapers(day: number): number {
  if (day === 3) return 2; // WARNING: below 3
  const expected = getNewbornExpectation(day)?.wetMin ?? 6;
  return expected + (day % 2 === 0 ? 1 : 0);
}

function plannedStools(day: number): number {
  return getNewbornExpectation(day)?.stoolMin ?? 3;
}

export function buildFirstMonthSeed(birthDate = defaultSeedBirthDate()): TrackerExport {
  const base = new Date(`${birthDate}T00:00:00`).getTime();
  const events: CareEvent[] = [];
  let counter = 0;

  const at = (day: number, hour: number, minute = 0) => new Date(base + (day - 1) * DAY_MS + hour * 3_600_000 + minute * 60_000).toISOString();

  const push = (startedAt: string, fields: Record<string, unknown>) => {
    counter += 1;
    events.push({
      babyId: DEFAULT_PROFILE_ID,
      createdAt: startedAt,
      id: `seed_${String(counter).padStart(4, '0')}`,
      startedAt,
      syncState: 'synced',
      updatedAt: startedAt,
      ...fields
    } as CareEvent);
  };

  // Birth (day 1) — measurements near the WHO median.
  push(at(1, 6, 30), { headCircumferenceIn: 13.6, lengthIn: 19.7, notes: 'Welcome, Theo!', type: 'birth', weightOz: 116 });

  for (let day = 1; day <= SEED_DAYS; day += 1) {
    // Feeds — alternate nursing and bottle, spread across the day.
    const feeds = plannedFeeds(day);
    for (let i = 0; i < feeds; i += 1) {
      const hour = Math.round((i * 24) / feeds);
      if (i % 2 === 0) {
        push(at(day, hour, 10), { durationMinutes: 18, endedAt: at(day, hour, 28), side: i % 4 === 0 ? 'left' : 'right', type: 'breastfeed' });
      } else {
        push(at(day, hour, 15), { amountOz: day < 7 ? 2 : 3, contents: 'breastmilk', type: 'bottle' });
      }
    }

    // Diapers.
    const wet = plannedWetDiapers(day);
    for (let i = 0; i < wet; i += 1) {
      push(at(day, Math.round((i * 22) / Math.max(1, wet)) + 1, 5), { kind: 'wet', type: 'diaper' });
    }
    const stools = plannedStools(day);
    for (let i = 0; i < stools; i += 1) {
      push(at(day, Math.round((i * 20) / Math.max(1, stools)) + 2, 40), { color: day <= 2 ? 'black' : day <= 4 ? 'green' : 'yellow', kind: 'dirty', type: 'diaper' });
    }

    // Sleep — one long stretch plus two naps.
    push(at(day, 0, 0), { endedAt: at(day, 3, 0), type: 'sleep' });
    push(at(day, 10, 0), { endedAt: at(day, 12, 0), type: 'sleep' });
    push(at(day, 15, 0), { endedAt: at(day, 16, 30), type: 'sleep' });

    // Daily vitamin D drops.
    push(at(day, 9, 0), { dose: '400 IU', givenAt: at(day, 9, 0), medicationName: 'Vitamin D', scheduledAt: at(day, 9, 0), status: 'given', type: 'medication' });

    // Pump every other day.
    if (day % 2 === 0) {
      push(at(day, 13, 0), { amountOz: 3, side: 'both', type: 'pump' });
    }

    // Tummy time from day 3 onward.
    if (day >= 3) {
      const minutes = Math.min(20, 3 + Math.floor(day / 2));
      push(at(day, 11, 0), { durationMinutes: minutes, endedAt: at(day, 11, minutes), type: 'tummytime' });
    }

    // Mood once a day (fussier on the fever day).
    const moodLevel = day === SEED_MARKERS.feverDay ? 4 : day % 5 === 0 ? 3 : day % 2 === 0 ? 2 : 1;
    push(at(day, 17, 0), { level: moodLevel, type: 'mood' });

    // Temperature spot-checks: routine, plus planted fever / low readings.
    if (day === SEED_MARKERS.feverDay) {
      push(at(day, 12, 0), { celsius: 38.6, notes: 'Felt warm, monitoring.', type: 'temperature' });
    } else if (day === SEED_MARKERS.lowTempDay) {
      push(at(day, 12, 0), { celsius: 36.1, type: 'temperature' });
    } else if (day === SEED_MARKERS.highFeverDay) {
      push(at(day, 12, 0), { celsius: 39.3, notes: 'High fever — called pediatrician.', type: 'temperature' });
    } else if (day % 3 === 0) {
      push(at(day, 12, 0), { celsius: 37.0, type: 'temperature' });
    }
  }

  // Pediatrician checkup on day 5.
  push(at(5, 10, 0), { location: 'Pediatrics Clinic', provider: 'Dr. Lee', reason: 'Newborn checkup', type: 'appointment' });

  // Extra growth measurements: day 14 head above range, day 28 length below range.
  push(at(14, 10, 30), { headCircumferenceIn: 15.5, type: 'growth', weightOz: 150 });
  push(at(28, 10, 30), { lengthIn: 19.3, type: 'growth', weightOz: 158 });

  const profile: BabyProfile = {
    ...createDefaultBabyProfile(),
    birthDate: at(1, 6, 30),
    syncState: 'synced'
  };

  return {
    events: events.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()),
    exportedAt: new Date().toISOString(),
    profile,
    version: 1
  };
}
