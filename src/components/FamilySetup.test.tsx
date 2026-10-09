import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BabyProfile } from '../domain/types';
import { FamilySetup } from './FamilySetup';

const dad: BabyProfile = {
  createdAt: '2026-06-20T16:15:00.000Z',
  id: 'dad',
  kind: 'parent',
  name: 'Sam',
  syncState: 'synced',
  timezone: 'America/Los_Angeles',
  updatedAt: '2026-06-20T16:15:00.000Z'
};

function renderSetup(props: Partial<React.ComponentProps<typeof FamilySetup>> = {}) {
  const handlers = {
    onClaim: vi.fn().mockResolvedValue(undefined),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onSignOut: vi.fn()
  };
  render(<FamilySetup email="new@example.com" error="" loading={false} {...handlers} {...props} />);
  return handlers;
}

describe('FamilySetup', () => {
  it('starts a family with the parent and an optional first child', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderSetup();

    expect(screen.getByText('new@example.com')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Your name'), 'Jordan');
    await user.selectOptions(screen.getByLabelText('You are'), 'mom');
    await user.type(screen.getByLabelText(/Baby's name/), 'Robin');
    await user.click(screen.getByRole('button', { name: 'Start my family' }));

    expect(onCreate).toHaveBeenCalledWith({ childName: 'Robin', dueDate: '', parentName: 'Jordan', parentRole: 'mom' });
  });

  it('offers a claim only when the family has one to offer', async () => {
    const user = userEvent.setup();
    const { onClaim } = renderSetup({ claim: { familyId: 'sheet-a', parents: [dad] } });

    await user.click(screen.getByRole('button', { name: "I'm Sam" }));
    expect(onClaim).toHaveBeenCalledWith('sheet-a', 'dad');
  });

  it('has no claim without one, and a way out', async () => {
    const user = userEvent.setup();
    const { onSignOut } = renderSetup();

    expect(screen.queryByRole('button', { name: /I'm/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalled();
  });
});
