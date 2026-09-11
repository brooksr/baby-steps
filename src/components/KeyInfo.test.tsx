import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createFamilyProfile } from '../domain/family';
import { createDefaultBabyProfile } from '../domain/dates';
import type { BabyProfile } from '../domain/types';
import { KeyInfo } from './KeyInfo';

const legacyGuardians = [
  { name: 'Jennifer Jones Roche', phone: '8053009852' },
  { name: 'Brooks Roche', phone: '6508048261' }
];

function baby(careInfo = {}): BabyProfile {
  return { ...createDefaultBabyProfile(), careInfo };
}

describe('KeyInfo guardians', () => {
  it('lists the parent profiles, with their role and phone', () => {
    const theo = baby({ guardians: legacyGuardians });
    const mom = createFamilyProfile({ kind: 'parent', name: 'Sara Roche', parentRole: 'mom', phone: '8053009852' }, [theo]);

    render(<KeyInfo profile={theo} profiles={[theo, mom]} onSave={vi.fn()} />);

    expect(screen.getByText('Sara Roche · Mom')).toBeInTheDocument();
    // The parent profiles win: the old careInfo list is not shown alongside them.
    expect(screen.queryByText('Jennifer Jones Roche')).toBeNull();
  });

  // A household that has not added parents yet must not lose the numbers it had.
  it('falls back to the stored guardian list when there are no parents', () => {
    const theo = baby({ guardians: legacyGuardians });

    render(<KeyInfo profile={theo} profiles={[theo]} onSave={vi.fn()} />);

    expect(screen.getByText('Jennifer Jones Roche')).toBeInTheDocument();
    expect(screen.getByText('Brooks Roche')).toBeInTheDocument();
  });

  // The form stopped editing guardians, but an old list is still someone's
  // stored data — saving the rest of the card must not quietly delete it.
  it('carries a stored guardian list through a save untouched', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const theo = baby({ guardians: legacyGuardians, homeAddress: '751 Benson Way' });

    render(<KeyInfo profile={theo} profiles={[theo]} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: /edit care info/i }));
    await user.click(screen.getByRole('button', { name: /save care info/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ careInfo: expect.objectContaining({ guardians: legacyGuardians }) })
    );
  });
});
