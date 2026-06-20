import { render, screen } from '@testing-library/react';
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
        id: 'bottle-1',
        startedAt: '2026-09-02T12:00:00.000Z',
        syncState: 'local',
        type: 'bottle',
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

    render(<Dashboard events={events} profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))} todayKey="2026-09-02" onAdd={onAdd} />);

    expect(screen.getByText(/Theo Roche/i)).toBeInTheDocument();
    expect(screen.getByText(/days until due date/i)).toBeInTheDocument();
    expect(screen.getByText(/1 feeds · 1 diapers/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /diaper/i }));
    expect(onAdd).toHaveBeenCalledWith('diaper');
  });
});
