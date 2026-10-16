/// <reference types="node" />
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { CAREGIVER_EVENT_TYPES } from '../../domain/access';
import { getActiveProfiles, isChild, isParent, sortProfiles } from '../../domain/family';
import { migrateStoredEvents, type StoredCareEvent } from '../../domain/legacyEvents';
import type { BabyProfile, CareEvent, ShoppingItem, TaskItem, TrackerExport, TrackerSnapshot } from '../../domain/types';
import type { EventQuery } from '../../storage/contracts';
import { canPerformFamilyAction, resolveFamilyMembership, type FamilyAuthorizationInput } from './authorization';
import type { AccountPrincipal, FamilyMembership } from './types';

import type { BootstrapData, MutationCommand, MutationResult } from '../../domain/internalApi';
import { canonicalJson, fail, mergePatch, object, text, validId, validateDocument } from './validation';
export { InternalError as FamilyRepositoryError } from './validation';

export type TaskMutation = {
  expectedRevision: number;
  operationId: string;
} & ({ kind: 'save'; task: TaskItem } | { id: string; kind: 'remove' });

export interface TaskMutationResult {
  deletedAt?: string;
  id: string;
  revision: number;
  task: TaskItem;
}

export interface ChangeCursor {
  /** Bound to this family; clients must treat cursor contents as opaque. */
  after: number;
  familyId: string;
  through?: number;
}

/**
 * Parent repository slice, not an HTTP boundary. The caller must supply a
 * server-verified principal; a session id here is not proof of authentication.
 * Each operation re-reads account/membership/profile state in its transaction.
 * Caller owns the connection; do not share it across overlapping transactions.
 */
function timestampDay(timestamp: string, timezone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-CA',{ day:'2-digit',month:'2-digit',timeZone:timezone,year:'numeric' }).formatToParts(new Date(timestamp));
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function createFamilyRepository(database: DatabaseSync, familyId: string, principal: AccountPrincipal, now = () => new Date().toISOString()) {
  if (!validId(familyId)) fail('invalid');

  function transaction<T>(write: boolean, work: () => T, memberOnly = false): T {
    database.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try {
      authorize(memberOnly);
      const result = work();
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  function authorize(memberOnly = false) {
    const account = database.prepare('SELECT id, disabled_at FROM accounts WHERE id = ?').get(principal.accountId);
    const row = database.prepare(`SELECT m.account_id, m.profile_id, m.role, m.revoked_at, p.payload
      FROM memberships m JOIN profiles p ON p.family_id = m.family_id AND p.id = m.profile_id
      WHERE m.family_id = ? AND m.account_id = ?`).get(familyId, principal.accountId);
    const membership: FamilyMembership | undefined = row ? {
      accountId: String(row.account_id), familyId, profileId: String(row.profile_id),
      revokedAt: row.revoked_at ? String(row.revoked_at) : undefined, role: row.role as FamilyMembership['role']
    } : undefined;
    const input: FamilyAuthorizationInput = {
      account: account ? { disabledAt: account.disabled_at ? String(account.disabled_at) : undefined, id: String(account.id) } : undefined,
      actor: row ? JSON.parse(String(row.payload)) as BabyProfile : undefined,
      familyId, membership, principal
    };
    // Dedicated caregiver projections/writes come later; never expose a full export.
    if (!(memberOnly ? resolveFamilyMembership(input) : canPerformFamilyAction(input, 'family:read'))) fail('forbidden');
    return input;
  }

  function profiles(): BabyProfile[] {
    return sortProfiles(database.prepare('SELECT payload FROM profiles WHERE family_id = ?').all(familyId)
      .map((row) => JSON.parse(String(row.payload)) as BabyProfile));
  }

  function records<T>(collection: string): T[] {
    return database.prepare('SELECT payload FROM records WHERE family_id = ? AND collection = ? AND deleted_at IS NULL')
      .all(familyId, collection).map((row) => JSON.parse(String(row.payload)) as T);
  }

  function exportData(): TrackerExport {
    return transaction(false, () => {
      const people = profiles();
      const profile = people[0];
      if (!profile) fail('not-found');
      return { events: migrateStoredEvents(records<StoredCareEvent>('events')), exportedAt: now(), profile,
        profiles: people, shopping: records<ShoppingItem>('shopping'), tasks: records<TaskItem>('tasks'), version: 1 };
    });
  }

  function snapshot(query: EventQuery = {}): TrackerSnapshot {
    return transaction(false, () => {
      const people = profiles();
      const active = getActiveProfiles(people);
      const profile = active.find((person) => person.id === query.babyId) ?? active[0];
      if (!profile) fail('not-found');
      const allEvents = migrateStoredEvents(records<StoredCareEvent>('events'));
      const events = allEvents.filter((event) => event.babyId === profile.id &&
        (!query.type || query.type === event.type) && (!query.from || event.startedAt >= query.from) && (!query.to || event.startedAt <= query.to))
        .sort((a, b) => (query.sort === 'asc' ? 1 : -1) * (Date.parse(a.startedAt) - Date.parse(b.startedAt)));
      const childIds = new Set(people.filter(isChild).map((person) => person.id));
      return { ...(isParent(profile) ? { childEvents: allEvents.filter((event) => childIds.has(event.babyId)) } : {}),
        events, profile, profiles: people, shopping: records<ShoppingItem>('shopping'), tasks: records<TaskItem>('tasks') };
    });
  }

  function mutateTask(command: TaskMutation): TaskMutationResult {
    if (!command || !['save','remove'].includes(command.kind)) fail('invalid');
    const result = mutation({ action:command.kind === 'save' ? 'save':'remove',collection:'tasks',expectedRevision:command.expectedRevision,
      id:command.kind === 'save' ? command.task?.id : command.id,operationId:command.operationId,
      ...(command.kind === 'save' ? { patch:command.task as unknown as Record<string,unknown> } : {}) });
    return { ...(result.deletedAt ? { deletedAt:result.deletedAt } : {}),id:result.id,revision:result.revision,task:result.payload as unknown as TaskItem };
  }

  function mutation(command: MutationCommand): MutationResult {
    return transaction(true, () => {
      const auth = authorize(true);
      const member = auth.membership!;
      if (!['profiles','events','shopping','tasks','nursery'].includes(command.collection) ||
          !['save','remove','archive','restore'].includes(command.action) || !validId(command.id) || !validId(command.operationId) ||
          !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) fail('invalid');
      const table = command.collection === 'profiles' ? 'profiles' : 'records';
      const row = table === 'profiles'
        ? database.prepare('SELECT payload, revision, NULL AS deleted_at FROM profiles WHERE family_id = ? AND id = ?').get(familyId, command.id)
        : database.prepare('SELECT payload, revision, deleted_at FROM records WHERE family_id = ? AND collection = ? AND id = ?').get(familyId, command.collection, command.id);
      const previous = row ? object(JSON.parse(String(row.payload))) : {};
      const patch = command.patch === undefined ? {} : object(command.patch);
      if (patch.id !== undefined && patch.id !== command.id) fail('invalid');
      if (patch.familyId !== undefined && patch.familyId !== familyId) fail('forbidden');
      if (command.collection === 'profiles' && command.action === 'remove') fail('invalid');
      if (command.collection !== 'profiles' && ['archive','restore'].includes(command.action)) fail('invalid');
      // Caregivers can create an allowed child entry only; full reads remain parent-only.
      if (member.role === 'caregiver') {
        const targetId = text(patch.babyId);
        const targetRow = database.prepare('SELECT payload FROM profiles WHERE family_id = ? AND id = ?').get(familyId, targetId);
        const target = targetRow ? JSON.parse(String(targetRow.payload)) as BabyProfile : undefined;
        if (command.collection !== 'events' || command.action !== 'save' || command.expectedRevision !== 0 ||
            !canPerformFamilyAction(auth, 'child:add-event', target, patch.type as CareEvent['type'])) fail('forbidden');
      }
      const hash = createHash('sha256').update(canonicalJson(command)).digest('hex');
      const receipt = database.prepare('SELECT actor_id, request_hash, response_json FROM operations WHERE family_id = ? AND operation_id = ?').get(familyId, command.operationId);
      if (receipt) {
        if (receipt.actor_id !== principal.accountId || receipt.request_hash !== hash) fail('conflict');
        return JSON.parse(String(receipt.response_json)) as MutationResult;
      }
      if (Number(row?.revision ?? 0) !== command.expectedRevision) fail('conflict');
      if (row?.deleted_at || (command.action !== 'save' && !row)) fail('not-found');
      const timestamp = now();
      let payload = command.action === 'save' ? mergePatch(previous, patch) : { ...previous };
      payload = { ...payload, createdAt: previous.createdAt ?? timestamp, id: command.id, syncState: 'synced', updatedAt: timestamp };
      if (command.collection === 'profiles') {
        payload.familyId = familyId;
        // Archive/restore are the only ways to change this stamp.
        if (command.action === 'save' && ('archivedAt' in patch || (row && patch.kind !== undefined && patch.kind !== previous.kind))) fail('invalid');
        if (command.action === 'archive') payload.archivedAt = timestamp;
        if (command.action === 'restore') delete payload.archivedAt;
        if (previous.kind === 'parent' && payload.archivedAt) {
          const others = profiles().filter((p) => p.id !== command.id && p.kind === 'parent' && !p.archivedAt);
          const activeParents = others.filter((p) => database.prepare(`SELECT 1 FROM memberships m JOIN accounts a ON a.id = m.account_id
            WHERE m.family_id = ? AND m.profile_id = ? AND m.revoked_at IS NULL AND a.disabled_at IS NULL`).get(familyId, p.id));
          if (!activeParents.length) fail('conflict');
        }
      }
      if (command.collection === 'events') {
        const target = database.prepare('SELECT payload FROM profiles WHERE family_id = ? AND id = ?').get(familyId, text(payload.babyId));
        if (!target || (command.action === 'save' && (JSON.parse(String(target.payload)) as BabyProfile).archivedAt)) fail('invalid');
        if (row && payload.babyId !== previous.babyId) fail('invalid');
        const person = JSON.parse(String(target.payload)) as BabyProfile;
        const parentTypes = ['sleep','mood','temperature','medication','appointment','note','menses','intake','output'];
        if (person.kind === 'caregiver' || (person.kind === 'parent' ? !parentTypes.includes(String(payload.type)) : ['menses','intake','output'].includes(String(payload.type)))) fail('invalid');
        if (payload.type === 'menses' && person.parentRole !== 'mom') fail('invalid');
        if (member.role === 'caregiver' || (!row && person.kind !== 'parent')) payload.caregiverId = member.profileId;
        if (payload.caregiverId) {
          const caregiver = database.prepare('SELECT payload FROM profiles WHERE family_id = ? AND id = ?').get(familyId, text(payload.caregiverId));
          if (!caregiver) fail('invalid');
          const actor = JSON.parse(String(caregiver.payload)) as BabyProfile;
          if (!['parent','caregiver'].includes(String(actor.kind)) || actor.archivedAt) fail('invalid');
        }
      }
      if (command.collection === 'tasks' || command.collection === 'shopping') {
        const key = command.collection === 'tasks' ? 'createdBy' : 'addedBy';
        payload[key] = previous[key] ?? member.profileId;
        if (payload.assigneeId) {
          const target = database.prepare('SELECT payload FROM profiles WHERE family_id = ? AND id = ?').get(familyId, text(payload.assigneeId));
          if (!target || (JSON.parse(String(target.payload)) as BabyProfile).archivedAt) fail('invalid');
        }
      }
      validateDocument(command.collection, payload);
      const revision = Number(row?.revision ?? 0) + 1;
      const deletedAt = command.action === 'remove' ? timestamp : undefined;
      if (table === 'profiles') database.prepare(`INSERT INTO profiles VALUES (?, ?, ?, ?)
        ON CONFLICT (family_id, id) DO UPDATE SET payload = excluded.payload, revision = excluded.revision`).run(familyId, command.id, JSON.stringify(payload), revision);
      else database.prepare(`INSERT INTO records VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (family_id, collection, id) DO UPDATE SET payload = excluded.payload, revision = excluded.revision, deleted_at = excluded.deleted_at`)
        .run(familyId, command.collection, command.id, JSON.stringify(payload), revision, deletedAt ?? null);
      database.prepare('INSERT INTO changes (family_id, collection, record_id, revision, deleted_at) VALUES (?, ?, ?, ?, ?)')
        .run(familyId, command.collection, command.id, revision, deletedAt ?? null);
      const related: Array<Omit<MutationResult,'related'>> = [];
      // A birth changes the child's date in the same transaction as the event.
      if (command.collection === 'events' && payload.type === 'birth' && command.action === 'save') {
        const childRow = database.prepare('SELECT payload, revision FROM profiles WHERE family_id = ? AND id = ?').get(familyId, String(payload.babyId))!;
        const child = object(JSON.parse(String(childRow.payload)));
        child.birthDate = timestampDay(String(payload.startedAt),String(child.timezone)); child.updatedAt = timestamp;
        database.prepare('UPDATE profiles SET payload = ?, revision = revision + 1 WHERE family_id = ? AND id = ?').run(JSON.stringify(child), familyId, String(payload.babyId));
        database.prepare("INSERT INTO changes (family_id, collection, record_id, revision) VALUES (?, 'profiles', ?, ?)").run(familyId, String(payload.babyId), Number(childRow.revision) + 1);
        related.push({ collection:'profiles',id:String(payload.babyId),payload:child,revision:Number(childRow.revision)+1 });
      }
      const result = { ...(related.length ? { related } : {}),collection: command.collection, ...(deletedAt ? { deletedAt } : {}), id: command.id, payload, revision };
      database.prepare('INSERT INTO operations VALUES (?, ?, ?, ?, ?, ?)').run(familyId, command.operationId, principal.accountId, hash, JSON.stringify(result), timestamp);
      return result;
    }, true);
  }

  function bootstrap(limited = false): BootstrapData {
    return transaction(false, () => {
      const auth = authorize(true);
      const member = auth.membership!;
      let data: TrackerExport;
      if (member.role === 'parent' && !limited) {
        const people = profiles();
        data = { events: migrateStoredEvents(records<StoredCareEvent>('events')), exportedAt: now(), profile: people[0], profiles: people,
          shopping: records<ShoppingItem>('shopping'), tasks: records<TaskItem>('tasks'), version: 1 };
      } else {
        const people = profiles().filter((p) => isChild(p) && !p.archivedAt).map((p) => ({
          birthDate:p.birthDate,careInfo:{ ...p.careInfo,guardians:profiles().filter((person) => person.kind === 'parent' && !person.archivedAt).map((person) => ({ name:person.name,phone:person.phone })) },createdAt: p.createdAt, dueDate: p.dueDate, familyId, gender: p.gender,
          id: p.id, kind: 'child' as const, name: p.name, preferredUnits: p.preferredUnits, timezone: p.timezone, updatedAt: p.updatedAt
        }));
        if (!people.length) fail('not-found');
        const ids = new Set(people.map((p) => p.id));
        // Home summaries use today's entries and the latest feed/change/sleep/bath.
        const all = migrateStoredEvents(records<StoredCareEvent>('events')).filter((e) => ids.has(e.babyId) && CAREGIVER_EVENT_TYPES.includes(e.type));
        const latest = new Set<string>();
        const events = [...all].sort((a,b) => b.startedAt.localeCompare(a.startedAt)).filter((e) => {
          const key = `${e.babyId}:${e.type}`;
          const keep = timestampDay(e.startedAt,people.find((p) => p.id === e.babyId)!.timezone) === timestampDay(now(),people.find((p) => p.id === e.babyId)!.timezone) || (!latest.has(key) && ['feed','diaper','sleep','bath'].includes(e.type));
          latest.add(key); return keep;
        }).map((e) => {
          const allowed = ['id','babyId','type','startedAt','endedAt','createdAt','updatedAt','durationMinutes','amountOz','method','side','contents','kind','color','poopSize','celsius','level'];
          return Object.fromEntries(Object.entries(e).filter(([key]) => allowed.includes(key))) as unknown as CareEvent;
        });
        data = { events, exportedAt: now(), profile: people[0], profiles: people, shopping: [], tasks: [], version: 1 };
      }
      const revisions: Record<string,number> = {};
      for (const row of database.prepare('SELECT id, revision FROM profiles WHERE family_id = ?').all(familyId)) {
        if ((member.role === 'parent' && !limited) || data.profiles?.some((p) => p.id === row.id)) revisions[`profiles:${row.id}`] = Number(row.revision);
      }
      for (const row of database.prepare('SELECT collection, id, revision FROM records WHERE family_id = ?').all(familyId)) {
        if (member.role === 'parent' && !limited) revisions[`${row.collection}:${row.id}`] = Number(row.revision);
      }
      const after = Number(database.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM changes WHERE family_id = ?').get(familyId)!.n);
      return { accountId: principal.accountId, actorProfileId: member.profileId, cursor: { after, familyId }, data, familyId, revisions, role: member.role };
    }, true);
  }

  function nurseryData() { return transaction(false, () => records<Record<string,unknown>>('nursery')); }

  function changes(cursor?: ChangeCursor, limit = 100) {
    return transaction(false, () => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) fail('invalid');
      const floor = Number(database.prepare('SELECT floor FROM sync_retention WHERE family_id = ?').get(familyId)?.floor ?? 0);
      const latest = Number(database.prepare('SELECT COALESCE(MAX(sequence), 0) AS latest FROM changes WHERE family_id = ?').get(familyId)!.latest);
      const after = cursor?.after ?? 0;
      const through = cursor?.through ?? latest;
      if ((cursor && cursor.familyId !== familyId) || !Number.isSafeInteger(after) || !Number.isSafeInteger(through) || after < 0 || after > through || through > latest) fail('invalid');
      if (cursor && cursor.after < floor) fail('expired-cursor');
      const rows = database.prepare(`SELECT sequence, collection, record_id AS id, revision, deleted_at AS deletedAt FROM changes
        WHERE family_id = ? AND sequence > ? AND sequence <= ? ORDER BY sequence LIMIT ?`).all(familyId, after, through, limit + 1);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      // Returned rows are invalidations, not historical payloads. Re-fetch current
      // records or bootstrap after catching up; never pair these with newer JSON
      // and claim it is an immutable snapshot at this cursor.
      return { changes: page, cursor: { after: hasMore ? Number(page[page.length - 1].sequence) : through, familyId, ...(hasMore ? { through } : {}) }, hasMore, through };
    });
  }

  return { bootstrap, changes, exportData, mutateTask, mutation, nurseryData, snapshot };
}
