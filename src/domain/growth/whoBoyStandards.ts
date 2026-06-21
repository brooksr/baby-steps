// WHO Child Growth Standards — BOYS (0–24 months).
// Source: World Health Organization Child Growth Standards (2006).
// https://www.who.int/tools/child-growth-standards/standards
//   - Length/height-for-age (boys)
//   - Weight-for-age (boys)
//   - Head circumference-for-age (boys)
//
// Each row captures the published -2 SD, median (0 SD) and +2 SD values, which
// bound the range most healthy infants fall within (roughly the 2nd–98th
// percentiles). The matching spreadsheets live in src/data/reference/*.csv.

export type GrowthMetric = 'length' | 'weight' | 'head';

export interface StandardPoint {
  /** Age in completed months. */
  month: number;
  /** -2 SD bound (~2nd percentile). */
  p2: number;
  /** Median (0 SD, ~50th percentile). */
  median: number;
  /** +2 SD bound (~98th percentile). */
  p98: number;
}

export interface GrowthStandard {
  metric: GrowthMetric;
  label: string;
  /** Display unit for the standard values. */
  unit: string;
  points: StandardPoint[];
}

// Length/height-for-age, boys — centimetres.
export const lengthForAgeBoys: GrowthStandard = {
  metric: 'length',
  label: 'Length-for-age',
  unit: 'cm',
  points: [
    { month: 0, p2: 46.1, median: 49.9, p98: 53.7 },
    { month: 1, p2: 50.8, median: 54.7, p98: 58.6 },
    { month: 2, p2: 54.4, median: 58.4, p98: 62.4 },
    { month: 3, p2: 57.3, median: 61.4, p98: 65.5 },
    { month: 4, p2: 59.7, median: 63.9, p98: 68.0 },
    { month: 5, p2: 61.7, median: 65.9, p98: 70.1 },
    { month: 6, p2: 63.3, median: 67.6, p98: 71.9 },
    { month: 7, p2: 64.8, median: 69.2, p98: 73.5 },
    { month: 8, p2: 66.2, median: 70.6, p98: 75.0 },
    { month: 9, p2: 67.5, median: 72.0, p98: 76.5 },
    { month: 10, p2: 68.7, median: 73.3, p98: 77.9 },
    { month: 11, p2: 69.9, median: 74.5, p98: 79.2 },
    { month: 12, p2: 71.0, median: 75.7, p98: 80.5 },
    { month: 15, p2: 74.1, median: 79.1, p98: 84.2 },
    { month: 18, p2: 76.9, median: 82.3, p98: 87.7 },
    { month: 21, p2: 79.4, median: 85.1, p98: 90.9 },
    { month: 24, p2: 81.7, median: 87.8, p98: 93.9 }
  ]
};

// Weight-for-age, boys — kilograms.
export const weightForAgeBoys: GrowthStandard = {
  metric: 'weight',
  label: 'Weight-for-age',
  unit: 'kg',
  points: [
    { month: 0, p2: 2.5, median: 3.3, p98: 4.4 },
    { month: 1, p2: 3.4, median: 4.5, p98: 5.8 },
    { month: 2, p2: 4.3, median: 5.6, p98: 7.1 },
    { month: 3, p2: 5.0, median: 6.4, p98: 8.0 },
    { month: 4, p2: 5.6, median: 7.0, p98: 8.7 },
    { month: 5, p2: 6.0, median: 7.5, p98: 9.3 },
    { month: 6, p2: 6.4, median: 7.9, p98: 9.8 },
    { month: 7, p2: 6.7, median: 8.3, p98: 10.3 },
    { month: 8, p2: 6.9, median: 8.6, p98: 10.7 },
    { month: 9, p2: 7.1, median: 8.9, p98: 11.0 },
    { month: 10, p2: 7.4, median: 9.2, p98: 11.4 },
    { month: 11, p2: 7.6, median: 9.4, p98: 11.7 },
    { month: 12, p2: 7.7, median: 9.6, p98: 12.0 },
    { month: 15, p2: 8.3, median: 10.3, p98: 12.8 },
    { month: 18, p2: 8.8, median: 10.9, p98: 13.7 },
    { month: 21, p2: 9.2, median: 11.5, p98: 14.5 },
    { month: 24, p2: 9.7, median: 12.2, p98: 15.3 }
  ]
};

// Head circumference-for-age, boys — centimetres.
export const headForAgeBoys: GrowthStandard = {
  metric: 'head',
  label: 'Head circumference-for-age',
  unit: 'cm',
  points: [
    { month: 0, p2: 31.9, median: 34.5, p98: 37.0 },
    { month: 1, p2: 34.9, median: 37.3, p98: 39.6 },
    { month: 2, p2: 36.8, median: 39.1, p98: 41.5 },
    { month: 3, p2: 38.1, median: 40.5, p98: 42.9 },
    { month: 4, p2: 39.2, median: 41.6, p98: 44.0 },
    { month: 5, p2: 40.1, median: 42.6, p98: 45.0 },
    { month: 6, p2: 40.9, median: 43.3, p98: 45.8 },
    { month: 7, p2: 41.5, median: 44.0, p98: 46.4 },
    { month: 8, p2: 42.0, median: 44.5, p98: 47.0 },
    { month: 9, p2: 42.5, median: 45.0, p98: 47.5 },
    { month: 10, p2: 42.9, median: 45.4, p98: 47.9 },
    { month: 11, p2: 43.2, median: 45.8, p98: 48.3 },
    { month: 12, p2: 43.5, median: 46.1, p98: 48.6 },
    { month: 15, p2: 44.2, median: 46.8, p98: 49.5 },
    { month: 18, p2: 44.7, median: 47.4, p98: 50.0 },
    { month: 21, p2: 45.1, median: 47.9, p98: 50.6 },
    { month: 24, p2: 45.5, median: 48.3, p98: 51.0 }
  ]
};

export const boyGrowthStandards: Record<GrowthMetric, GrowthStandard> = {
  head: headForAgeBoys,
  length: lengthForAgeBoys,
  weight: weightForAgeBoys
};
