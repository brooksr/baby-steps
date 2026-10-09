import type { BabyGender } from '../types';
import { boyGrowthStandards, type GrowthMetric, type GrowthStandard } from './whoBoyStandards';
import { girlGrowthStandards } from './whoGirlStandards';

/** Which of the WHO tables a profile is compared against. */
export type GrowthStandardSex = 'boys' | 'girls';

/**
 * WHO publishes boys' and girls' standards and nothing in between, so a profile
 * with no sex recorded (or `other`) stays on the boys' tables — what every
 * profile used before the girls' curves shipped. `GrowthStandards` says so on
 * the card rather than comparing silently.
 */
export function getGrowthStandardSex(gender?: BabyGender): GrowthStandardSex {
  return gender === 'girl' ? 'girls' : 'boys';
}

export function getGrowthStandards(gender?: BabyGender): Record<GrowthMetric, GrowthStandard> {
  return getGrowthStandardSex(gender) === 'girls' ? girlGrowthStandards : boyGrowthStandards;
}
