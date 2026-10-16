// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openInternalDatabase } from './database';

function seed(database: ReturnType<typeof openInternalDatabase>) {
  database.exec(`
    INSERT INTO accounts VALUES ('account-a', '2026-10-16T12:00:00Z', NULL);
    INSERT INTO families VALUES ('family-a', '2026-10-16T12:00:00Z', 'old-sheet');
    INSERT INTO families VALUES ('family-b', '2026-10-16T12:00:00Z', NULL);
    INSERT INTO profiles VALUES ('family-a', 'parent', '{"id":"parent","familyId":"family-a","kind":"parent"}', 1);
  `);
}

describe('internal SQLite foundation', () => {
  it('migrates once and preserves data when reopened', () => {
    const directory = mkdtempSync(join(tmpdir(), 'babysteps-internal-'));
    const path = join(directory, 'test.sqlite');
    try {
      const first = openInternalDatabase(path);
      try { seed(first); } finally { first.close(); }
      const second = openInternalDatabase(path);
      try {
        expect(second.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()?.count).toBe(1);
        expect(second.prepare('SELECT legacy_sheet_id FROM families WHERE id = ?').get('family-a')?.legacy_sheet_id).toBe('old-sheet');
        expect(second.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
      } finally { second.close(); }
    } finally { rmSync(directory, { force: true, recursive: true }); }
  });

  it('enforces family-scoped profile membership and preserves archived people', () => {
    const database = openInternalDatabase(':memory:');
    try {
      seed(database);
      expect(() => database.exec(`INSERT INTO memberships VALUES ('family-b', 'account-a', 'parent', 'parent', 'now', NULL)`)).toThrow();
      database.exec(`INSERT INTO memberships VALUES ('family-a', 'account-a', 'parent', 'parent', 'now', NULL)`);
      expect(() => database.exec(`DELETE FROM profiles WHERE family_id = 'family-a'`)).toThrow('Profiles are archived');
      expect(() => database.exec(`INSERT INTO profiles VALUES ('family-b', 'parent', '{"id":"parent","familyId":"family-a"}', 1)`)).toThrow();
    } finally { database.close(); }
  });

  it('prevents a Google subject from being linked to two accounts', () => {
    const database = openInternalDatabase(':memory:');
    try {
      seed(database);
      database.exec(`INSERT INTO accounts VALUES ('account-b', 'now', NULL);
        INSERT INTO identities VALUES ('google', 'verified-sub', 'account-a', 'now');`);
      expect(() => database.exec(`INSERT INTO identities VALUES ('google', 'verified-sub', 'account-b', 'now')`)).toThrow();
    } finally { database.close(); }
  });

  it('scopes operation deduplication by family and rolls back a failed batch', () => {
    const database = openInternalDatabase(':memory:');
    try {
      seed(database);
      const insert = database.prepare('INSERT INTO operations VALUES (?, ?, ?, ?, ?, ?)');
      insert.run('family-a', 'op-1', 'account-a', 'hash', '{}', 'now');
      insert.run('family-b', 'op-1', 'account-a', 'hash', '{}', 'now');
      expect(() => insert.run('family-a', 'op-1', 'account-a', 'other-hash', '{}', 'now')).toThrow();
      database.exec('BEGIN');
      try {
        database.exec(`INSERT INTO records VALUES ('family-a', 'events', 'feed', '{}', 1, NULL)`);
        database.exec(`INSERT INTO records VALUES ('unknown-family', 'events', 'feed', '{}', 1, NULL)`);
      } catch { database.exec('ROLLBACK'); }
      expect(database.prepare('SELECT COUNT(*) AS count FROM records').get()?.count).toBe(0);
    } finally { database.close(); }
  });

  it('refuses schema drift without silently rewriting a migration', () => {
    const directory = mkdtempSync(join(tmpdir(), 'babysteps-schema-'));
    const path = join(directory, 'test.sqlite');
    try {
      const database = openInternalDatabase(path);
      database.exec("UPDATE schema_migrations SET checksum = 'different-build'");
      database.close();
      expect(() => openInternalDatabase(path)).toThrow('schema differs');
    } finally { rmSync(directory, { force: true, recursive: true }); }
  });
});
