import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createFamilyProfile } from '../domain/family';
import { createDefaultBabyProfile } from '../domain/dates';
import type { BabyProfile } from '../domain/types';
import { KeyInfo } from './KeyInfo';

const legacyGuardians = [
  { name: 'Morgan Smith Example', phone: '5550101000' },
  { name: 'Jordan Example', phone: '5550102000' }
];

function baby(careInfo = {}): BabyProfile {
  return { ...createDefaultBabyProfile(), careInfo };
}

describe('KeyInfo guardians', () => {
  it('lists the parent profiles, with their role and phone', () => {
    const avery = baby({ guardians: legacyGuardians });
    const mom = createFamilyProfile({ kind: 'parent', name: 'Casey Example', parentRole: 'mom', phone: '5550101000' }, [avery]);

    render(<KeyInfo profile={avery} profiles={[avery, mom]} onSave={vi.fn()} />);

    expect(screen.getByText('Casey Example · Mom')).toBeInTheDocument();
    // The parent profiles win: the old careInfo list is not shown alongside them.
    expect(screen.queryByText('Morgan Smith Example')).toBeNull();
  });

  // A household that has not added parents yet must not lose the numbers it had.
  it('falls back to the stored guardian list when there are no parents', () => {
    const avery = baby({ guardians: legacyGuardians });

    render(<KeyInfo profile={avery} profiles={[avery]} onSave={vi.fn()} />);

    expect(screen.getByText('Morgan Smith Example')).toBeInTheDocument();
    expect(screen.getByText('Jordan Example')).toBeInTheDocument();
  });

  // The form stopped editing guardians, but an old list is still someone's
  // stored data — saving the rest of the card must not quietly delete it.
  it('carries a stored guardian list through a save untouched', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const avery = baby({ guardians: legacyGuardians, homeAddress: '123 Example Street' });

    render(<KeyInfo profile={avery} profiles={[avery]} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: /edit care info/i }));
    await user.click(screen.getByRole('button', { name: /save care info/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ careInfo: expect.objectContaining({ guardians: legacyGuardians }) })
    );
  });
});
