import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createDefaultBabyProfile } from '../domain/dates';
import type { BirthEvent } from '../domain/types';
import { Timeline } from './Timeline';

const birth: BirthEvent = {
  babyId: 'avery-example',
  createdAt: '2026-09-02T06:30:00.000Z',
  headCircumferenceIn: 13.5,
  id: 'birth-1',
  lengthIn: 20,
  startedAt: '2026-09-02T06:30:00.000Z',
  type: 'birth',
  updatedAt: '2026-09-02T06:30:00.000Z',
  weightOz: 116
};

describe('Timeline units', () => {
  it('lists American weights as pounds and ounces by default', () => {
    render(<Timeline events={[birth]} profile={createDefaultBabyProfile()} />);

    expect(screen.getByText(/7 lb 4 oz/)).toBeInTheDocument();
    expect(screen.getByText(/20 in/)).toBeInTheDocument();
  });

  it('lists metric measurements when selected', () => {
    const profile = {
      ...createDefaultBabyProfile(),
      preferredUnits: { system: 'metric', weightDisplay: 'pounds-ounces' } as const
    };

    render(<Timeline events={[birth]} profile={profile} />);

    expect(screen.getByText(/3.29 kg/)).toBeInTheDocument();
    expect(screen.getByText(/50.8 cm/)).toBeInTheDocument();
  });
});

it('orders Home and Reports timelines by event time rather than stored row order', () => {
  const older = { ...birth, id:'older', startedAt:'2026-09-01T10:00:00Z' };
  const newer = { ...birth, id:'newer', startedAt:'2026-09-03T10:00:00Z' };
  const { container } = render(<Timeline events={[older, newer, birth]} />);
  expect([...container.querySelectorAll('time')].map(time => time.getAttribute('datetime')))
    .toEqual([newer.startedAt, birth.startedAt, older.startedAt]);
});
