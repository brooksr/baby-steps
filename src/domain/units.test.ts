import { describe, expect, it } from 'vitest';
import { formatLength, formatVolume, formatWeight, getPreferredUnits, toStoredLength, toStoredVolume, toStoredWeight, toUnitLength, toUnitVolume, toUnitWeight } from './units';

describe('preferred units', () => {
  it('defaults to American units with pounds and ounces', () => {
    expect(getPreferredUnits()).toEqual({ system: 'american', weightDisplay: 'pounds-ounces' });
    expect(formatWeight(116, getPreferredUnits())).toBe('7 lb 4 oz');
  });

  it('supports an ounces-only weight display', () => {
    expect(formatWeight(116, { system: 'american', weightDisplay: 'ounces' })).toBe('116 oz');
  });

  it('formats metric measurements from canonical values', () => {
    expect(formatLength(20, 'metric')).toBe('50.8 cm');
    expect(formatVolume(4, 'metric')).toBe('118 mL');
    expect(formatWeight(116, { system: 'metric', weightDisplay: 'pounds-ounces' })).toBe('3.29 kg');
  });

  it('round-trips values used by measurement forms', () => {
    expect(toStoredLength(toUnitLength(20, 'metric'), 'metric')).toBeCloseTo(20);
    expect(toStoredVolume(toUnitVolume(4, 'metric'), 'metric')).toBeCloseTo(4);
    expect(toStoredWeight(toUnitWeight(116, 'metric'), 'metric')).toBeCloseTo(116);
  });
});
