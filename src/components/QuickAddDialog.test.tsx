import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BottleEvent } from '../domain/types';
import { QuickAddDialog } from './QuickAddDialog';

describe('QuickAddDialog', () => {
  it('submits a bottle event payload', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<QuickAddDialog activeTimers={{}} eventType="bottle" onClose={vi.fn()} onSave={onSave} onTimerStart={vi.fn()} onTimerStop={vi.fn()} />);

    await user.clear(screen.getByLabelText(/ounces/i));
    await user.type(screen.getByLabelText(/ounces/i), '3.5');
    await user.selectOptions(screen.getByLabelText(/contents/i), 'formula');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        amountOz: 3.5,
        contents: 'formula',
        type: 'bottle'
      })
    );
  });

  it('prefills an existing entry and submits the edited values', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const existing: BottleEvent = {
      amountOz: 4,
      babyId: 'theo-roche',
      contents: 'formula',
      createdAt: '2026-08-01T12:00:00.000Z',
      id: 'event_1',
      notes: 'Half asleep',
      startedAt: '2026-08-01T12:00:00.000Z',
      type: 'bottle',
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

    expect(screen.getByRole('heading', { name: /edit bottle/i })).toBeInTheDocument();
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
        notes: 'Half asleep',
        type: 'bottle'
      })
    );
  });
});
