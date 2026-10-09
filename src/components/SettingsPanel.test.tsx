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
    onArchiveProfile: vi.fn().mockResolvedValue(undefined),
    onRestoreProfile: vi.fn().mockResolvedValue(undefined),
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
    await user.type(screen.getByLabelText(/child's name/i), 'Riley Example');
    await user.type(screen.getAllByLabelText(/due date/i)[1], '2028-03-04');
    await user.click(screen.getByRole('button', { name: /^add child$/i }));

    expect(onAddChild).toHaveBeenCalledWith(
      expect.objectContaining({
        dueDate: '2028-03-04',
        name: 'Riley Example',
        preferredUnits: { system: 'american', weightDisplay: 'pounds-ounces' }
      })
    );
  });

  // Archiving the wrong person would be a horrible thing to do by mistake, so
  // the first tap only arms it.
  it('asks before archiving, and never offers it for an only child', async () => {
    const user = userEvent.setup();
    const onArchiveProfile = vi.fn().mockResolvedValue(undefined);
    const avery = createDefaultBabyProfile();
    const riley: BabyProfile = createFamilyProfile({ dueDate: '2028-03-04', name: 'Riley Example' }, [avery]);

    const { unmount } = renderPanel({ profile: avery, profiles: [avery] });
    expect(screen.queryByRole('button', { name: /archive/i })).toBeNull();
    unmount();

    renderPanel({ onArchiveProfile, profile: avery, profiles: [avery, riley] });

    await user.click(screen.getByRole('button', { name: 'Archive Riley Example' }));
    expect(onArchiveProfile).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm archiving Riley Example' }));
    expect(onArchiveProfile).toHaveBeenCalledWith(riley.id);
  });

  // Archiving is never a deletion: the person stays listed, with everything
  // they have, and one tap brings them back.
  it('lists an archived person with a way back', async () => {
    const user = userEvent.setup();
    const onRestoreProfile = vi.fn().mockResolvedValue(undefined);
    const avery = createDefaultBabyProfile();
    const riley: BabyProfile = {
      ...createFamilyProfile({ dueDate: '2028-03-04', name: 'Riley Example' }, [avery]),
      archivedAt: '2026-09-11T12:00:00.000Z'
    };

    renderPanel({ onRestoreProfile, profile: avery, profiles: [avery, riley] });

    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByText('every entry kept')).toBeInTheDocument();
    // An archived person cannot be archived again, only brought back.
    expect(screen.queryByRole('button', { name: /^Archive Riley/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Bring Riley Example back' }));
    expect(onRestoreProfile).toHaveBeenCalledWith(riley.id);
  });

  it('switches child from the list', async () => {
    const user = userEvent.setup();
    const onSelectChild = vi.fn().mockResolvedValue(undefined);
    const avery = createDefaultBabyProfile();
    const riley: BabyProfile = createFamilyProfile({ dueDate: '2028-03-04', name: 'Riley Example' }, [avery]);

    renderPanel({ onSelectChild, profile: avery, profiles: [avery, riley] });

    await user.click(screen.getByRole('button', { name: /^riley example/i }));
    expect(onSelectChild).toHaveBeenCalledWith(riley.id);
  });

  it('signs out from the bottom of the page', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();

    renderPanel({ onSignOut });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('has no sign-out button where there is no sign-in to forget', () => {
    renderPanel();

    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });
});
