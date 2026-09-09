import { describe, expect, it } from 'vitest';
import { getCheckupSpan } from './checkup';
import type { CareEvent } from './types';

const NOW = new Date('2026-09-30T12:00:00');

function growth(startedAt: string, weightOz?: number, lengthIn?: number): CareEvent {
  return {
    babyId: 'theo-roche',
    createdAt: startedAt,
    id: startedAt,
    lengthIn,
    startedAt,
    type: 'growth',
    updatedAt: startedAt,
    weightOz
  } as CareEvent;
}

function birth(startedAt: string, weightOz: number): CareEvent {
  return {
    babyId: 'theo-roche',
    createdAt: startedAt,
    id: `birth-${startedAt}`,
    startedAt,
    type: 'birth',
    updatedAt: startedAt,
    weightOz
  } as CareEvent;
}

describe('check-up span', () => {
  it('runs from the latest measurement through today', () => {
    const span = getCheckupSpan([growth('2026-09-01T09:00:00', 130), growth('2026-09-24T09:00:00', 148, 21)], NOW);

    expect(span?.range).toEqual({ from: '2026-09-24', to: '2026-09-30' });
    expect(span?.days).toBe(7);
    expect(span?.anchor).toMatchObject({ dateKey: '2026-09-24', lengthIn: 21, type: 'growth', weightOz: 148 });
  });

  // The hospital weigh-in is the first appointment, so it anchors the first span.
  it('falls back to birth when no growth entry exists', () => {
    expect(getCheckupSpan([birth('2026-09-10T02:00:00', 120)], NOW)?.anchor.type).toBe('birth');
  });

  it('ignores rows carrying no measurement', () => {
    const span = getCheckupSpan([growth('2026-09-01T09:00:00', 130), growth('2026-09-24T09:00:00')], NOW);

    expect(span?.range.from).toBe('2026-09-01');
  });

  // A visit penciled in for next week must not collapse the span to nothing.
  it('ignores a measurement dated ahead of today', () => {
    const span = getCheckupSpan([growth('2026-09-01T09:00:00', 130), growth('2026-10-05T09:00:00', 150)], NOW);

    expect(span?.range).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('returns null until something has been measured', () => {
    expect(getCheckupSpan([], NOW)).toBeNull();
  });
});
