import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultBabyProfile } from '../domain/dates';
import type { BabyProfile } from '../domain/types';
import { Care } from './Care';

function renderCare(profile: BabyProfile) {
  return render(<Care events={[]} profile={profile} profiles={[profile]} onEdit={vi.fn()} onSaveProfile={vi.fn()} onToggle={vi.fn()} />);
}

function bornDaysAgo(days: number): BabyProfile {
  const birth = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { ...createDefaultBabyProfile(), birthDate: birth.toISOString(), name: 'Avery Example' };
}

describe('Care tabs', () => {
  it('shows one section at a time', async () => {
    renderCare(bornDaysAgo(60));

    expect(screen.queryByRole('heading', { name: 'Milestones' })).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: 'Milestones' }));
    expect(screen.getByRole('heading', { name: 'Milestones' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Vaccinations' })).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: 'Vaccines' }));
    expect(screen.getByRole('heading', { name: 'Vaccinations' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Vaccines' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens the emergency guide on the child’s own age group', async () => {
    renderCare(bornDaysAgo(60));
    await userEvent.click(screen.getByRole('tab', { name: 'Emergency' }));

    expect(screen.getByRole('link', { name: /Call 911/ })).toHaveAttribute('href', 'tel:911');
    expect(screen.getByText(/Tailored to Avery/)).toBeInTheDocument();
    expect(screen.getByText(/^5 chest thrusts/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '1 year +' }));
    expect(screen.getByText(/^5 abdominal thrusts/)).toBeInTheDocument();
    expect(screen.getByText(/not Avery's age/)).toBeInTheDocument();
  });

  it('switches to child technique after the first birthday', async () => {
    renderCare(bornDaysAgo(500));
    await userEvent.click(screen.getByRole('tab', { name: 'Emergency' }));

    expect(screen.getByRole('button', { name: '1 year +' })).toHaveClass('active');
    expect(screen.getByText(/^5 abdominal thrusts/)).toBeInTheDocument();
  });
});

describe('Care in the caregiver view', () => {
  it('offers only Key info and Emergency, and Key info is read-only', () => {
    const profile = bornDaysAgo(60);
    render(<Care caregiverView events={[]} profile={profile} profiles={[profile]} onEdit={vi.fn()} onSaveProfile={vi.fn()} onToggle={vi.fn()} />);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Key info', 'Emergency']);
    expect(screen.queryByRole('button', { name: 'Edit care info' })).toBeNull();
  });
});
