import { getLocalDateKey } from './dates';
import type { TaskItem } from './types';

/**
 * The shared to-do list. A task is a job the household needs done, and the only
 * thing that makes one different from another is whether it has a date.
 *
 * **A task with no `dueAt` is not late.** Most of what a household owes itself
 * has no deadline, and inventing one turns a list of jobs into a calendar full
 * of things that are already overdue — so open-ended is the default, and the
 * undated tasks sort after the dated ones rather than being flagged.
 */

export type TaskBucket = 'overdue' | 'today' | 'upcoming' | 'someday';

export const taskBucketLabels: Record<TaskBucket, string> = {
  overdue: 'Overdue',
  someday: 'No date',
  today: 'Today',
  upcoming: 'Coming up'
};

export function isOpen(task: TaskItem): boolean {
  return task.status === 'open';
}

/**
 * Which pile a task is in. Read against the local day, not the clock: a task
 * due at 9am is not overdue at 10am, it is due today — nobody wants a list that
 * turns red over the course of a morning.
 */
export function getTaskBucket(task: TaskItem, now = new Date()): TaskBucket {
  if (!task.dueAt) {
    return 'someday';
  }

  const dueKey = getLocalDateKey(task.dueAt);
  const todayKey = getLocalDateKey(now);

  if (dueKey < todayKey) {
    return 'overdue';
  }

  return dueKey === todayKey ? 'today' : 'upcoming';
}

/** Soonest first, undated last, alphabetical within a tie. */
export function sortTasks(tasks: TaskItem[]): TaskItem[] {
  return [...tasks].sort((left, right) => {
    if (left.dueAt && right.dueAt) {
      return left.dueAt.localeCompare(right.dueAt) || left.title.localeCompare(right.title);
    }

    if (left.dueAt || right.dueAt) {
      return left.dueAt ? -1 : 1;
    }

    return left.title.localeCompare(right.title);
  });
}

export interface TaskGroup {
  bucket: TaskBucket;
  label: string;
  tasks: TaskItem[];
}

const BUCKET_ORDER: TaskBucket[] = ['overdue', 'today', 'upcoming', 'someday'];

/** The open tasks in piles, empty ones dropped. */
export function groupTasks(tasks: TaskItem[], now = new Date()): TaskGroup[] {
  const open = sortTasks(tasks.filter(isOpen));

  return BUCKET_ORDER.map((bucket) => ({
    bucket,
    label: taskBucketLabels[bucket],
    tasks: open.filter((task) => getTaskBucket(task, now) === bucket)
  })).filter((group) => group.tasks.length > 0);
}

/** Done, most recently finished first. */
export function getDoneTasks(tasks: TaskItem[]): TaskItem[] {
  return tasks
    .filter((task) => task.status === 'done')
    .sort((left, right) => (right.completedAt ?? right.updatedAt).localeCompare(left.completedAt ?? left.updatedAt));
}

export interface TaskCounts {
  open: number;
  overdue: number;
  today: number;
  done: number;
}

export function getTaskCounts(tasks: TaskItem[], now = new Date()): TaskCounts {
  const open = tasks.filter(isOpen);

  return {
    done: tasks.length - open.length,
    open: open.length,
    overdue: open.filter((task) => getTaskBucket(task, now) === 'overdue').length,
    today: open.filter((task) => getTaskBucket(task, now) === 'today').length
  };
}

/**
 * The tasks on one person, plus the ones on nobody. An unassigned task is
 * anyone's — it is never quietly charged to whoever happens to be looking, the
 * way an unattributed entry is never charged to whoever is asking.
 */
export function getTasksFor(tasks: TaskItem[], profileId: string): TaskItem[] {
  return tasks.filter((task) => task.assigneeId === profileId || !task.assigneeId);
}
