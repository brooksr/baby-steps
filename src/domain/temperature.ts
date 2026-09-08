import { classifyTemperatureC } from './reference';
import type { MeasurementSystem } from './types';

export function celsiusToFahrenheit(celsius: number) {
  return celsius * (9 / 5) + 32;
}

export function fahrenheitToCelsius(fahrenheit: number) {
  return (fahrenheit - 32) * (5 / 9);
}

/** Format a canonical Celsius reading in the profile's preferred unit. */
export function formatTemperature(celsius: number, system: MeasurementSystem = 'american') {
  const band = classifyTemperatureC(celsius);
  const reading = system === 'metric'
    ? `${celsius.toFixed(1)}°C`
    : `${celsiusToFahrenheit(celsius).toFixed(1)}°F`;

  return `${reading}${band ? ` · ${band.band}` : ''}`;
}
