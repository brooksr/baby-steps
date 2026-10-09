// WHO Child Growth Standards — GIRLS (0–24 months).
// Source: World Health Organization Child Growth Standards (2006).
// https://www.who.int/tools/child-growth-standards/standards
//   - Length/height-for-age (girls)
//   - Weight-for-age (girls)
//   - Head circumference-for-age (girls)
//
// The -2 SD and +2 SD bounds are computed from WHO's published LMS parameters
// (as redistributed by the CDC), the same way the boys' table reproduces WHO's
// own z-score tables. The matching spreadsheets live in src/data/reference/*.csv.

import type { GrowthMetric, GrowthStandard } from './whoBoyStandards';

// Length/height-for-age, girls — centimetres.
export const lengthForAgeGirls: GrowthStandard = {
  metric: 'length',
  label: 'Length-for-age',
  unit: 'cm',
  points: [
    { month: 0, p2: 45.4, median: 49.1, p98: 52.9 },
    { month: 1, p2: 49.8, median: 53.7, p98: 57.6 },
    { month: 2, p2: 53.0, median: 57.1, p98: 61.1 },
    { month: 3, p2: 55.6, median: 59.8, p98: 64.0 },
    { month: 4, p2: 57.8, median: 62.1, p98: 66.4 },
    { month: 5, p2: 59.6, median: 64.0, p98: 68.5 },
    { month: 6, p2: 61.2, median: 65.7, p98: 70.3 },
    { month: 7, p2: 62.7, median: 67.3, p98: 71.9 },
    { month: 8, p2: 64.0, median: 68.7, p98: 73.5 },
    { month: 9, p2: 65.3, median: 70.1, p98: 75.0 },
    { month: 10, p2: 66.5, median: 71.5, p98: 76.4 },
    { month: 11, p2: 67.7, median: 72.8, p98: 77.8 },
    { month: 12, p2: 68.9, median: 74.0, p98: 79.2 },
    { month: 15, p2: 72.0, median: 77.5, p98: 83.0 },
    { month: 18, p2: 74.9, median: 80.7, p98: 86.5 },
    { month: 21, p2: 77.5, median: 83.7, p98: 89.8 },
    { month: 24, p2: 80.0, median: 86.4, p98: 92.9 }
  ]
};

// Weight-for-age, girls — kilograms.
export const weightForAgeGirls: GrowthStandard = {
  metric: 'weight',
  label: 'Weight-for-age',
  unit: 'kg',
  points: [
    { month: 0, p2: 2.4, median: 3.2, p98: 4.2 },
    { month: 1, p2: 3.2, median: 4.2, p98: 5.5 },
    { month: 2, p2: 3.9, median: 5.1, p98: 6.6 },
    { month: 3, p2: 4.5, median: 5.8, p98: 7.5 },
    { month: 4, p2: 5.0, median: 6.4, p98: 8.2 },
    { month: 5, p2: 5.4, median: 6.9, p98: 8.8 },
    { month: 6, p2: 5.7, median: 7.3, p98: 9.3 },
    { month: 7, p2: 6.0, median: 7.6, p98: 9.8 },
    { month: 8, p2: 6.3, median: 7.9, p98: 10.2 },
    { month: 9, p2: 6.5, median: 8.2, p98: 10.5 },
    { month: 10, p2: 6.7, median: 8.5, p98: 10.9 },
    { month: 11, p2: 6.9, median: 8.7, p98: 11.2 },
    { month: 12, p2: 7.0, median: 8.9, p98: 11.5 },
    { month: 15, p2: 7.6, median: 9.6, p98: 12.4 },
    { month: 18, p2: 8.1, median: 10.2, p98: 13.2 },
    { month: 21, p2: 8.6, median: 10.9, p98: 14.0 },
    { month: 24, p2: 9.0, median: 11.5, p98: 14.8 }
  ]
};

// Head circumference-for-age, girls — centimetres.
export const headForAgeGirls: GrowthStandard = {
  metric: 'head',
  label: 'Head circumference-for-age',
  unit: 'cm',
  points: [
    { month: 0, p2: 31.5, median: 33.9, p98: 36.2 },
    { month: 1, p2: 34.2, median: 36.5, p98: 38.9 },
    { month: 2, p2: 35.8, median: 38.3, p98: 40.7 },
    { month: 3, p2: 37.1, median: 39.5, p98: 42.0 },
    { month: 4, p2: 38.1, median: 40.6, p98: 43.1 },
    { month: 5, p2: 38.9, median: 41.5, p98: 44.0 },
    { month: 6, p2: 39.6, median: 42.2, p98: 44.8 },
    { month: 7, p2: 40.2, median: 42.8, p98: 45.5 },
    { month: 8, p2: 40.7, median: 43.4, p98: 46.0 },
    { month: 9, p2: 41.2, median: 43.8, p98: 46.5 },
    { month: 10, p2: 41.5, median: 44.2, p98: 46.9 },
    { month: 11, p2: 41.9, median: 44.6, p98: 47.3 },
    { month: 12, p2: 42.2, median: 44.9, p98: 47.6 },
    { month: 15, p2: 42.9, median: 45.7, p98: 48.4 },
    { month: 18, p2: 43.5, median: 46.2, p98: 49.0 },
    { month: 21, p2: 44.0, median: 46.7, p98: 49.5 },
    { month: 24, p2: 44.4, median: 47.2, p98: 50.0 }
  ]
};

export const girlGrowthStandards: Record<GrowthMetric, GrowthStandard> = {
  head: headForAgeGirls,
  length: lengthForAgeGirls,
  weight: weightForAgeGirls
};
