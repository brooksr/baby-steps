import { describe, expect, it } from 'vitest';
import { referenceSheets } from '../../data/referenceSheets';
import { parseCsv } from '../csv';
import type { BabyProfile, CareEvent } from '../types';
import { assessLatestGrowth, classifyMeasurement } from './assess';
import { getGrowthStandardSex, getGrowthStandards } from './standards';
import { boyGrowthStandards, type GrowthMetric } from './whoBoyStandards';
import { girlGrowthStandards } from './whoGirlStandards';

const FILES: Record<GrowthMetric, string> = {
  head: 'head-circumference-for-age',
  length: 'length-for-age',
  weight: 'weight-for-age'
};

describe('getGrowthStandards', () => {
  it('uses the girls’ tables for a girl and the boys’ otherwise', () => {
    expect(getGrowthStandards('girl')).toBe(girlGrowthStandards);
    expect(getGrowthStandards('boy')).toBe(boyGrowthStandards);
    expect(getGrowthStandardSex('other')).toBe('boys');
    expect(getGrowthStandardSex(undefined)).toBe('boys');
  });

  it('matches the WHO girls’ published values', () => {
    expect(girlGrowthStandards.length.points[0]).toEqual({ median: 49.1, month: 0, p2: 45.4, p98: 52.9 });
    expect(girlGrowthStandards.weight.points.find((point) => point.month === 12)).toEqual({ median: 8.9, month: 12, p2: 7.0, p98: 11.5 });
    expect(girlGrowthStandards.head.points.find((point) => point.month === 24)?.median).toBe(47.2);
  });

  // The tables are typed out for the charts and shipped as CSVs for the Learn
  // page; they must say the same thing.
  it.each(['boys', 'girls'] as const)('agrees with the bundled %s CSVs', (sex) => {
    const standards = sex === 'girls' ? girlGrowthStandards : boyGrowthStandards;
    for (const metric of Object.keys(FILES) as GrowthMetric[]) {
      const sheet = referenceSheets.find((entry) => entry.filename === `${FILES[metric]}-${sex}.csv`);
      expect(sheet).toBeDefined();
      const rows = parseCsv(sheet!.text).rows.map((row) => row.map(Number));
      expect(rows).toEqual(standards[metric].points.map((point) => [point.month, point.p2, point.median, point.p98]));
    }
  });
});

describe('assessLatestGrowth by sex', () => {
  const base: BabyProfile = {
    birthDate: '2026-06-01',
    createdAt: '2026-06-01T00:00:00.000Z',
    dueDate: '2026-06-01',
    id: 'avery',
    name: 'Avery',
    timezone: 'America/Los_Angeles',
    updatedAt: '2026-06-01T00:00:00.000Z'
  };
  // 45.7 cm at birth: under the boys' -2 SD (46.1), inside the girls' (45.4).
  const birth: CareEvent = {
    babyId: 'avery',
    createdAt: '2026-06-01T10:00:00.000Z',
    id: 'birth',
    lengthIn: 45.7 / 2.54,
    startedAt: '2026-06-01T10:00:00.000Z',
    type: 'birth',
    updatedAt: '2026-06-01T10:00:00.000Z'
  };

  it('compares a girl against the girls’ curves', () => {
    const [length] = assessLatestGrowth({ ...base, gender: 'girl' }, [birth]);
    expect(length.band).toBe('within');
    expect(length.standard.median).toBe(49.1);
  });

  it('keeps a boy, or no sex recorded, on the boys’ curves', () => {
    expect(assessLatestGrowth({ ...base, gender: 'boy' }, [birth])[0].band).toBe('below');
    expect(assessLatestGrowth(base, [birth])[0].band).toBe('below');
    expect(classifyMeasurement('length', 0, 45.7).band).toBe('below');
  });
});
