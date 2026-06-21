import { describe, expect, it } from 'vitest';
import { getLocalDateKey } from '../dates';
import { assessLatestGrowth, assessNewbornDay } from '../growth/assess';
import { classifyTemperatureC } from '../reference';
import type { TemperatureEvent } from '../types';
import { buildFirstMonthSeed, SEED_MARKERS } from './firstMonthSeed';

const BIRTH = '2026-05-01';
const seed = buildFirstMonthSeed(BIRTH);

function dateForDay(day: number) {
  return getLocalDateKey(new Date(new Date(`${BIRTH}T00:00:00`).getTime() + (day - 1) * 24 * 60 * 60_000));
}

describe('first month seed', () => {
  it('produces a full month of events with stable ids', () => {
    expect(seed.events.length).toBeGreaterThan(300);
    expect(new Set(seed.events.map((event) => event.id)).size).toBe(seed.events.length);
    expect(seed.profile.birthDate?.slice(0, 10)).toBe(BIRTH);
  });

  it('flags the planted newborn warning days', () => {
    for (const day of SEED_MARKERS.warningDays) {
      const result = assessNewbornDay(seed.profile, seed.events, dateForDay(day));
      expect(result?.onTrack, `day ${day} should warn`).toBe(false);
    }
  });

  it('keeps a healthy day on track', () => {
    const result = assessNewbornDay(seed.profile, seed.events, dateForDay(8));
    expect(result?.onTrack).toBe(true);
  });

  it('includes fever and high-fever temperature readings', () => {
    const temps = seed.events.filter((event): event is TemperatureEvent => event.type === 'temperature');
    const bands = temps.map((event) => classifyTemperatureC(event.celsius)?.band);
    expect(bands).toContain('Fever');
    expect(bands).toContain('High fever');
    expect(bands).toContain('Low');

    const latest = temps.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
    expect(classifyTemperatureC(latest.celsius)?.band).toBe('High fever');
  });

  it('drives growth assessments above and below the expected range', () => {
    const assessments = assessLatestGrowth(seed.profile, seed.events);
    const byMetric = Object.fromEntries(assessments.map((assessment) => [assessment.metric, assessment.band]));
    expect(byMetric.head).toBe('above');
    expect(byMetric.length).toBe('below');
  });
});
