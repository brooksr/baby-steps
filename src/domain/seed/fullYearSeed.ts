import { createDefaultBabyProfile, getLocalDateKey } from '../dates';
import { getNewbornExpectation } from '../growth/newbornExpectations';
import { DEFAULT_PROFILE_ID, type BabyProfile, type CareEvent, type TrackerExport } from '../types';

const DAY_MS = 24 * 60 * 60_000;
export const FULL_YEAR_SEED_DAYS = 365;

export function defaultFullYearBirthDate(now = new Date()): string {
  return getLocalDateKey(new Date(now.getTime() - FULL_YEAR_SEED_DAYS * DAY_MS));
}

// Feeds per day by developmental stage. Day 3 and 12 are warning markers.
function feedsForDay(day: number): number {
  if (day === 1) return 6;
  if (day === 3) return 6;   // WARNING: below daily expectation
  if (day === 12) return 7;  // WARNING: below daily expectation
  if (day <= 90) return 8;   // Newborn through 3 months
  if (day <= 180) return 7;  // 3–6 months
  if (day <= 270) return 6;  // 6–9 months (solids introduced)
  return 5;                  // 9–12 months
}

function wetDiapersForDay(day: number): number {
  if (day === 3) return 2; // WARNING marker
  if (day <= 28) {
    const expected = getNewbornExpectation(day)?.wetMin ?? 6;
    return expected + (day % 2 === 0 ? 1 : 0);
  }
  if (day <= 90) return 6 + (day % 2 === 0 ? 1 : 0);
  if (day <= 180) return 5 + (day % 3 === 0 ? 1 : 0);
  return 4 + (day % 2 === 0 ? 1 : 0);
}

function dirtyDiapersForDay(day: number): number {
  if (day <= 28) return getNewbornExpectation(day)?.stoolMin ?? 3;
  if (day <= 90) return 2 + (day % 3 === 0 ? 1 : 0);
  if (day <= 180) return 1 + (day % 2 === 0 ? 1 : 0);
  return 1;
}

// Returns [{startHour, durationH}] for each sleep window in the day.
// Hours past 24 extend into the next day (e.g. startHour=21 durationH=4 → 9pm to 1am).
function sleepWindowsForDay(day: number): Array<{ startHour: number; durationH: number }> {
  if (day <= 30) {
    // Newborn: short windows, ~6.5h logged
    return [
      { startHour: 0, durationH: 3 },
      { startHour: 10, durationH: 2 },
      { startHour: 15, durationH: 1.5 }
    ];
  }
  if (day <= 90) {
    // 1–3 months: two naps + 4h night stretch starting at 9pm
    return [
      { startHour: 9.5, durationH: 2 },
      { startHour: 14.5, durationH: 1.5 },
      { startHour: 21, durationH: 4 }
    ];
  }
  if (day <= 180) {
    // 3–6 months: two naps + 5h night stretch
    return [
      { startHour: 9.5, durationH: 1.5 },
      { startHour: 14, durationH: 1 },
      { startHour: 21, durationH: 5 }
    ];
  }
  if (day <= 270) {
    // 6–9 months: two naps + 8h night stretch
    return [
      { startHour: 10, durationH: 1.5 },
      { startHour: 15, durationH: 1 },
      { startHour: 20, durationH: 8 }
    ];
  }
  // 9–12 months: one nap + 10h night stretch
  return [
    { startHour: 12, durationH: 1.5 },
    { startHour: 19.5, durationH: 10 }
  ];
}

function bottleOzForDay(day: number): number {
  if (day < 7) return 2;
  if (day < 30) return 3;
  if (day < 90) return 4;
  if (day < 180) return 5;
  return 6;
}

function nursingMinutesForDay(day: number): number {
  if (day <= 30) return 18;
  if (day <= 90) return 15;
  if (day <= 180) return 12;
  return 10;
}

export function buildFullYearSeed(birthDate = defaultFullYearBirthDate()): TrackerExport {
  const base = new Date(`${birthDate}T00:00:00`).getTime();
  const events: CareEvent[] = [];
  let counter = 0;

  const at = (day: number, hour: number, minute = 0) =>
    new Date(base + (day - 1) * DAY_MS + hour * 3_600_000 + minute * 60_000).toISOString();

  const push = (startedAt: string, fields: Record<string, unknown>) => {
    counter += 1;
    events.push({
      babyId: DEFAULT_PROFILE_ID,
      createdAt: startedAt,
      id: `seed_yr_${String(counter).padStart(4, '0')}`,
      startedAt,
      syncState: 'synced',
      updatedAt: startedAt,
      ...fields
    } as CareEvent);
  };

  // Birth event (day 1)
  push(at(1, 6, 30), {
    headCircumferenceIn: 13.6,
    lengthIn: 19.7,
    notes: 'Welcome, Theo!',
    type: 'birth',
    weightOz: 116
  });

  for (let day = 1; day <= FULL_YEAR_SEED_DAYS; day++) {
    const feeds = feedsForDay(day);
    const nursingMin = nursingMinutesForDay(day);
    const bottleOz = bottleOzForDay(day);

    // Feeds — alternate nursing and bottle, evenly distributed
    for (let i = 0; i < feeds; i++) {
      const hour = Math.round((i * 24) / feeds);
      if (i % 2 === 0) {
        push(at(day, hour, 10), {
          durationMinutes: nursingMin,
          endedAt: at(day, hour, 10 + nursingMin),
          side: i % 4 === 0 ? 'left' : 'right',
          type: 'breastfeed'
        });
      } else {
        push(at(day, hour, 15), { amountOz: bottleOz, contents: 'breastmilk', type: 'bottle' });
      }
    }

    // Diapers
    const wet = wetDiapersForDay(day);
    for (let i = 0; i < wet; i++) {
      push(at(day, Math.round((i * 22) / Math.max(1, wet)) + 1, 5), { kind: 'wet', type: 'diaper' });
    }
    const dirty = dirtyDiapersForDay(day);
    for (let i = 0; i < dirty; i++) {
      const color = day <= 2 ? 'black' : day <= 4 ? 'green' : day <= 90 ? 'yellow' : 'tan';
      push(at(day, Math.round((i * 20) / Math.max(1, dirty)) + 2, 40), { color, kind: 'dirty', type: 'diaper' });
    }

    // Sleep windows (endedAt uses fractional hours exceeding 24 to cross midnight)
    for (const { startHour, durationH } of sleepWindowsForDay(day)) {
      push(at(day, startHour), { endedAt: at(day, startHour + durationH), type: 'sleep' });
    }

    // Daily vitamin D drops
    push(at(day, 9, 0), {
      dose: '400 IU',
      givenAt: at(day, 9, 0),
      medicationName: 'Vitamin D',
      scheduledAt: at(day, 9, 0),
      status: 'given',
      type: 'medication'
    });

    // Pump: every other day for the first 6 months
    if (day <= 180 && day % 2 === 0) {
      push(at(day, 13, 0), { amountOz: day < 30 ? 3 : 4, side: 'both', type: 'pump' });
    }

    // Tummy time: day 3 through 5 months
    if (day >= 3 && day <= 150) {
      const minutes = Math.min(30, 3 + Math.floor(day / 2));
      push(at(day, 11, 0), { durationMinutes: minutes, endedAt: at(day, 11, minutes), type: 'tummytime' });
    }

    // Mood (fussier every 5th day)
    push(at(day, 17, 0), { level: day % 5 === 0 ? 3 : day % 2 === 0 ? 2 : 1, type: 'mood' });

    // Temperature: every 3 days
    if (day % 3 === 0) {
      push(at(day, 12, 0), { celsius: 37.0, type: 'temperature' });
    }
  }

  // Standard pediatric checkups
  const checkups: Array<[number, string]> = [
    [5, 'Newborn checkup'],
    [14, '2-week checkup'],
    [60, '2-month checkup'],
    [120, '4-month checkup'],
    [180, '6-month checkup'],
    [270, '9-month checkup'],
    [365, '12-month checkup']
  ];
  for (const [day, reason] of checkups) {
    if (day <= FULL_YEAR_SEED_DAYS) {
      push(at(day, 10, 0), { location: 'Pediatrics Clinic', provider: 'Dr. Lee', reason, type: 'appointment' });
    }
  }

  // Monthly growth measurements (WHO 50th percentile for boys, approximate)
  const growthData: Array<{ day: number; weightOz: number; lengthIn?: number; headIn?: number }> = [
    { day: 14, weightOz: 130, headIn: 14.5 },
    { day: 30, weightOz: 148, lengthIn: 21.3, headIn: 14.9 },
    { day: 60, weightOz: 184, lengthIn: 22.8, headIn: 15.4 },
    { day: 90, weightOz: 208, lengthIn: 24.0, headIn: 16.0 },
    { day: 120, weightOz: 226, lengthIn: 25.2, headIn: 16.3 },
    { day: 150, weightOz: 243, lengthIn: 25.9, headIn: 16.7 },
    { day: 180, weightOz: 258, lengthIn: 26.6, headIn: 17.1 },
    { day: 210, weightOz: 269, lengthIn: 27.4 },
    { day: 240, weightOz: 280, lengthIn: 28.0 },
    { day: 270, weightOz: 290, lengthIn: 28.5 },
    { day: 300, weightOz: 299, lengthIn: 29.1 },
    { day: 330, weightOz: 307 },
    { day: 365, weightOz: 317, lengthIn: 29.8, headIn: 18.3 }
  ];
  for (const { day, weightOz, lengthIn, headIn } of growthData) {
    if (day <= FULL_YEAR_SEED_DAYS) {
      push(at(day, 10, 30), {
        type: 'growth',
        weightOz,
        ...(lengthIn !== undefined ? { lengthIn } : {}),
        ...(headIn !== undefined ? { headCircumferenceIn: headIn } : {})
      });
    }
  }

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
