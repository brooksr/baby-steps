/// <reference types="node" />
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { migrateStoredEvent, type StoredCareEvent } from '../../domain/legacyEvents';
import type { TrackerExport } from '../../domain/types';
import { canonicalJson, fail, object, text, validateDocument } from './validation';

export interface FamilyImport {
  data: TrackerExport;
  familyId: string;
  nursery?: Array<Record<string,unknown>>;
  ownerAccountId: string;
  ownerProfileId: string;
  sheetId: string;
}
export function planFamilyImport(input: FamilyImport) {
  text(input.familyId); text(input.ownerAccountId); text(input.ownerProfileId); text(input.sheetId);
  const data = object(input.data);
  if (data.version !== 1 || !Array.isArray(data.events)) fail('invalid');
  const profiles: Array<Record<string,unknown>> = (input.data.profiles?.length ? input.data.profiles : [input.data.profile]).map((p) => ({ ...object(p), familyId:input.familyId }));
  const seen = new Set<string>();
  for (const p of profiles) { validateDocument('profiles',p); if (seen.has(String(p.id))) fail('invalid'); seen.add(String(p.id)); }
  const owner = profiles.find((p) => p.id === input.ownerProfileId);
  if (!owner || owner.kind !== 'parent' || owner.archivedAt) fail('invalid');
  const groups = { events:input.data.events, nursery:input.nursery ?? [], shopping:input.data.shopping ?? [], tasks:input.data.tasks ?? [] };
  for (const [collection,values] of Object.entries(groups)) {
    const ids = new Set<string>();
    for (const value of values) {
      const row = object(value); text(row.id); if (ids.has(String(row.id))) fail('invalid'); ids.add(String(row.id));
      validateDocument(collection,collection === 'events' ? object(migrateStoredEvent(row as unknown as StoredCareEvent)) : row);
      for (const key of collection === 'events' ? ['babyId','caregiverId'] : collection === 'tasks' ? ['assigneeId','createdBy'] : ['addedBy']) {
        if (row[key] && !seen.has(String(row[key]))) fail('invalid');
      }
    }
  }
  const fingerprint = createHash('sha256').update(canonicalJson({ data:input.data,familyId:input.familyId,nursery:input.nursery ?? [],
    ownerAccountId:input.ownerAccountId,ownerProfileId:input.ownerProfileId,sheetId:input.sheetId })).digest('hex');
  return { fingerprint, groups, profiles, report:{ events:groups.events.length,familyId:input.familyId,nursery:groups.nursery.length,profiles:profiles.length,
    shopping:groups.shopping.length,sourceDigest:fingerprint,tasks:groups.tasks.length } };
}
/** Operator-only cutover tool. The HTTP API deliberately does not expose this. */
export function importFamily(database: DatabaseSync, input: FamilyImport, sourcePaused: boolean, timestamp = new Date().toISOString()) {
  if (!sourcePaused) fail('conflict');
  const plan = planFamilyImport(input);
  database.exec('BEGIN IMMEDIATE');
  try {
    const previous = database.prepare('SELECT family_id, report_json FROM migration_receipts WHERE source_digest=?').get(plan.fingerprint);
    if (previous) { database.exec('COMMIT'); return JSON.parse(String(previous.report_json)) as typeof plan.report; }
    if (!database.prepare('SELECT 1 FROM accounts WHERE id=? AND disabled_at IS NULL').get(input.ownerAccountId)) fail('forbidden');
    // Import only to a fresh family. Never overwrite an existing internal log.
    if (database.prepare('SELECT 1 FROM families WHERE id=? OR legacy_sheet_id=?').get(input.familyId,input.sheetId)) fail('conflict');
    database.prepare('INSERT INTO families VALUES (?, ?, ?)').run(input.familyId,timestamp,input.sheetId);
    for (const row of plan.profiles) {
      database.prepare('INSERT INTO profiles VALUES (?, ?, ?, 1)').run(input.familyId,String(row.id),JSON.stringify(row));
      database.prepare("INSERT INTO changes (family_id, collection, record_id, revision) VALUES (?, 'profiles', ?, 1)").run(input.familyId,String(row.id));
    }
    for (const [collection,rows] of Object.entries(plan.groups)) for (const row of rows) {
      database.prepare('INSERT INTO records VALUES (?, ?, ?, ?, 1, NULL)').run(input.familyId,collection,String(row.id),JSON.stringify(row));
      database.prepare('INSERT INTO changes (family_id, collection, record_id, revision) VALUES (?, ?, ?, 1)').run(input.familyId,collection,String(row.id));
    }
    database.prepare("INSERT INTO memberships VALUES (?, ?, ?, 'parent', ?, NULL)").run(input.familyId,input.ownerAccountId,input.ownerProfileId,timestamp);
    database.prepare('INSERT INTO migration_receipts VALUES (?, ?, ?, ?)').run(plan.fingerprint,input.familyId,timestamp,JSON.stringify(plan.report));
    database.exec('COMMIT'); return plan.report;
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
