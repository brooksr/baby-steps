/// <reference types="node" />
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { openInternalDatabase } from './database';
import { importFamily, planFamilyImport, type FamilyImport } from './migration';
import { createFamilyRepository } from './familyRepository';
const { backup, DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

process.umask(0o077);
const { positionals, values } = parseArgs({ allowPositionals:true,options:{ apply:{ type:'boolean' }, database:{ type:'string' }, file:{ type:'string' },
  'source-paused':{ type:'boolean' }, destination:{ type:'string' }, family:{ type:'string' }, account:{ type:'string' } } });
const command = positionals[0];
if (!values.database) throw new Error('Pass --database PATH.');
if (command === 'restore-check') {
  const db = new DatabaseSync(values.database,{ readOnly:true });
  try {
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Restore verification failed.');
    console.log(JSON.stringify({ integrity:'ok',schemaVersions:db.prepare('SELECT version FROM schema_migrations').all() }));
  } finally { db.close(); }
} else {
  const db = openInternalDatabase(values.database);
  try {
    if (command === 'backup') {
      if (!values.destination || existsSync(values.destination)) throw new Error('Choose a new --destination path.');
      await backup(db,values.destination); chmodSync(values.destination,0o600); console.log('Backup created; encrypt before moving off-device.');
    } else if (command === 'migrate') {
      if (!values.file) throw new Error('Pass --file with a reviewed FamilyImport JSON (no credentials).');
      const input = JSON.parse(readFileSync(values.file,'utf8')) as FamilyImport;
      console.log(JSON.stringify(values.apply ? importFamily(db,input,Boolean(values['source-paused'])) : planFamilyImport(input).report,null,2));
    } else if (command === 'export') {
      if (!values.family || !values.account || !values.destination || existsSync(values.destination)) throw new Error('Pass --family, --account and a new --destination.');
      const repository = createFamilyRepository(db,values.family,{ accountId:values.account,sessionId:'operator-console' });
      writeFileSync(values.destination,JSON.stringify({ tracker:repository.exportData(),nursery:repository.nurseryData() },null,2),{ flag:'wx',mode:0o600 }); console.log('Family export created.');
    } else if (command === 'migrate-schema') console.log('Schema is current.');
    else throw new Error('Commands: migrate-schema, migrate, backup, restore-check, export.');
  } finally { db.close(); }
}
