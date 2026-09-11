import { describe, expect, it } from 'vitest';
import { getTaskBucket, getTaskCounts, groupTasks } from './tasks';
import type { TaskItem } from './types';

function task(overrides: Partial<TaskItem>): TaskItem {
  return {
    createdAt: '2026-09-11T12:00:00.000Z',
    id: 'task_1',
    status: 'open',
    title: 'Task',
    updatedAt: '2026-09-11T12:00:00.000Z',
    ...overrides
  };
}

describe('shared tasks', () => {
  const now = new Date(2026, 8, 11, 14, 0);

  it('keeps an open-ended task out of overdue', () => {
    expect(getTaskBucket(task({ dueAt: undefined }), now)).toBe('someday');
  });

  it('uses the local due day rather than the due time', () => {
    expect(getTaskBucket(task({ dueAt: new Date(2026, 8, 11, 8, 0).toISOString() }), now)).toBe('today');
    expect(getTaskBucket(task({ dueAt: new Date(2026, 8, 10, 23, 0).toISOString() }), now)).toBe('overdue');
  });

  it('groups only open work and reports completed work separately', () => {
    const tasks = [
      task({ id: 'today', dueAt: new Date(2026, 8, 11, 9, 0).toISOString() }),
      task({ id: 'someday', title: 'Organize closet' }),
      task({ id: 'done', status: 'done', title: 'Wash bottles' })
    ];

    expect(groupTasks(tasks, now).map((group) => group.bucket)).toEqual(['today', 'someday']);
    expect(getTaskCounts(tasks, now)).toEqual({ done: 1, open: 2, overdue: 0, today: 1 });
  });
});
