import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FeedEvent } from '../domain/types';
import { QuickAddDialog } from './QuickAddDialog';

describe('QuickAddDialog', () => {
  it('submits a bottle feeding payload', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<QuickAddDialog activeTimers={{}} eventType="feed" onClose={vi.fn()} onSave={onSave} onTimerStart={vi.fn()} onTimerStop={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: /bottle/i }));
    await user.clear(screen.getByLabelText(/ounces/i));
    await user.type(screen.getByLabelText(/ounces/i), '3.5');
    await user.selectOptions(screen.getByLabelText(/contents/i), 'formula');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        amountOz: 3.5,
        contents: 'formula',
        method: 'bottle',
        type: 'feed'
      })
    );
  });

  it('leaves the amount off a nursing feeding', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<QuickAddDialog activeTimers={{}} eventType="feed" onClose={vi.fn()} onSave={onSave} onTimerStart={vi.fn()} onTimerStop={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/side/i), 'right');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        amountOz: undefined,
        durationMinutes: 15,
        method: 'nursing',
        side: 'right',
        type: 'feed'
      })
    );
  });

  it('accepts a feeding with neither minutes nor ounces', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<QuickAddDialog activeTimers={{}} eventType="feed" onClose={vi.fn()} onSave={onSave} onTimerStart={vi.fn()} onTimerStop={vi.fn()} />);

    await user.clear(screen.getByLabelText(/minutes/i));
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ amountOz: undefined, durationMinutes: undefined, type: 'feed' })
    );
  });

  it('prefills an existing entry and submits the edited values', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const existing: FeedEvent = {
      amountOz: 4,
      babyId: 'theo-roche',
      contents: 'formula',
      createdAt: '2026-08-01T12:00:00.000Z',
      id: 'event_1',
      method: 'bottle',
      notes: 'Half asleep',
      startedAt: '2026-08-01T12:00:00.000Z',
      type: 'feed',
      updatedAt: '2026-08-01T12:00:00.000Z'
    };

    render(
      <QuickAddDialog
        activeTimers={{}}
        editEvent={existing}
        eventType={null}
        onClose={vi.fn()}
        onSave={onSave}
        onTimerStart={vi.fn()}
        onTimerStop={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: /edit feeding/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/ounces/i)).toHaveValue(4);
    expect(screen.getByLabelText(/contents/i)).toHaveValue('formula');
    expect(screen.getByLabelText(/notes/i)).toHaveValue('Half asleep');

    await user.clear(screen.getByLabelText(/ounces/i));
    await user.type(screen.getByLabelText(/ounces/i), '5');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        amountOz: 5,
        contents: 'formula',
        method: 'bottle',
        notes: 'Half asleep',
        type: 'feed'
      })
    );
  });
});
