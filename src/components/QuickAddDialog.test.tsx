import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuickAddDialog } from './QuickAddDialog';

describe('QuickAddDialog', () => {
  it('submits a bottle event payload', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<QuickAddDialog eventType="bottle" onClose={vi.fn()} onSave={onSave} />);

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
});
