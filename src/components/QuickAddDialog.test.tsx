import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFamilyProfile } from '../domain/family';
import { createDefaultBabyProfile, getLocalDateKey } from '../domain/dates';
import type { FeedEvent } from '../domain/types';
import { QuickAddDialog } from './QuickAddDialog';

describe('QuickAddDialog', () => {
  // A parent's own input. The free-text box says what it was; the tags say what
  // it counts as, and the tags are the half a later association pass can group.
  it('submits an input with its food-group tags', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<QuickAddDialog activeTimers={{}} eventType="intake" onClose={vi.fn()} onSave={onSave} onTimerStart={vi.fn()} onTimerStop={vi.fn()} />);

    await user.type(screen.getByLabelText(/what you ate/i), 'Bean chili');
    await user.click(screen.getByRole('button', { name: /beans & legumes/i }));
    await user.click(screen.getByRole('button', { name: /^spicy food$/i }));
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        items: 'Bean chili',
        kind: 'food',
        portion: 'medium',
        tags: ['legumes', 'spicy'],
        type: 'intake'
      })
    );
  });

  // A portion describes a plate and a volume a glass; neither belongs on the
  // other, so switching kind must not leave the one that does not apply behind.
  it('sends a drink its volume and no portion', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<QuickAddDialog activeTimers={{}} eventType="intake" onClose={vi.fn()} onSave={onSave} onTimerStart={vi.fn()} onTimerStop={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: /drink/i }));
    await user.type(screen.getByLabelText(/ounces/i), '12');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ amountOz: 12, kind: 'drink', portion: undefined, type: 'intake' })
    );
  });

  // A quick button that already says "Poo" must not then ask what kind it was.
  it('opens an output on the kind the button named', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <QuickAddDialog
        activeTimers={{}}
        eventType="output"
        onClose={vi.fn()}
        onSave={onSave}
        onTimerStart={vi.fn()}
        onTimerStop={vi.fn()}
        presetKind="poo" />
    );

    await user.selectOptions(screen.getByLabelText(/severity/i), '4');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ bristol: 4, color: 'normal', kind: 'poo', severity: 4, type: 'output' })
    );
  });

  // Only a stool has a consistency or a color. Carrying either on a burp would
  // put a field in the row that nothing could ever mean anything by.
  it('leaves the stool fields off an output that has none', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <QuickAddDialog
        activeTimers={{}}
        eventType="output"
        onClose={vi.fn()}
        onSave={onSave}
        onTimerStart={vi.fn()}
        onTimerStop={vi.fn()}
        presetKind="burp" />
    );

    expect(screen.queryByLabelText(/consistency/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ bristol: undefined, color: undefined, kind: 'burp', type: 'output' })
    );
  });

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

  it('records a poop size for dirty diapers', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<QuickAddDialog activeTimers={{}} eventType="diaper" onClose={vi.fn()} onSave={onSave} onTimerStart={vi.fn()} onTimerStop={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/type/i), 'dirty');
    expect(screen.getByRole('radio', { name: /medium/i })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: /large/i }));
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ color: 'normal', kind: 'dirty', poopSize: 'large', type: 'diaper' }));
  });

  it('leaves a wet diaper with neither a color nor a size', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<QuickAddDialog activeTimers={{}} eventType="diaper" onClose={vi.fn()} onSave={onSave} onTimerStart={vi.fn()} onTimerStop={vi.fn()} />);

    expect(screen.queryByLabelText(/color/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ color: undefined, kind: 'wet', poopSize: undefined, type: 'diaper' }));
  });

  it('flags black stool only once the first week is past', async () => {
    const user = userEvent.setup();
    const dayOld = { ...createDefaultBabyProfile(), birthDate: getLocalDateKey(new Date()) };
    const monthOld = { ...createDefaultBabyProfile(), birthDate: getLocalDateKey(new Date(Date.now() - 30 * 24 * 60 * 60_000)) };

    const { rerender } = render(
      <QuickAddDialog activeTimers={{}} eventType="diaper" onClose={vi.fn()} onSave={vi.fn()} onTimerStart={vi.fn()} onTimerStop={vi.fn()} profile={dayOld} />
    );

    await user.selectOptions(screen.getByLabelText(/type/i), 'dirty');
    await user.selectOptions(screen.getByLabelText(/color/i), 'black');
    expect(screen.getByText(/meconium/i)).not.toHaveClass('flagged');

    rerender(
      <QuickAddDialog activeTimers={{}} eventType="diaper" onClose={vi.fn()} onSave={vi.fn()} onTimerStart={vi.fn()} onTimerStop={vi.fn()} profile={monthOld} />
    );

    expect(screen.getByText(/meconium/i)).toHaveClass('flagged');
  });

  it('accepts pounds and ounces for American growth entries', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<QuickAddDialog activeTimers={{}} eventType="growth" onClose={vi.fn()} onSave={onSave} onTimerStart={vi.fn()} onTimerStop={vi.fn()} />);

    await user.type(screen.getByLabelText(/weight lb/i), '7');
    await user.type(screen.getByLabelText(/weight oz/i), '4');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: 'growth', weightOz: 116 }));
  });

  it('converts metric volume entry to canonical ounces', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const profile = {
      ...createDefaultBabyProfile(),
      preferredUnits: { system: 'metric', weightDisplay: 'pounds-ounces' } as const
    };

    render(<QuickAddDialog activeTimers={{}} eventType="feed" profile={profile} onClose={vi.fn()} onSave={onSave} onTimerStart={vi.fn()} onTimerStop={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: /bottle/i }));
    await user.clear(screen.getByLabelText(/milliliters/i));
    await user.type(screen.getByLabelText(/milliliters/i), '120');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave.mock.calls[0][0].amountOz).toBeCloseTo(4.06, 2);
  });

  describe('who logged it', () => {
    const baby = createDefaultBabyProfile();
    const mom = createFamilyProfile({ kind: 'parent', name: 'Sara Roche', parentRole: 'mom' }, [baby]);
    const dad = createFamilyProfile({ kind: 'parent', name: 'Brooks Roche', parentRole: 'dad' }, [baby, mom]);

    beforeEach(() => {
      localStorage.clear();
    });

    it('records the caregiver and remembers them for the next entry', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { unmount } = render(
        <QuickAddDialog
          activeTimers={{}}
          eventType="diaper"
          profile={baby}
          profiles={[baby, mom, dad]}
          onClose={vi.fn()}
          onSave={onSave}
          onTimerStart={vi.fn()}
          onTimerStop={vi.fn()}
        />
      );

      await user.selectOptions(screen.getByLabelText(/logged by/i), dad.id);
      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ caregiverId: dad.id, type: 'diaper' }));
      unmount();

      // A phone belongs to one person: the next entry opens on the same one.
      render(
        <QuickAddDialog
          activeTimers={{}}
          eventType="diaper"
          profile={baby}
          profiles={[baby, mom, dad]}
          onClose={vi.fn()}
          onSave={vi.fn()}
          onTimerStart={vi.fn()}
          onTimerStop={vi.fn()}
        />
      );

      expect(screen.getByLabelText(/logged by/i)).toHaveValue(dad.id);
    });

    it('saves no caregiver when none is picked', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);

      render(
        <QuickAddDialog
          activeTimers={{}}
          eventType="diaper"
          profile={baby}
          profiles={[baby, mom]}
          onClose={vi.fn()}
          onSave={onSave}
          onTimerStart={vi.fn()}
          onTimerStop={vi.fn()}
        />
      );

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ caregiverId: undefined }));
    });

    // A parent logging their own sleep is not doing it for someone else.
    it('does not ask on a parent\'s own entry', () => {
      render(
        <QuickAddDialog
          activeTimers={{}}
          eventType="sleep"
          profile={mom}
          profiles={[baby, mom, dad]}
          onClose={vi.fn()}
          onSave={vi.fn()}
          onTimerStart={vi.fn()}
          onTimerStop={vi.fn()}
        />
      );

      expect(screen.queryByLabelText(/logged by/i)).toBeNull();
    });
  });
});
