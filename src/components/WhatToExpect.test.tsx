import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { BabyProfile } from '../domain/types';
import { WhatToExpect } from './WhatToExpect';

function profileOf(overrides: Partial<BabyProfile> = {}): BabyProfile {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    dueDate: '2026-09-01',
    id: 'avery-example',
    name: 'Avery Example',
    timezone: 'America/Los_Angeles',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

const card = () => screen.getByRole('region', { name: /what to expect/i });

describe('WhatToExpect', () => {
  it('reads the pregnancy by gestational week before the birth', () => {
    render(<WhatToExpect profile={profileOf()} now={new Date('2026-08-04T12:00:00')} />);

    expect(screen.getByText('Week 36')).toBeInTheDocument();
    expect(within(card()).getByText(/28 days to go/i)).toBeInTheDocument();
    expect(within(card()).getByText(/Romaine/)).toBeInTheDocument();
    expect(within(card()).getByText(/About the size of/i)).toBeInTheDocument();
  });

  it('switches to the day of life once the birth is logged', () => {
    const profile = profileOf({ birthDate: '2026-09-01', gender: 'boy' });
    render(<WhatToExpect profile={profile} now={new Date('2026-09-03T12:00:00')} />);

    expect(screen.getByText('Day 3')).toBeInTheDocument();
    expect(within(card()).getByText(/Milk usually comes in/i)).toBeInTheDocument();
    expect(within(card()).getByText('Feeding')).toBeInTheDocument();
    expect(within(card()).getByText('Sleep')).toBeInTheDocument();
  });

  it('names the baby and uses his pronouns', () => {
    const profile = profileOf({ birthDate: '2026-09-01', gender: 'boy' });
    render(<WhatToExpect profile={profile} now={new Date('2026-09-17T12:00:00')} />);

    expect(within(card()).getByText(/Avery holds his head up/i)).toBeInTheDocument();
  });

  // Avery: born 34w2d, 40 days early. Past the newborn window the card has to
  // say which age it is reading, or the reader compares against the wrong week.
  it('explains the corrected age it is reading for a preterm baby', () => {
    const profile = profileOf({ birthDate: '2026-07-23', dueDate: '2026-09-01', gender: 'boy' });
    render(<WhatToExpect profile={profile} now={new Date('2026-11-20T12:00:00')} />);

    expect(within(card()).getByText('At corrected age')).toBeInTheDocument();
    expect(within(card()).getByText('34w2d')).toBeInTheDocument();
    expect(within(card()).getByText(/40 days early/i)).toBeInTheDocument();
    expect(within(card()).getByText(/corrected age of 80 days/i)).toBeInTheDocument();
    expect(within(card()).getByText(/actual 120 days/i)).toBeInTheDocument();
  });

  // Between the newborn window and corrected age catching up, the card is held
  // at day 28 and reading at neither age. It has to say which.
  it('says when it is holding at the newborn window', () => {
    const profile = profileOf({ birthDate: '2026-07-23', dueDate: '2026-09-01', gender: 'boy' });
    render(<WhatToExpect profile={profile} now={new Date('2026-09-25T12:00:00')} />);

    expect(within(card()).getByText(/Corrected age is 24 days/i)).toBeInTheDocument();
    expect(within(card()).getByText(/end of the newborn window/i)).toBeInTheDocument();
  });

  it('adds the preterm notes and leaves out the term ones', () => {
    const profile = profileOf({ birthDate: '2026-07-23', dueDate: '2026-09-01', gender: 'boy' });
    render(<WhatToExpect profile={profile} now={new Date('2026-07-26T12:00:00')} />);

    expect(within(card()).getByText(/Late preterm babies/i)).toBeInTheDocument();
  });

  it('says so past two years rather than inventing guidance', () => {
    const profile = profileOf({ birthDate: '2026-09-01', dueDate: '2026-09-01', gender: 'boy' });
    render(<WhatToExpect profile={profile} now={new Date('2028-10-01T12:00:00')} />);

    expect(within(card()).getByText(/written through age two/i)).toBeInTheDocument();
    expect(screen.queryByText('Feeding')).not.toBeInTheDocument();
  });

  it('renders nothing when the due date is too far out to have copy', () => {
    const { container } = render(<WhatToExpect profile={profileOf()} now={new Date('2025-12-01T12:00:00')} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('always points back at the pediatrician', () => {
    render(<WhatToExpect profile={profileOf({ birthDate: '2026-09-01' })} now={new Date('2026-09-03T12:00:00')} />);
    expect(within(card()).getByText(/pediatrician/i)).toBeInTheDocument();
  });

  it('can collapse and expand the information', async () => {
    const user = userEvent.setup();
    render(<WhatToExpect profile={profileOf({ birthDate: '2026-09-01' })} now={new Date('2026-09-03T12:00:00')} />);

    await user.click(screen.getByRole('button', { name: 'Collapse what to expect' }));
    expect(within(card()).queryByText('Day 3')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand what to expect' }));
    expect(within(card()).getByText('Day 3')).toBeInTheDocument();
  });

  it('browses to adjacent advice and returns to today', async () => {
    const user = userEvent.setup();
    render(<WhatToExpect profile={profileOf({ birthDate: '2026-09-01' })} now={new Date('2026-09-03T12:00:00')} />);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(within(card()).getByText('Day 4')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(within(card()).getByText('Day 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(within(card()).getByText('Day 3')).toBeInTheDocument();
    expect(card().querySelector('.expect-card-heading .expect-navigation')).toBeInTheDocument();
  });
});
