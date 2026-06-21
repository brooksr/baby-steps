import { describe, expect, it } from 'vitest';
import type { BabyProfile, CareEvent } from '../types';
import { assessNewbornDay, classifyMeasurement, getDayOfLife, getMetricPlots, getGrowthMeasurements, interpolateStandard } from './assess';
import { lengthForAgeBoys } from './whoBoyStandards';

const profile: BabyProfile = {
  birthDate: '2026-06-01',
  createdAt: '2026-06-01T00:00:00.000Z',
  dueDate: '2026-06-01',
  id: 'theo',
  name: 'Theo',
  timezone: 'America/Los_Angeles',
  updatedAt: '2026-06-01T00:00:00.000Z'
};

function diaper(dateKey: string, kind: 'wet' | 'dirty' | 'both'): CareEvent {
  return {
    babyId: 'theo',
    createdAt: `${dateKey}T08:00:00.000Z`,
    id: `${dateKey}-${kind}-${Math.random()}`,
    kind,
    startedAt: `${dateKey}T08:00:00.000Z`,
    type: 'diaper',
    updatedAt: `${dateKey}T08:00:00.000Z`
  };
}

function bottle(dateKey: string): CareEvent {
  return {
    amountOz: 2,
    babyId: 'theo',
    contents: 'breastmilk',
    createdAt: `${dateKey}T08:00:00.000Z`,
    id: `${dateKey}-feed-${Math.random()}`,
    startedAt: `${dateKey}T08:00:00.000Z`,
    type: 'bottle',
    updatedAt: `${dateKey}T08:00:00.000Z`
  };
}

describe('interpolateStandard', () => {
  it('returns exact rows at known months', () => {
    expect(interpolateStandard(lengthForAgeBoys, 0).median).toBe(49.9);
    expect(interpolateStandard(lengthForAgeBoys, 12).median).toBe(75.7);
  });

  it('interpolates between rows', () => {
    const half = interpolateStandard(lengthForAgeBoys, 0.5);
    expect(half.median).toBeCloseTo((49.9 + 54.7) / 2, 5);
  });

  it('clamps beyond the table range', () => {
    expect(interpolateStandard(lengthForAgeBoys, 99).median).toBe(87.8);
  });
});

describe('classifyMeasurement', () => {
  it('flags a value below the -2 SD line', () => {
    const result = classifyMeasurement('length', 0, 44);
    expect(result.band).toBe('below');
  });

  it('flags a value above the +2 SD line', () => {
    const result = classifyMeasurement('length', 0, 55);
    expect(result.band).toBe('above');
  });

  it('treats a near-median value as on track', () => {
    const result = classifyMeasurement('length', 0, 49.9);
    expect(result.band).toBe('within');
    expect(result.summary).toMatch(/median/i);
  });
});

describe('getGrowthMeasurements', () => {
  it('converts imperial inputs to metric and sorts by age', () => {
    const events: CareEvent[] = [
      { babyId: 'theo', createdAt: '2026-06-01T00:00:00.000Z', headCircumferenceIn: 13.6, id: 'birth', lengthIn: 19.7, startedAt: '2026-06-01T10:00:00.000Z', type: 'birth', updatedAt: '2026-06-01T00:00:00.000Z', weightOz: 116.5 }
    ];
    const [measurement] = getGrowthMeasurements(profile, events);
    expect(measurement.weightKg).toBeCloseTo(3.3, 1);
    expect(measurement.lengthCm).toBeCloseTo(50.0, 1);
    expect(getMetricPlots(getGrowthMeasurements(profile, events), 'weight')).toHaveLength(1);
  });
});

describe('newborn day assessment', () => {
  it('computes day of life with birth day as day 1', () => {
    expect(getDayOfLife('2026-06-01', '2026-06-01')).toBe(1);
    expect(getDayOfLife('2026-06-01', '2026-06-05')).toBe(5);
  });

  it('flags a day that falls below expected diaper output', () => {
    const events = [diaper('2026-06-04', 'wet'), diaper('2026-06-04', 'wet'), diaper('2026-06-04', 'dirty')];
    const result = assessNewbornDay(profile, events, '2026-06-04');
    expect(result?.dayOfLife).toBe(4);
    expect(result?.onTrack).toBe(false);
    const wet = result?.checks.find((check) => check.label === 'Wet diapers');
    expect(wet?.status).toBe('below');
  });

  it('marks a fully met day as on track', () => {
    const wets = Array.from({ length: 6 }, () => diaper('2026-06-06', 'wet'));
    const stools = Array.from({ length: 3 }, () => diaper('2026-06-06', 'dirty'));
    const feeds = Array.from({ length: 8 }, () => bottle('2026-06-06'));
    const result = assessNewbornDay(profile, [...wets, ...stools, ...feeds], '2026-06-06');
    expect(result?.onTrack).toBe(true);
  });

  it('returns null outside the newborn window', () => {
    expect(assessNewbornDay(profile, [], '2026-08-01')).toBeNull();
  });
});
