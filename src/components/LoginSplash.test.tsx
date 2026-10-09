import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultBabyProfile } from '../domain/dates';
import { storeEmergencyChild } from '../domain/family';
import { LoginSplash } from './LoginSplash';

function renderSplash(props: { emergencyOpen?: boolean; restoring?: boolean; sessionExpired?: boolean; onEmergencyChange?: (open: boolean) => void; onSignOut?: () => void }) {
  return render(
    <LoginSplash
      emergencyOpen={props.emergencyOpen ?? false}
      error=""
      loading={false}
      restoring={props.restoring ?? false}
      sessionExpired={props.sessionExpired ?? false}
      storeStatus={null}
      onContinue={vi.fn()}
      onEmergencyChange={props.onEmergencyChange ?? vi.fn()}
      onOffline={vi.fn()}
      onSignOut={props.onSignOut}
    />
  );
}

describe('LoginSplash emergency', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('offers Emergency on both the sign-in and the welcome-back screens', async () => {
    const onEmergencyChange = vi.fn();
    const { unmount } = renderSplash({ onEmergencyChange });
    await userEvent.click(screen.getByRole('button', { name: 'Emergency' }));
    expect(onEmergencyChange).toHaveBeenCalledWith(true);
    unmount();

    renderSplash({ restoring: true });
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Emergency' })).toBeInTheDocument();
  });

  it('shows the guide for the remembered child, with no sign-in', async () => {
    const birth = new Date(Date.now() - 500 * 24 * 60 * 60 * 1000);
    storeEmergencyChild({ ...createDefaultBabyProfile(), birthDate: birth.toISOString(), name: 'Avery Example' });
    const onEmergencyChange = vi.fn();

    renderSplash({ emergencyOpen: true, onEmergencyChange });

    expect(screen.getByRole('link', { name: /Call 911/ })).toHaveAttribute('href', 'tel:911');
    expect(screen.getByText(/Tailored to Avery/)).toBeInTheDocument();
    expect(screen.getByText(/^5 abdominal thrusts/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onEmergencyChange).toHaveBeenCalledWith(false);
  });
});

describe('LoginSplash sign out', () => {
  it('lets a stuck reconnect sign out and try another account', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();

    renderSplash({ onSignOut, sessionExpired: true });

    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('has nothing to sign out of on a first sign-in', () => {
    renderSplash({ onSignOut: vi.fn() });

    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();
  });
});
