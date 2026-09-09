import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createDefaultBabyProfile } from '../domain/dates';
import type { BirthEvent } from '../domain/types';
import { GrowthStandards } from './GrowthStandards';

const birth: BirthEvent = {
  babyId: 'theo-roche',
  createdAt: '2026-09-02T06:30:00.000Z',
  headCircumferenceIn: 13.5,
  id: 'birth-1',
  lengthIn: 20,
  startedAt: '2026-09-02T06:30:00.000Z',
  type: 'birth',
  updatedAt: '2026-09-02T06:30:00.000Z',
  weightOz: 116
};

describe('GrowthStandards units', () => {
  it('converts WHO centimeters to inches for the American default', () => {
    const profile = { ...createDefaultBabyProfile(), birthDate: birth.startedAt };

    render(<GrowthStandards events={[birth]} profile={profile} />);

    expect(screen.getAllByText('in')).toHaveLength(2);
    expect(screen.queryByText('cm')).not.toBeInTheDocument();
    expect(screen.getByText(/7 lb 4 oz/)).toBeInTheDocument();
    expect(screen.getByText('lb')).toBeInTheDocument();
  });

  it('labels the weight chart in ounces when the profile reads weights that way', () => {
    const profile = {
      ...createDefaultBabyProfile(),
      birthDate: birth.startedAt,
      preferredUnits: { system: 'american', weightDisplay: 'ounces' } as const
    };

    render(<GrowthStandards events={[birth]} profile={profile} />);

    expect(screen.getByText('oz')).toBeInTheDocument();
    expect(screen.queryByText('lb')).not.toBeInTheDocument();
    expect(screen.getByText(/116 oz/)).toBeInTheDocument();
  });

  // The WHO curves are built on term births, so a preterm baby opens corrected.
  it('opens on corrected age when there is gestation to correct for', () => {
    const profile = { ...createDefaultBabyProfile(), birthDate: '2026-08-04T06:30:00.000Z', dueDate: '2026-09-01' };

    render(<GrowthStandards events={[{ ...birth, startedAt: '2026-08-04T06:30:00.000Z' }]} profile={profile} />);

    expect(screen.getByRole('button', { name: 'Corrected' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers no age basis to correct for a term birth', () => {
    const profile = { ...createDefaultBabyProfile(), birthDate: birth.startedAt };

    render(<GrowthStandards events={[birth]} profile={profile} />);

    expect(screen.queryByRole('button', { name: 'Corrected' })).not.toBeInTheDocument();
  });

  it('keeps the WHO kilogram and centimeter labels for metric profiles', () => {
    const profile = {
      ...createDefaultBabyProfile(),
      birthDate: birth.startedAt,
      preferredUnits: { system: 'metric', weightDisplay: 'pounds-ounces' } as const
    };

    render(<GrowthStandards events={[birth]} profile={profile} />);

    expect(screen.getAllByText('cm')).toHaveLength(2);
    expect(screen.queryByText('in')).not.toBeInTheDocument();
    expect(screen.getByText(/3.29 kg/)).toBeInTheDocument();
  });
});
