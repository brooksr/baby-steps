import { Check, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';
import { fromDateTimeInputValue, formatClock, formatShortDate, toDateTimeInputValue } from '../domain/dates';
import { getCaregivers, getCaregiverName } from '../domain/family';
import { getDoneTasks, getTaskCounts, groupTasks } from '../domain/tasks';
import type { BabyProfile, TaskItem } from '../domain/types';
import type { TaskItemInput } from '../storage/store';

interface TodosProps {
  tasks: TaskItem[];
  /** Everyone tracked, so a task can be put on one of the parents. */
  profiles?: BabyProfile[];
  /** Who is on screen — what a new task is stamped as created by. */
  profile?: BabyProfile;
  onSave: (input: TaskItemInput) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

const RECENT_DONE = 10;

/** A due date reads as a day, and only shows a time when one was set. */
function formatDue(dueAt: string) {
  const at = new Date(dueAt);
  const midnight = at.getHours() === 0 && at.getMinutes() === 0;

  return midnight ? formatShortDate(dueAt) : `${formatShortDate(dueAt)} · ${formatClock(dueAt)}`;
}

/**
 * The shared to-do list. Most of what a household owes itself has no deadline,
 * so a task is open-ended unless someone gives it a date — see `domain/tasks.ts`
 * for why that is the default rather than a missing field.
 */
export function Todos({ onRemove, onSave, profile, profiles = [], tasks }: TodosProps) {
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAllDone, setShowAllDone] = useState(false);

  const caregivers = useMemo(() => getCaregivers(profiles), [profiles]);
  const groups = useMemo(() => groupTasks(tasks), [tasks]);
  const done = useMemo(() => getDoneTasks(tasks), [tasks]);
  const counts = useMemo(() => getTaskCounts(tasks), [tasks]);
  const editingTask = tasks.find((task) => task.id === editingId);

  function resetForm() {
    setAssigneeId('');
    setDueAt('');
    setEditingId(null);
    setTitle('');
  }

  function startEditing(task: TaskItem) {
    setAssigneeId(task.assigneeId ?? '');
    setDueAt(task.dueAt ? toDateTimeInputValue(task.dueAt) : '');
    setEditingId(task.id);
    setTitle(task.title);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();

    if (!trimmed) {
      return;
    }

    const input: TaskItemInput = {
      assigneeId: assigneeId || undefined,
      // Open-ended when the date box is empty, which is most of the time.
      dueAt: dueAt ? fromDateTimeInputValue(dueAt) : undefined,
      id: editingTask?.id,
      status: editingTask?.status ?? 'open',
      title: trimmed
    };

    if (!editingTask) {
      input.createdBy = profile?.id;
    }

    await onSave(input);
    resetForm();
  }

  return (
    <main className="view-stack">
      <section className="section-block">
        <div className="section-heading wrap">
          <div>
            <h1>To-do</h1>
            <span>
              {counts.open} open
              {counts.overdue > 0 ? ` · ${counts.overdue} overdue` : ''}
              {counts.today > 0 ? ` · ${counts.today} today` : ''}
            </span>
          </div>
        </div>

        <form className="list-add wrap" onSubmit={handleSubmit}>
          <label className="list-add-field wide">
            <span className="visually-hidden">Task</span>
            <input
              autoFocus={Boolean(editingTask)}
              placeholder="What needs doing?"
              value={title}
              onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="list-add-field">
            Due <small>optional</small>
            <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
          </label>
          {caregivers.length > 0 && (
            <label className="list-add-field">
              For
              <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                <option value="">Anyone</option>
                {caregivers.map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </label>
          )}
          <button className="primary-button" type="submit" disabled={!title.trim()}>
            {editingTask ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
            <span>{editingTask ? 'Save task' : 'Add'}</span>
          </button>
          {editingTask && (
            <button className="secondary-button" type="button" onClick={resetForm}>
              <X aria-hidden="true" />
              <span>Cancel</span>
            </button>
          )}
        </form>

        <p className="field-note">
          A task with no date is not late — it just needs doing. Give one a date only when it actually has to happen
          then, and leave it on "Anyone" unless it is really one person's job.
        </p>
      </section>

      {groups.length === 0 ? (
        <section className="section-block">
          <p className="empty-state">Nothing open. Add the next thing either of you needs to remember.</p>
        </section>
      ) : (
        groups.map((group) => (
          <section className="section-block" key={group.bucket}>
            <div className="section-heading">
              <h2>{group.label}</h2>
              <span>{group.tasks.length}</span>
            </div>
            <ul className="check-list">
              {group.tasks.map((task) => {
                const assignee = getCaregiverName(profiles, task.assigneeId);
                const detail = [task.dueAt ? formatDue(task.dueAt) : null, assignee ?? null, task.notes ?? null]
                  .filter(Boolean)
                  .join(' · ');

                return (
                  <li className={group.bucket === 'overdue' ? 'check-row overdue' : 'check-row'} key={task.id}>
                    <button
                      className="check-box"
                      type="button"
                      aria-label={`Mark ${task.title} done`}
                      onClick={() => onSave({ completedAt: new Date().toISOString(), id: task.id, status: 'done' })}
                    >
                      <Check aria-hidden="true" />
                    </button>
                    <div className="check-body">
                      <strong>{task.title}</strong>
                      <small>{detail || 'Anyone, no date'}</small>
                    </div>
                    <div className="check-actions">
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Edit ${task.title}`}
                        onClick={() => startEditing(task)}
                      >
                        <Pencil aria-hidden="true" />
                      </button>
                      <button
                        className="icon-button subtle"
                        type="button"
                        aria-label={`Delete ${task.title}`}
                        onClick={() => onRemove(task.id)}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {done.length > 0 && (
        <section className="section-block">
          <div className="section-heading">
            <h2>Done</h2>
            <span>{done.length}</span>
          </div>
          <ul className="check-list">
            {(showAllDone ? done : done.slice(0, RECENT_DONE)).map((task) => (
              <li className="check-row done" key={task.id}>
                <button
                  className="check-box"
                  type="button"
                  aria-label={`Reopen ${task.title}`}
                  onClick={() => onSave({ completedAt: undefined, id: task.id, status: 'open' })}
                >
                  <RotateCcw aria-hidden="true" />
                </button>
                <div className="check-body">
                  <strong>{task.title}</strong>
                  <small>{task.completedAt ? `done ${formatShortDate(task.completedAt)}` : 'done'}</small>
                </div>
                <div className="check-actions">
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Edit ${task.title}`}
                    onClick={() => startEditing(task)}
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button subtle"
                    type="button"
                    aria-label={`Delete ${task.title}`}
                    onClick={() => onRemove(task.id)}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {done.length > RECENT_DONE && (
            <button className="secondary-button" type="button" onClick={() => setShowAllDone((current) => !current)}>
              {showAllDone ? 'Show recent only' : `Show all ${done.length}`}
            </button>
          )}
        </section>
      )}
    </main>
  );
}
