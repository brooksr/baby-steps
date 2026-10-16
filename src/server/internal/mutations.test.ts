// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openInternalDatabase } from './database';
import { createFamilyRepository } from './familyRepository';
import { createAccountService } from './accounts';
import { importFamily, planFamilyImport, type FamilyImport } from './migration';
import type { BootstrapData, MutationCommand } from '../../domain/internalApi';

let db: ReturnType<typeof openInternalDatabase>; let familyId: string; let repo: ReturnType<typeof createFamilyRepository>; let boot: BootstrapData;
beforeEach(() => {
  db = openInternalDatabase(':memory:'); const auth = createAccountService(db,{ origin:'https://example.test',registrationOpen:true,rpId:'example.test' });
  db.exec("INSERT INTO accounts VALUES ('account','2026-10-16T00:00:00Z',NULL)");
  const session = auth.issueSession('account'); const principal = auth.session(session.token,'browser');
  familyId = auth.createFamily(principal,{ childName:'Baby Example',parentName:'Alex Example' }).familyId;
  repo = createFamilyRepository(db,familyId,principal); boot = repo.bootstrap();
});
afterEach(() => db.close());
const mutation = (collection: MutationCommand['collection'],id: string,patch: Record<string,unknown>,revision = 0): MutationCommand => ({ action:'save',collection,expectedRevision:revision,id,operationId:crypto.randomUUID(),patch });

describe('internal mutation and migration transactions',() => {
  it('preserves unknown fields, clears null patches, and emits profiles with the bootstrap cursor',() => {
    const row = repo.mutation(mutation('tasks','task',{ futureField:{ kept:true },notes:'clear this',status:'open',title:'Example' }));
    const second = repo.mutation(mutation('tasks','task',{ notes:null,title:'Changed' },row.revision));
    expect(second.payload.futureField).toEqual({ kept:true }); expect(second.payload.notes).toBeUndefined();
    const next = repo.bootstrap(); expect(next.revisions['tasks:task']).toBe(2); expect(next.cursor.after).toBeGreaterThan(boot.cursor.after);
    expect(repo.changes(next.cursor).changes).toEqual([]);
  });
  it('validates events and changes a birth date atomically, with last-parent protection',() => {
    const child = boot.data.profiles!.find((p) => p.kind === 'child')!;
    const parent = boot.data.profiles!.find((p) => p.kind === 'parent')!;
    expect(() => repo.mutation(mutation('events','bad',{ babyId:'foreign',startedAt:'2026-10-16T01:00:00Z',type:'sleep' }))).toThrow('invalid');
    expect(() => repo.mutation(mutation('events','bad-type',{ babyId:child.id,startedAt:'2026-10-16T01:00:00Z',type:'menses',flow:'light' }))).toThrow('invalid');
    repo.mutation(mutation('events','birth',{ babyId:child.id,startedAt:'2026-10-16T01:00:00Z',type:'birth' }));
    expect(repo.bootstrap().data.profiles!.find((p) => p.id === child.id)!.birthDate).toMatch(/^2026-10-/);
    expect(() => repo.mutation({ action:'archive',collection:'profiles',expectedRevision:1,id:parent.id,operationId:'archive-last' })).toThrow('conflict');
    const revision = repo.bootstrap().revisions[`profiles:${child.id}`];
    repo.mutation({ action:'archive',collection:'profiles',expectedRevision:revision,id:child.id,operationId:'archive-child' });
    expect(repo.exportData().profiles!.find((p) => p.id === child.id)!.archivedAt).toBeTruthy();
    expect(repo.snapshot().profile.id).toBe(parent.id);
  });
  it('imports an entire reviewed family once, rejects bad references and requires paused source writes',() => {
    const input: FamilyImport = { data:repo.exportData(),familyId:'migrated-family',ownerAccountId:'account',ownerProfileId:boot.actorProfileId,sheetId:'legacy-sheet' };
    const preview = planFamilyImport(input); expect(preview.report.profiles).toBe(2);
    expect(() => importFamily(db,input,false)).toThrow('conflict');
    const result = importFamily(db,input,true); expect(importFamily(db,input,true)).toEqual(result);
    const migrated = createFamilyRepository(db,'migrated-family',{ accountId:'account',sessionId:'operator' });
    expect(migrated.exportData().profiles!.map((p) => p.id)).toEqual(boot.data.profiles!.map((p) => p.id));
    expect(migrated.exportData().profiles!.every((p) => p.familyId === 'migrated-family')).toBe(true);
    const altered = { ...input,data:{ ...input.data,events:[{ babyId:'unknown',createdAt:'2026-10-16',id:'bad',startedAt:'2026-10-16',type:'sleep' as const,updatedAt:'2026-10-16' }] } };
    expect(() => planFamilyImport(altered)).toThrow('invalid');
  });
  it('rejects expired cursors after explicit retention pruning',() => {
    repo.mutation(mutation('tasks','task',{ status:'open',title:'Example' }));
    const floor = repo.bootstrap().cursor.after;
    db.prepare('INSERT INTO sync_retention VALUES (?, ?)').run(familyId,floor);
    expect(() => repo.changes({ after:0,familyId })).toThrow('expired-cursor');
  });
});
