import { describe, expect, it } from 'vitest';
import { celsiusToFahrenheit, fahrenheitToCelsius, formatTemperature } from './temperature';

describe('temperature', () => {
  it('round-trips between units', () => {
    expect(celsiusToFahrenheit(37)).toBeCloseTo(98.6, 1);
    expect(fahrenheitToCelsius(98.6)).toBeCloseTo(37, 1);
  });

  it('labels a normal reading', () => {
    expect(formatTemperature(37)).toContain('Normal');
    expect(formatTemperature(37)).toContain('98.6°F');
  });

  it('labels a fever reading', () => {
    expect(formatTemperature(38.5)).toContain('Fever');
  });
});
