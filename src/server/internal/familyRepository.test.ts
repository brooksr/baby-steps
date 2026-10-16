// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyProfile, TaskItem } from '../../domain/types';
import { openInternalDatabase } from './database';
import { createFamilyRepository, FamilyRepositoryError, type TaskMutation } from './familyRepository';

const timestamp = '2026-10-16T12:00:00.000Z';
const task: TaskItem = { createdAt: timestamp, id: 'task', status: 'open', title: 'Buy nappies', updatedAt: timestamp };
let database: ReturnType<typeof openInternalDatabase>;

function profile(familyId: string, id: string, kind: BabyProfile['kind']): BabyProfile {
  return { createdAt: timestamp, familyId, id, kind, name: `${id} Example`, timezone: 'America/Los_Angeles', updatedAt: timestamp };
}
function insertProfile(familyId: string, id: string, kind: BabyProfile['kind']) {
  database.prepare('INSERT INTO profiles VALUES (?, ?, ?, 1)').run(familyId, id, JSON.stringify(profile(familyId, id, kind)));
}
function repository(familyId = 'family-a', accountId = 'account-a') {
  return createFamilyRepository(database, familyId, { accountId, sessionId: 'server-verified' }, () => timestamp);
}
function save(operationId = 'op-1', expectedRevision = 0, input = task): TaskMutation {
  return { expectedRevision, kind: 'save', operationId, task: input };
}
function expectCode(work: () => unknown, code: FamilyRepositoryError['code']) {
  try { work(); expect.fail(`Expected ${code}`); } catch (error) {
    expect(error).toBeInstanceOf(FamilyRepositoryError);
    expect((error as FamilyRepositoryError).code).toBe(code);
  }
}

beforeEach(() => {
  database = openInternalDatabase(':memory:');
  for (const suffix of ['a', 'b']) {
    database.prepare('INSERT INTO accounts VALUES (?, ?, NULL)').run(`account-${suffix}`, timestamp);
    database.prepare('INSERT INTO families VALUES (?, ?, NULL)').run(`family-${suffix}`, timestamp);
    insertProfile(`family-${suffix}`, 'parent', 'parent');
    insertProfile(`family-${suffix}`, 'baby', 'child');
    database.prepare('INSERT INTO memberships VALUES (?, ?, ?, ?, ?, NULL)')
      .run(`family-${suffix}`, `account-${suffix}`, 'parent', 'parent', timestamp);
  }
});
afterEach(() => database.close());

describe('family-scoped SQLite repository first slice', () => {
  it('reads one family and migrates legacy events on read without changing stored payloads', () => {
    const legacy = { babyId: 'baby', createdAt: timestamp, id: 'old-feed', startedAt: timestamp, type: 'breastfeed', updatedAt: timestamp };
    database.prepare("INSERT INTO records VALUES (?, 'events', ?, ?, 1, NULL)").run('family-a', legacy.id, JSON.stringify(legacy));
    repository('family-b', 'account-b').mutateTask(save());
    const snap = repository().snapshot({ babyId: 'baby' });
    expect(snap.tasks).toEqual([]);
    expect(snap.events[0]).toMatchObject({ method: 'nursing', type: 'feed' });
    expect(snap.childEvents).toBeUndefined();
    expect(repository().snapshot({ babyId: 'parent' }).childEvents).toHaveLength(1);
    expect(repository().exportData().profiles).toHaveLength(2);
    expect(JSON.parse(String(database.prepare("SELECT payload FROM records WHERE family_id = 'family-a'").get()!.payload)).type).toBe('breastfeed');
  });

  it('authorizes on every operation, including retries and already-constructed repositories', () => {
    const repo = repository();
    repo.mutateTask(save());
    expectCode(() => repository('family-b').exportData(), 'forbidden');
    database.exec("UPDATE memberships SET revoked_at = 'now' WHERE family_id = 'family-a'");
    expectCode(() => repo.snapshot(), 'forbidden');
    expectCode(() => repo.mutateTask(save()), 'forbidden');
    expectCode(() => repo.changes(), 'forbidden');
  });

  it('denies caregiver full exports, disabled accounts and archived actors', () => {
    database.exec("UPDATE memberships SET role = 'caregiver' WHERE family_id = 'family-a'");
    database.prepare("UPDATE profiles SET payload = ? WHERE family_id = 'family-a' AND id = 'parent'")
      .run(JSON.stringify(profile('family-a', 'parent', 'caregiver')));
    expectCode(() => repository().exportData(), 'forbidden');
    database.exec("UPDATE memberships SET role = 'parent' WHERE family_id = 'family-a'");
    database.prepare("UPDATE profiles SET payload = ? WHERE family_id = 'family-a' AND id = 'parent'")
      .run(JSON.stringify({ ...profile('family-a', 'parent', 'parent'), archivedAt: timestamp }));
    expectCode(() => repository().exportData(), 'forbidden');
    database.exec("UPDATE accounts SET disabled_at = 'now' WHERE id = 'account-b'");
    expectCode(() => repository('family-b', 'account-b').snapshot(), 'forbidden');
  });

  it('deduplicates canonical JSON retries and rejects changed requests or actors', () => {
    const repo = repository();
    const first = repo.mutateTask(save());
    const reordered = { task, operationId: 'op-1', kind: 'save', expectedRevision: 0 } as const;
    expect(repo.mutateTask(reordered)).toEqual(first);
    expect(database.prepare('SELECT COUNT(*) AS n FROM changes').get()!.n).toBe(1);
    expectCode(() => repo.mutateTask(save('op-1', 0, { ...task, title: 'Different' })), 'conflict');
    database.exec("INSERT INTO accounts VALUES ('second-account', 'now', NULL)");
    insertProfile('family-a', 'second-parent', 'parent');
    database.exec("INSERT INTO memberships VALUES ('family-a', 'second-account', 'second-parent', 'parent', 'now', NULL)");
    expectCode(() => repository('family-a', 'second-account').mutateTask(save()), 'conflict');
  });

  it('checks revisions and family scope and preserves tombstones', () => {
    const a = repository();
    const b = repository('family-b', 'account-b');
    a.mutateTask(save());
    b.mutateTask(save('op-1', 0, { ...task, title: 'Family B only' }));
    expectCode(() => a.mutateTask(save('stale')), 'conflict');
    expect(a.mutateTask(save('edit', 1, { ...task, title: 'Updated' })).revision).toBe(2);
    const removed = a.mutateTask({ expectedRevision: 2, id: task.id, kind: 'remove', operationId: 'remove' });
    expect(removed).toMatchObject({ deletedAt: timestamp, revision: 3 });
    expect(a.snapshot().tasks).toEqual([]);
    expect(b.snapshot().tasks[0].title).toBe('Family B only');
    expect(a.mutateTask({ expectedRevision: 2, id: task.id, kind: 'remove', operationId: 'remove' })).toEqual(removed);
    expectCode(() => a.mutateTask(save('resurrect', 3)), 'not-found');
    expect(a.changes().changes[2]).toMatchObject({ deletedAt: timestamp, id: task.id, revision: 3 });
  });

  it('uses server attribution and validates assignees and task input', () => {
    const repo = repository();
    const result = repo.mutateTask(save('valid', 0, { ...task, createdAt: 'spoofed', createdBy: 'someone-else' }));
    expect(result.task).toMatchObject({ createdAt: timestamp, createdBy: 'parent', syncState: 'synced' });
    insertProfile('family-b', 'foreign-assignee', 'caregiver');
    expectCode(() => repo.mutateTask(save('bad-assignee', 1, { ...task, assigneeId: 'foreign-assignee' })), 'invalid');
    expectCode(() => repo.mutateTask(save('bad-title', 1, { ...task, title: '' })), 'invalid');
    expectCode(() => repo.mutateTask(save('bad-date', 1, { ...task, dueAt: 'tomorrow-ish' })), 'invalid');
    expectCode(() => repo.mutateTask(save('fractional', 0.5)), 'invalid');
    expect(repo.snapshot().tasks).toHaveLength(1);
  });

  it('rolls back data, changes and receipt if the final receipt insert fails', () => {
    database.exec("CREATE TRIGGER test_receipt_failure BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    expect(() => repository().mutateTask(save())).toThrow('test failure');
    for (const table of ['records', 'changes', 'operations']) {
      expect(database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n).toBe(0);
    }
    database.exec('DROP TRIGGER test_receipt_failure');
    expect(repository().mutateTask(save()).revision).toBe(1);
  });

  it('pins pagination to a high-water mark and sees later writes on the next poll', () => {
    const repo = repository();
    repo.mutateTask(save('first', 0));
    repo.mutateTask(save('second', 1));
    repository('family-b', 'account-b').mutateTask(save());
    const first = repo.changes(undefined, 1);
    expect(first.hasMore).toBe(true);
    repo.mutateTask(save('third', 2));
    const second = repo.changes(first.cursor, 1);
    expect(second.hasMore).toBe(false);
    expect(second.changes[0].revision).toBe(2);
    const nextPoll = repo.changes(second.cursor);
    expect(nextPoll.changes.map((row) => row.revision)).toEqual([3]);
    expectCode(() => repo.changes({ ...first.cursor, familyId: 'family-b' }), 'invalid');
    expectCode(() => repo.changes({ after: -1, familyId: 'family-a' }), 'invalid');
    expectCode(() => repo.changes(undefined, 0), 'invalid');
  });
});
