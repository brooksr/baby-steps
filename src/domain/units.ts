import type { BabyProfile, MeasurementSystem, PreferredUnits } from './types';

const CENTIMETERS_PER_INCH = 2.54;
const KILOGRAMS_PER_OUNCE = 0.028349523125;
const MILLILITERS_PER_FLUID_OUNCE = 29.5735295625;
const OUNCES_PER_POUND = 16;

export const DEFAULT_PREFERRED_UNITS: PreferredUnits = {
  system: 'american',
  weightDisplay: 'pounds-ounces'
};

function formatNumber(value: number, maximumFractionDigits: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

export function centimetersToInches(centimeters: number) {
  return centimeters / CENTIMETERS_PER_INCH;
}

export function formatLength(inches: number, system: MeasurementSystem) {
  return system === 'metric'
    ? `${formatNumber(inchesToCentimeters(inches), 1)} cm`
    : `${formatNumber(inches, 1)} in`;
}

export function formatVolume(ounces: number, system: MeasurementSystem) {
  return system === 'metric'
    ? `${formatNumber(ouncesToMilliliters(ounces), 0)} mL`
    : `${formatNumber(ounces, 2)} oz`;
}

export function formatWeight(ounces: number, preferredUnits: PreferredUnits) {
  if (preferredUnits.system === 'metric') {
    return `${formatNumber(ouncesToKilograms(ounces), 2)} kg`;
  }

  if (preferredUnits.weightDisplay === 'ounces') {
    return `${formatNumber(ounces, 1)} oz`;
  }

  const roundedOunces = Math.round(ounces * 10) / 10;
  const pounds = Math.floor(roundedOunces / OUNCES_PER_POUND);
  const remainder = roundedOunces - pounds * OUNCES_PER_POUND;

  if (pounds === 0) {
    return `${formatNumber(remainder, 1)} oz`;
  }

  return remainder === 0
    ? `${pounds} lb`
    : `${pounds} lb ${formatNumber(remainder, 1)} oz`;
}

export function getPreferredUnits(profile?: Pick<BabyProfile, 'preferredUnits'> | null): PreferredUnits {
  const preferredUnits = profile?.preferredUnits;

  return {
    system: preferredUnits?.system === 'metric' ? 'metric' : 'american',
    weightDisplay: preferredUnits?.weightDisplay === 'ounces' ? 'ounces' : 'pounds-ounces'
  };
}

export function inchesToCentimeters(inches: number) {
  return inches * CENTIMETERS_PER_INCH;
}

export function kilogramsToOunces(kilograms: number) {
  return kilograms / KILOGRAMS_PER_OUNCE;
}

export function millilitersToOunces(milliliters: number) {
  return milliliters / MILLILITERS_PER_FLUID_OUNCE;
}

export function ouncesToKilograms(ounces: number) {
  return ounces * KILOGRAMS_PER_OUNCE;
}

export function ouncesToMilliliters(ounces: number) {
  return ounces * MILLILITERS_PER_FLUID_OUNCE;
}

export function toStoredLength(value: number, system: MeasurementSystem) {
  return system === 'metric' ? centimetersToInches(value) : value;
}

export function toStoredVolume(value: number, system: MeasurementSystem) {
  return system === 'metric' ? millilitersToOunces(value) : value;
}

export function toStoredWeight(value: number, system: MeasurementSystem) {
  return system === 'metric' ? kilogramsToOunces(value) : value;
}

export function toUnitLength(inches: number, system: MeasurementSystem) {
  return system === 'metric' ? inchesToCentimeters(inches) : inches;
}

export function toUnitVolume(ounces: number, system: MeasurementSystem) {
  return system === 'metric' ? ouncesToMilliliters(ounces) : ounces;
}

export function toUnitWeight(ounces: number, system: MeasurementSystem) {
  return system === 'metric' ? ouncesToKilograms(ounces) : ounces;
}
