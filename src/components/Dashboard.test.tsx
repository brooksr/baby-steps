import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultBabyProfile } from '../domain/dates';
import type { CareEvent } from '../domain/types';
import { Dashboard } from './Dashboard';

describe('Dashboard', () => {
  it('renders current summary and opens quick-add actions', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const events: CareEvent[] = [
      {
        babyId: 'avery-example',
        contents: 'breastmilk',
        amountOz: 2,
        createdAt: '2026-09-02T12:00:00.000Z',
        id: 'feed-1',
        method: 'bottle',
        startedAt: '2026-09-02T12:00:00.000Z',
        syncState: 'local',
        type: 'feed',
        updatedAt: '2026-09-02T12:00:00.000Z'
      },
      {
        babyId: 'avery-example',
        createdAt: '2026-09-02T13:00:00.000Z',
        id: 'diaper-1',
        kind: 'wet',
        startedAt: '2026-09-02T13:00:00.000Z',
        syncState: 'local',
        type: 'diaper',
        updatedAt: '2026-09-02T13:00:00.000Z'
      }
    ];

    render(<Dashboard activeTimers={{}} events={events} profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))} todayKey="2026-09-02" onAdd={onAdd} onOpenLog={vi.fn()} />);

    expect(screen.getByText(/^Baby$/i)).toBeInTheDocument();
    expect(screen.getByText(/Add a due date or birth date in Settings/i)).toBeInTheDocument();
    expect(screen.getByText(/1 feeds · 1 diapers/i)).toBeInTheDocument();
    const today = within(screen.getByLabelText('Today summary'));
    expect(today.getByText('Sleep')).toBeInTheDocument();
    expect(today.getByText('Milk out')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Diaper' }));
    expect(onAdd).toHaveBeenCalledWith('diaper');
  });

  it('shows when the last bath was', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const events: CareEvent[] = [
      {
        babyId: 'avery-example',
        createdAt: '2026-09-01T02:00:00.000Z',
        id: 'bath-1',
        startedAt: '2026-09-01T02:00:00.000Z',
        syncState: 'local',
        type: 'bath',
        updatedAt: '2026-09-01T02:00:00.000Z'
      }
    ];

    const onOpenLog = vi.fn();
    render(<Dashboard activeTimers={{}} events={events} profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))} todayKey="2026-09-02" onAdd={onAdd} onOpenLog={onOpenLog} />);

    // The relative wording ("Yesterday", "3 days ago") is pinned to a fixed
    // clock in dates.test.ts; here it just has to stop saying nothing is logged.
    const bath = within(screen.getByRole('button', { name: 'View bath log' }));
    expect(bath.getByText(/Last bath/i)).toBeInTheDocument();
    expect(bath.queryByText(/Nothing logged yet/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View bath log' }));
    expect(onOpenLog).toHaveBeenCalledWith('bath');

    await user.click(screen.getByRole('button', { name: 'Bath' }));
    expect(onAdd).toHaveBeenCalledWith('bath');
  });

  it('reports no bath when none is logged', () => {
    render(<Dashboard activeTimers={{}} events={[]} profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))} todayKey="2026-09-02" onAdd={vi.fn()} onOpenLog={vi.fn()} />);

    const bath = within(screen.getByRole('button', { name: 'View bath log' }));
    expect(bath.getByText('None')).toBeInTheDocument();
    expect(bath.getByText(/Nothing logged yet/i)).toBeInTheDocument();
  });

  it('opens the exact log type from each recent-event tile', async () => {
    const user = userEvent.setup();
    const onOpenLog = vi.fn();

    render(<Dashboard activeTimers={{}} events={[]} profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))} todayKey="2026-09-02" onAdd={vi.fn()} onOpenLog={onOpenLog} />);

    await user.click(screen.getByRole('button', { name: 'View feed log' }));
    await user.click(screen.getByRole('button', { name: 'View diaper log' }));
    await user.click(screen.getByRole('button', { name: 'View bath log' }));

    expect(onOpenLog.mock.calls).toEqual([['feed'], ['diaper'], ['bath']]);
  });

  it('predicts the next diaper once there are enough changes to go on', () => {
    // The prediction reads the wall clock, so the log is built backwards from it.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));

    const events: CareEvent[] = Array.from({ length: 8 }, (_, index) => ({
      babyId: 'avery-example',
      createdAt: '2026-09-02T12:00:00.000Z',
      id: `diaper-${index}`,
      kind: 'wet' as const,
      startedAt: new Date(Date.now() - 60 * 60_000 - (7 - index) * 3 * 60 * 60_000).toISOString(),
      syncState: 'local' as const,
      type: 'diaper' as const,
      updatedAt: '2026-09-02T12:00:00.000Z'
    }));

    render(<Dashboard activeTimers={{}} events={events} profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))} todayKey="2026-09-02" onAdd={vi.fn()} onOpenLog={vi.fn()} />);

    const prediction = within(screen.getByRole('button', { name: 'View diaper log' }));
    // Gaps of exactly 3h give the narrowest window, ±15 minutes around 7:00.
    expect(prediction.getByText('Next ~6:45–7:15 AM · wet')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('warns on the Last Diaper tile once its estimate has passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));
    const events: CareEvent[] = Array.from({ length: 8 }, (_, index) => ({
      babyId: 'avery-example',
      createdAt: '2026-09-02T12:00:00.000Z',
      id: `diaper-${index}`,
      kind: 'wet' as const,
      startedAt: new Date(Date.now() - 4 * 60 * 60_000 - (7 - index) * 3 * 60 * 60_000).toISOString(),
      syncState: 'local' as const,
      type: 'diaper' as const,
      updatedAt: '2026-09-02T12:00:00.000Z'
    }));

    render(<Dashboard activeTimers={{}} events={events} profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))} todayKey="2026-09-02" onAdd={vi.fn()} onOpenLog={vi.fn()} />);

    const diaper = screen.getByRole('button', { name: 'View diaper log' });
    expect(diaper).toHaveClass('past-due');
    expect(within(diaper).getByText('Likely now · wet')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('headlines a simplified age after birth, with the exact days below it', () => {
    vi.useFakeTimers();
    // Local, not UTC: the age anchors on the local calendar day of birth.
    vi.setSystemTime(new Date('2026-09-16T13:00:00'));

    const profile = { ...createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z')), birthDate: '2026-09-02' };

    render(<Dashboard activeTimers={{}} events={[]} profile={profile} todayKey="2026-09-16" onAdd={vi.fn()} onOpenLog={vi.fn()} />);

    // The old hero was a bare "14" sitting on top of "14 days old".
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('2 weeks');
    expect(screen.getByText('14 days old')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('gently flags a feed and a bath that have run past their usual rhythm', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T12:00:00.000Z'));

    const events: CareEvent[] = [
      {
        babyId: 'avery-example',
        createdAt: '2026-09-10T12:00:00.000Z',
        id: 'feed-1',
        method: 'nursing',
        startedAt: new Date(Date.now() - 4 * 60 * 60_000).toISOString(),
        syncState: 'local',
        type: 'feed',
        updatedAt: '2026-09-10T12:00:00.000Z'
      },
      {
        babyId: 'avery-example',
        createdAt: '2026-09-10T12:00:00.000Z',
        id: 'bath-1',
        startedAt: new Date(Date.now() - 5 * 24 * 60 * 60_000).toISOString(),
        syncState: 'local',
        type: 'bath',
        updatedAt: '2026-09-10T12:00:00.000Z'
      }
    ];

    render(<Dashboard activeTimers={{}} events={events} profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))} todayKey="2026-09-10" onAdd={vi.fn()} onOpenLog={vi.fn()} />);

    const reminders = within(screen.getByLabelText('Gentle reminders'));
    expect(reminders.getByText('Last feed was 4h ago')).toBeInTheDocument();
    expect(reminders.queryByText('Last bath was 5 days ago')).not.toBeInTheDocument();
    const bathButton = screen.getByRole('button', { name: 'View bath log' });
    const bath = within(bathButton);
    expect(bath.getByText('5 days')).toBeInTheDocument();
    expect(bath.getByText('Due today')).toBeInTheDocument();
    expect(bathButton).toHaveClass('past-due');

    const feed = screen.getByRole('button', { name: 'View feed log' });
    expect(feed).toHaveClass('past-due');
    expect(within(feed).getByText('Due now · either')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('shows the likely next feed time inside the Last Feed tile', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T12:00:00.000Z'));
    const events = [{
      babyId: 'avery-example',
      createdAt: '2026-09-10T11:00:00.000Z',
      id: 'feed-1',
      method: 'nursing' as const,
      side: 'both' as const,
      startedAt: '2026-09-10T11:00:00.000Z',
      syncState: 'local' as const,
      type: 'feed' as const,
      updatedAt: '2026-09-10T11:00:00.000Z'
    }];

    render(<Dashboard activeTimers={{}} events={events} profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))} todayKey="2026-09-10" onAdd={vi.fn()} onOpenLog={vi.fn()} />);

    const feed = within(screen.getByRole('button', { name: 'View feed log' }));
    // The 2–3 hour window, on the hour at both ends.
    expect(feed.getByText('Next ~6–7 AM · either')).toBeInTheDocument();
    expect(feed.queryByText(/· next:/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View feed log' })).not.toHaveClass('past-due');

    vi.useRealTimers();
  });

  it('stays quiet about the next diaper without enough history', () => {
    render(<Dashboard activeTimers={{}} events={[]} profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))} todayKey="2026-09-02" onAdd={vi.fn()} onOpenLog={vi.fn()} />);

    expect(within(screen.getByRole('button', { name: 'View diaper log' })).queryByText(/Next diaper/i)).not.toBeInTheDocument();
  });

  it('offers a caregiver only the types they may log, and no way into the Log', () => {
    render(
      <Dashboard
        activeTimers={{}}
        allowedTypes={['feed', 'diaper']}
        events={[]}
        profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))}
        todayKey="2026-09-02"
        onAdd={vi.fn()}
      />
    );

    const quickAdd = screen.getByRole('region', { name: 'Quick add' });
    expect(within(quickAdd).getAllByRole('button').map((button) => button.textContent)).toEqual(['Feed', 'Diaper']);
    expect(screen.queryByRole('button', { name: 'View feed log' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Log birth/ })).toBeNull();
  });
});
