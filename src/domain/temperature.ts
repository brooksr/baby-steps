import { classifyTemperatureC } from './reference';

export function celsiusToFahrenheit(celsius: number) {
  return celsius * (9 / 5) + 32;
}

export function fahrenheitToCelsius(fahrenheit: number) {
  return (fahrenheit - 32) * (5 / 9);
}

/** Format a Celsius reading as "37.0°C / 98.6°F · Band". */
export function formatTemperature(celsius: number) {
  const band = classifyTemperatureC(celsius);
  return `${celsius.toFixed(1)}°C / ${celsiusToFahrenheit(celsius).toFixed(1)}°F${band ? ` · ${band.band}` : ''}`;
}
