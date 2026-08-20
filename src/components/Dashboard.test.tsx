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
        babyId: 'theo-roche',
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
        babyId: 'theo-roche',
        createdAt: '2026-09-02T13:00:00.000Z',
        id: 'diaper-1',
        kind: 'wet',
        startedAt: '2026-09-02T13:00:00.000Z',
        syncState: 'local',
        type: 'diaper',
        updatedAt: '2026-09-02T13:00:00.000Z'
      }
    ];

    render(<Dashboard activeTimers={{}} events={events} profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))} todayKey="2026-09-02" onAdd={onAdd} />);

    expect(screen.getByText(/Theo Roche/i)).toBeInTheDocument();
    expect(screen.getByText(/days until due date/i)).toBeInTheDocument();
    expect(screen.getByText(/1 feeds · 1 diapers/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /diaper/i }));
    expect(onAdd).toHaveBeenCalledWith('diaper');
  });

  it('shows when the last bath was', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const events: CareEvent[] = [
      {
        babyId: 'theo-roche',
        createdAt: '2026-09-01T02:00:00.000Z',
        id: 'bath-1',
        startedAt: '2026-09-01T02:00:00.000Z',
        syncState: 'local',
        type: 'bath',
        updatedAt: '2026-09-01T02:00:00.000Z'
      }
    ];

    render(<Dashboard activeTimers={{}} events={events} profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))} todayKey="2026-09-02" onAdd={onAdd} />);

    // The relative wording ("Yesterday", "3 days ago") is pinned to a fixed
    // clock in dates.test.ts; here it just has to stop saying nothing is logged.
    const status = within(screen.getByLabelText('Current status'));
    expect(status.getByText(/Last bath/i)).toBeInTheDocument();
    expect(status.queryByText(/Nothing logged yet/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /bath/i }));
    expect(onAdd).toHaveBeenCalledWith('bath');
  });

  it('reports no bath when none is logged', () => {
    render(<Dashboard activeTimers={{}} events={[]} profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))} todayKey="2026-09-02" onAdd={vi.fn()} />);

    const status = within(screen.getByLabelText('Current status'));
    expect(status.getByText('None')).toBeInTheDocument();
    expect(status.getByText(/Nothing logged yet/i)).toBeInTheDocument();
  });

  it('predicts the next diaper once there are enough changes to go on', () => {
    // The prediction reads the wall clock, so the log is built backwards from it.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));

    const events: CareEvent[] = Array.from({ length: 8 }, (_, index) => ({
      babyId: 'theo-roche',
      createdAt: '2026-09-02T12:00:00.000Z',
      id: `diaper-${index}`,
      kind: 'wet' as const,
      startedAt: new Date(Date.now() - 60 * 60_000 - (7 - index) * 3 * 60 * 60_000).toISOString(),
      syncState: 'local' as const,
      type: 'diaper' as const,
      updatedAt: '2026-09-02T12:00:00.000Z'
    }));

    render(<Dashboard activeTimers={{}} events={events} profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))} todayKey="2026-09-02" onAdd={vi.fn()} />);

    const prediction = within(screen.getByLabelText('Next diaper'));
    expect(prediction.getByText(/Next diaper in 2h · likely wet/i)).toBeInTheDocument();
    expect(prediction.getByText(/Typical 3h between changes/i)).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('headlines a simplified age after birth, with the exact days below it', () => {
    vi.useFakeTimers();
    // Local, not UTC: the age anchors on the local calendar day of birth.
    vi.setSystemTime(new Date('2026-09-16T13:00:00'));

    const profile = { ...createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z')), birthDate: '2026-09-02' };

    render(<Dashboard activeTimers={{}} events={[]} profile={profile} todayKey="2026-09-16" onAdd={vi.fn()} />);

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
        babyId: 'theo-roche',
        createdAt: '2026-09-10T12:00:00.000Z',
        id: 'feed-1',
        method: 'nursing',
        startedAt: new Date(Date.now() - 4 * 60 * 60_000).toISOString(),
        syncState: 'local',
        type: 'feed',
        updatedAt: '2026-09-10T12:00:00.000Z'
      },
      {
        babyId: 'theo-roche',
        createdAt: '2026-09-10T12:00:00.000Z',
        id: 'bath-1',
        startedAt: new Date(Date.now() - 5 * 24 * 60 * 60_000).toISOString(),
        syncState: 'local',
        type: 'bath',
        updatedAt: '2026-09-10T12:00:00.000Z'
      }
    ];

    render(<Dashboard activeTimers={{}} events={events} profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))} todayKey="2026-09-10" onAdd={vi.fn()} />);

    const reminders = within(screen.getByLabelText('Gentle reminders'));
    expect(reminders.getByText('Last feed was 4h ago')).toBeInTheDocument();
    expect(reminders.getByText('Last bath was 5 days ago')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('stays quiet about the next diaper without enough history', () => {
    render(<Dashboard activeTimers={{}} events={[]} profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))} todayKey="2026-09-02" onAdd={vi.fn()} />);

    expect(screen.queryByLabelText('Next diaper')).not.toBeInTheDocument();
  });
});
