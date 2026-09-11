import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createFamilyProfile } from '../domain/family';
import { createDefaultBabyProfile } from '../domain/dates';
import type { BabyProfile } from '../domain/types';
import { SettingsPanel } from './SettingsPanel';

function renderPanel(overrides: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) {
  const profile = overrides.profile ?? createDefaultBabyProfile();
  const props = {
    events: [],
    profile,
    profiles: [profile],
    storeStatus: null,
    theme: 'light' as const,
    onAddChild: vi.fn().mockResolvedValue(undefined),
    onApplyShifts: vi.fn().mockResolvedValue({ attributed: 0, skipped: 0, sleepsAdded: 0 }),
    onConnectSheet: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
    onOpenLearn: vi.fn(),
    onRemoveChild: vi.fn().mockResolvedValue(undefined),
    onSaveProfile: vi.fn().mockResolvedValue(undefined),
    onSelectChild: vi.fn().mockResolvedValue(undefined),
    onThemeChange: vi.fn(),
    ...overrides
  };

  return { ...render(<SettingsPanel {...props} />), props };
}

describe('SettingsPanel', () => {
  it('saves preferred units and defaults to American pounds and ounces', async () => {
    const user = userEvent.setup();
    const onSaveProfile = vi.fn().mockResolvedValue(undefined);

    renderPanel({ onSaveProfile });

    expect(screen.getByLabelText(/preferred units/i)).toHaveValue('american');
    expect(screen.getByLabelText(/weight display/i)).toHaveValue('pounds-ounces');

    await user.selectOptions(screen.getByLabelText(/preferred units/i), 'metric');
    expect(screen.getByLabelText(/weight display/i)).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /save profile/i }));

    expect(onSaveProfile).toHaveBeenCalledWith(expect.objectContaining({
      preferredUnits: { system: 'metric', weightDisplay: 'pounds-ounces' }
    }));
  });

  it('adds a sibling, carrying the household units and timezone', async () => {
    const user = userEvent.setup();
    const onAddChild = vi.fn().mockResolvedValue(undefined);

    renderPanel({ onAddChild });

    await user.click(screen.getByRole('button', { name: /add a child/i }));
    await user.type(screen.getByLabelText(/child's name/i), 'Mila Roche');
    await user.type(screen.getAllByLabelText(/due date/i)[1], '2028-03-04');
    await user.click(screen.getByRole('button', { name: /^add child$/i }));

    expect(onAddChild).toHaveBeenCalledWith(
      expect.objectContaining({
        dueDate: '2028-03-04',
        name: 'Mila Roche',
        preferredUnits: { system: 'american', weightDisplay: 'pounds-ounces' }
      })
    );
  });

  // Removing the wrong child would be a horrible thing to do by mistake, so the
  // first tap only arms it.
  it('asks before removing a child, and never offers it for an only child', async () => {
    const user = userEvent.setup();
    const onRemoveChild = vi.fn().mockResolvedValue(undefined);
    const theo = createDefaultBabyProfile();
    const mila: BabyProfile = createFamilyProfile({ dueDate: '2028-03-04', name: 'Mila Roche' }, [theo]);

    const { unmount } = renderPanel({ profile: theo, profiles: [theo] });
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
    unmount();

    renderPanel({ onRemoveChild, profile: theo, profiles: [theo, mila] });

    await user.click(screen.getByRole('button', { name: 'Remove Mila Roche' }));
    expect(onRemoveChild).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm removing Mila Roche' }));
    expect(onRemoveChild).toHaveBeenCalledWith(mila.id);
  });

  it('switches child from the list', async () => {
    const user = userEvent.setup();
    const onSelectChild = vi.fn().mockResolvedValue(undefined);
    const theo = createDefaultBabyProfile();
    const mila: BabyProfile = createFamilyProfile({ dueDate: '2028-03-04', name: 'Mila Roche' }, [theo]);

    renderPanel({ onSelectChild, profile: theo, profiles: [theo, mila] });

    await user.click(screen.getByRole('button', { name: /^mila roche/i }));
    expect(onSelectChild).toHaveBeenCalledWith(mila.id);
  });
});
