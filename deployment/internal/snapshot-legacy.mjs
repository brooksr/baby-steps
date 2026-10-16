// Operator-only final snapshot. Run with the legacy service-account key mounted
// read-only, the existing events.env, and a private /capture output directory.
import { Buffer } from 'node:buffer';
import { createHash, createSign } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL, URLSearchParams } from 'node:url';

process.umask(0o077);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const chunk = readdirSync(`${root}/dist-internal/chunks`).find(name => /^familyRepository-.*\.mjs$/.test(name));
if (!chunk) throw new Error('Build the internal tools first.');
const { N: schemas, p: parseBatch } = await import(pathToFileURL(`${root}/dist-internal/chunks/${chunk}`));
const fetch = globalThis.fetch;
const { APP_API_TOKEN, BABYSTEPS_SHEET_ID, OWNER_ACCOUNT_ID, OWNER_PROFILE_ID, TARGET_FAMILY_ID } = process.env;
if (![APP_API_TOKEN, BABYSTEPS_SHEET_ID, OWNER_ACCOUNT_ID, OWNER_PROFILE_ID, TARGET_FAMILY_ID].every(Boolean)) throw new Error('Set source and explicit owner/family configuration.');
const trackerResponse = await fetch('http://babysteps/api/events/app', { headers: { Authorization:`Bearer ${APP_API_TOKEN}` } });
if (!trackerResponse.ok) throw new Error(`Legacy export failed: ${trackerResponse.status}`);
const data = await trackerResponse.json();
if (!data.ok || data.version !== 1 || !data.profiles?.every(p => p.familyId === BABYSTEPS_SHEET_ID)) throw new Error('Source family mismatch.');
delete data.ok;
const key = JSON.parse(readFileSync('/legacy-key.json', 'utf8'));
const now = Math.floor(Date.now() / 1000);
const uri = 'https://oauth2.googleapis.com/token';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const unsigned = `${encode({ alg:'RS256',typ:'JWT' })}.${encode({ aud:uri,exp:now+3600,iat:now,iss:key.client_email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly' })}`;
const assertion = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url')}`;
const tokenResponse = await fetch(uri, { method:'POST',headers:{ 'Content-Type':'application/x-www-form-urlencoded' },body:new URLSearchParams({ assertion,grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer' }) });
if (!tokenResponse.ok) throw new Error(`Read-only token failed: ${tokenResponse.status}`);
const { access_token:token } = await tokenResponse.json();
const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(BABYSTEPS_SHEET_ID)}/values:batchGet`);
url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
const kinds = Object.keys(schemas);
for (const kind of kinds) url.searchParams.append('ranges', `'${schemas[kind].tab}'!A:AZ`);
const nurseryResponse = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
if (!nurseryResponse.ok) throw new Error(`Nursery export failed: ${nurseryResponse.status}`);
const nurseryRaw = await nurseryResponse.json();
const nursery = []; const counts = {};
for (const [index, kind] of kinds.entries()) {
  const [header=[], ...rows] = nurseryRaw.valueRanges[index].values ?? [];
  const columns = schemas[kind].columns;
  if (rows.length && ['recordKey', ...columns].some(name => !header.includes(name))) throw new Error(`Missing ${kind} header`);
  counts[kind] = 0;
  for (const row of rows) {
    const key = row[header.indexOf('recordKey')];
    if (!key && row.every(cell => cell === '' || cell === null)) continue;
    const record = Object.fromEntries(columns.map(name => {
      const value = row[header.indexOf(name)];
      return [name, value === undefined || value === '' ? null : value];
    }));
    const batch = parseBatch({ deviceId:record.sourceDeviceId,records:[{ data:record,key,kind,schemaVersion:2 }],schemaVersion:2 });
    if (!batch.ok) throw new Error(`Invalid ${kind} source row ${counts[kind]+2}: ${batch.error}`);
    nursery.push({ data:record,id:createHash('sha256').update(`${record.sourceDeviceId}:${key}`).digest('hex'),kind });
    counts[kind]++;
  }
}
const input = { data,familyId:TARGET_FAMILY_ID,nursery,ownerAccountId:OWNER_ACCOUNT_ID,ownerProfileId:OWNER_PROFILE_ID,sheetId:BABYSTEPS_SHEET_ID };
writeFileSync('/capture/import.json',JSON.stringify(input),{ mode:0o600,flag:'wx' });
writeFileSync('/capture/source-snapshot.json',JSON.stringify({ data,nurseryRaw }),{ mode:0o600,flag:'wx' });
process.stdout.write(JSON.stringify({ events:data.events.length,nursery:counts,profiles:data.profiles.length,shopping:data.shopping?.length ?? 0,tasks:data.tasks?.length ?? 0 })+'\n');
