/// <reference types="node" />
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { DatabaseSync as SqliteDatabase } from 'node:sqlite';
import schema from './schema.sql?raw';
import services from './migrations/002-services.sql?raw';
import native from './migrations/003-native.sql?raw';
import devicePurpose from './migrations/004-device-purpose.sql?raw';
import deviceSource from './migrations/005-device-source.sql?raw';

// Vite 5 predates node:sqlite and treats a static import as a package name.
// Load the Node built-in at runtime; this file must never enter the PWA bundle.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

/**
 * Explicit opt-in development foundation. No running server imports this yet.
 * Caller owns the persistent path/volume and must close the returned database.
 */
export function openInternalDatabase(path: string): SqliteDatabase {
  const database = new DatabaseSync(path);

  try {
    database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    database.exec('BEGIN IMMEDIATE');

    try {
      database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        checksum TEXT NOT NULL
      ) STRICT;`);
      const migrations = database.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all();
      const scripts = [schema, services, native, devicePurpose, deviceSource];
      const checksums = scripts.map((script) => createHash('sha256').update(script).digest('hex'));
      if (migrations.some((row, index) => row.version !== index + 1 || row.checksum !== checksums[index])) {
        throw new Error('Internal database schema differs from this build. Use the matching build or an explicit migration.');
      }
      for (let index = migrations.length; index < scripts.length; index++) {
        database.exec(scripts[index]);
        database.prepare('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)').run(index + 1, checksums[index]);
      }

      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }

    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
