import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultBabyProfile } from '../domain/dates';
import type { CareEvent } from '../domain/types';
import { Log } from './Log';

function note(startedAt: string, title: string): CareEvent {
  return {
    babyId: 'theo-roche',
    createdAt: startedAt,
    id: title,
    startedAt,
    syncState: 'synced',
    title,
    type: 'note',
    updatedAt: startedAt
  } as CareEvent;
}

// Local wall-clock times, since the range filter works on local calendar days.
const events = [note('2026-09-10T09:00:00', 'Recent note'), note('2026-06-01T09:00:00', 'Old note')];

function renderLog() {
  return render(
    <Log
      events={events}
      firstYearEvents={events}
      profile={createDefaultBabyProfile(new Date('2026-06-19T12:00:00.000Z'))}
      onAdd={vi.fn()}
      onDelete={vi.fn()}
      onEdit={vi.fn()}
    />
  );
}

// Scoped, because the Log's own All/First year control also has an "All".
function allTimeChip() {
  return within(screen.getByLabelText('Log date range presets')).getByRole('button', { name: 'All time' });
}

describe('Log date range', () => {
  it('shows everything until a range is chosen', () => {
    renderLog();

    expect(screen.getByText('Recent note')).toBeInTheDocument();
    expect(screen.getByText('Old note')).toBeInTheDocument();
    expect(allTimeChip()).toHaveAttribute('aria-pressed', 'true');
  });

  it('narrows the timeline to entries inside the range', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.type(screen.getByLabelText('From'), '2026-09-01');
    await user.type(screen.getByLabelText('To'), '2026-09-30');

    expect(screen.getByText('Recent note')).toBeInTheDocument();
    expect(screen.queryByText('Old note')).not.toBeInTheDocument();
  });

  // A range that matches nothing is a filtered result, not an empty log.
  it('explains an empty result as a filter miss', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.type(screen.getByLabelText('From'), '2026-01-01');
    await user.type(screen.getByLabelText('To'), '2026-01-31');

    expect(screen.getByText('No matching entries.')).toBeInTheDocument();
  });

  it('restores the full log from the All time preset', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.type(screen.getByLabelText('From'), '2026-09-01');
    expect(screen.queryByText('Old note')).not.toBeInTheDocument();

    await user.click(allTimeChip());
    expect(screen.getByText('Old note')).toBeInTheDocument();
  });
});
