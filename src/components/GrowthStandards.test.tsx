import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createDefaultBabyProfile } from '../domain/dates';
import type { BirthEvent } from '../domain/types';
import { GrowthStandards } from './GrowthStandards';

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

describe('GrowthStandards units', () => {
  it('converts WHO centimeters to inches for the American default', () => {
    const profile = { ...createDefaultBabyProfile(), birthDate: birth.startedAt };

    const { container } = render(<GrowthStandards events={[birth]} profile={profile} />);
    const tooltips = [...container.querySelectorAll('.growth-chart title')].map((title) => title.textContent);

    expect(tooltips).toEqual([
      expect.stringMatching(/^Weight 7 lb 4 oz · P\d+/),
      expect.stringMatching(/^Length 20 in · P\d+/),
      expect.stringMatching(/^Head 13.5 in · P\d+/)
    ]);
    expect(screen.getByText(/7 lb 4 oz/, { selector: '.growth-reading' })).toBeInTheDocument();
    const percentiles = screen.getAllByLabelText(/Estimated percentile P\d+/);
    expect(percentiles).toHaveLength(3);
    percentiles.forEach(percentile => expect(percentile).toBeVisible());
  });

  it('draws weight, length and head on one chart', () => {
    const profile = { ...createDefaultBabyProfile(), birthDate: birth.startedAt };

    const { container } = render(<GrowthStandards events={[birth]} profile={profile} />);

    expect(container.querySelectorAll('.growth-chart')).toHaveLength(1);
    expect([...container.querySelectorAll('.growth-series')].map((series) => series.getAttribute('data-metric'))).toEqual(['weight', 'length', 'head']);
    expect(screen.getByText('Median')).toBeInTheDocument();
  });

  it('reads weights in ounces when the profile reads weights that way', () => {
    const profile = {
      ...createDefaultBabyProfile(),
      birthDate: birth.startedAt,
      preferredUnits: { system: 'american', weightDisplay: 'ounces' } as const
    };

    render(<GrowthStandards events={[birth]} profile={profile} />);

    expect(screen.queryByText(/ lb/)).not.toBeInTheDocument();
    expect(screen.getByText(/116 oz/, { selector: '.growth-reading' })).toBeInTheDocument();
  });

  // The WHO curves are built on term births, so a preterm baby opens corrected.
  it('keeps the corrected comparison available behind closed details', async () => {
    const profile = { ...createDefaultBabyProfile(), birthDate: '2026-08-04T06:30:00.000Z', dueDate: '2026-09-01' };

    render(<GrowthStandards events={[{ ...birth, startedAt: '2026-08-04T06:30:00.000Z' }]} profile={profile} />);

    expect(screen.getByRole('button', { name: 'Corrected' })).not.toBeVisible();
    expect(screen.getByText(/corrected age subtracts/)).not.toBeVisible();
    await userEvent.click(screen.getByText('Age comparison'));
    expect(screen.getByRole('button', { name: 'Corrected' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers no age basis to correct for a term birth', () => {
    const profile = { ...createDefaultBabyProfile(), birthDate: birth.startedAt };

    render(<GrowthStandards events={[birth]} profile={profile} />);

    expect(screen.queryByRole('button', { name: 'Corrected' })).not.toBeInTheDocument();
  });

  it('keeps WHO kilograms and centimeters for metric profiles', () => {
    const profile = {
      ...createDefaultBabyProfile(),
      birthDate: birth.startedAt,
      preferredUnits: { system: 'metric', weightDisplay: 'pounds-ounces' } as const
    };

    render(<GrowthStandards events={[birth]} profile={profile} />);

    expect(screen.getAllByText(/\d cm/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\d in\b/)).not.toBeInTheDocument();
    expect(screen.getByText(/3.29 kg/, { selector: '.growth-reading' })).toBeInTheDocument();
  });
});
