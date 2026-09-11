import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createFamilyProfile } from '../domain/family';
import { ShoppingList } from './ShoppingList';
import { Todos } from './Todos';

const parent = createFamilyProfile({ kind: 'parent', name: 'Brooks Roche', parentRole: 'dad' });

describe('household list pages', () => {
  it('adds a custom food item to the shopping catalogue and active list', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<ShoppingList items={[]} profile={parent} profiles={[parent]} onRemove={vi.fn()} onSave={onSave} />);

    await user.type(screen.getByPlaceholderText('Add an item'), 'Oatmeal');
    await user.click(screen.getByRole('checkbox', { name: 'Food or drink' }));
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(onSave).toHaveBeenCalledWith({
      addedBy: parent.id,
      category: 'pantry',
      isFood: true,
      name: 'Oatmeal',
      status: 'need'
    });
  });

  it('creates open-ended and scheduled shared tasks', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<Todos profile={parent} profiles={[parent]} tasks={[]} onRemove={vi.fn()} onSave={onSave} />);

    await user.type(screen.getByPlaceholderText('What needs doing?'), 'Wash bottles');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      createdBy: parent.id,
      dueAt: undefined,
      status: 'open',
      title: 'Wash bottles'
    }));

    await user.type(screen.getByPlaceholderText('What needs doing?'), 'Call pediatrician');
    await user.type(screen.getByLabelText(/Due/), '2026-09-12T09:30');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      dueAt: new Date(2026, 8, 12, 9, 30).toISOString(),
      title: 'Call pediatrician'
    }));
  });

  it('edits an existing task in the same form', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const task = {
      assigneeId: parent.id,
      createdAt: '2026-09-11T12:00:00.000Z',
      createdBy: parent.id,
      dueAt: new Date(2026, 8, 12, 9, 30).toISOString(),
      id: 'task_1',
      status: 'open' as const,
      title: 'Wash bottles',
      updatedAt: '2026-09-11T12:00:00.000Z'
    };

    render(<Todos profile={parent} profiles={[parent]} tasks={[task]} onRemove={vi.fn()} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit Wash bottles' }));
    const title = screen.getByDisplayValue('Wash bottles');
    await user.clear(title);
    await user.type(title, 'Wash bottles and pump parts');
    await user.clear(screen.getByLabelText(/Due/));
    await user.click(screen.getByRole('button', { name: 'Save task' }));

    expect(onSave).toHaveBeenCalledWith({
      assigneeId: parent.id,
      dueAt: undefined,
      id: 'task_1',
      status: 'open',
      title: 'Wash bottles and pump parts'
    });
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });
});
