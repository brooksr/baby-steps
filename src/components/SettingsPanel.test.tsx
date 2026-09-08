import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultBabyProfile } from '../domain/dates';
import { SettingsPanel } from './SettingsPanel';

describe('SettingsPanel', () => {
  it('saves preferred units and defaults to American pounds and ounces', async () => {
    const user = userEvent.setup();
    const onSaveProfile = vi.fn().mockResolvedValue(undefined);

    render(
      <SettingsPanel
        events={[]}
        profile={createDefaultBabyProfile()}
        storeStatus={null}
        theme="light"
        onConnectSheet={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        onOpenLearn={vi.fn()}
        onSaveProfile={onSaveProfile}
        onThemeChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText(/preferred units/i)).toHaveValue('american');
    expect(screen.getByLabelText(/weight display/i)).toHaveValue('pounds-ounces');

    await user.selectOptions(screen.getByLabelText(/preferred units/i), 'metric');
    expect(screen.getByLabelText(/weight display/i)).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /save profile/i }));

    expect(onSaveProfile).toHaveBeenCalledWith(expect.objectContaining({
      preferredUnits: { system: 'metric', weightDisplay: 'pounds-ounces' }
    }));
  });
});
