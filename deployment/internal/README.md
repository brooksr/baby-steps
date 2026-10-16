# Internal backend deployment and cutover

These are opt-in deployment artifacts. Existing Pages/Pi releases still deploy
legacy Sheets builds; this change does not overwrite them or a family log.
The approved passkey RP is `raspberrypi.tailc2b8e3.ts.net`, with origin
`https://raspberrypi.tailc2b8e3.ts.net:8443`. Confirm the port against the running
HTTPS site before enrollment. Origin changes require explicit configuration;
never derive trusted WebAuthn origins from request headers.

## Stage without moving a family

1. On a clean checkout with Node 24, run `npm ci`, `npm run lint`, `npm test`,
   `npm run build:server`, `npm run build:internal`, and `npm run test:e2e`.
   Build staged web assets with
   `VITE_INTERNAL_API=/api/v1 npm run build -- --base /internal/`.
2. Copy `dist-internal/` and this deployment directory to a versioned release
   on the Pi, retaining their relative paths for Docker build context. Create
   `internal.env` from the example, with file mode 600. Keep the database in the
   named Docker volume, never under a rolling release or static web root.
3. From this directory: `docker compose up -d --build`. The image prepares a
   node-owned persistent directory; do not run the app as root or use a shared
   network filesystem. Inspect `docker compose ps` and the health endpoint on
   loopback. The API does not accept CORS access from arbitrary browser origins.
4. Install the nginx location examples in the existing HTTPS virtual host,
   validate nginx configuration and reload it. Copy staged web files into the
   alias directory. Keep existing `/api/events`, `/api/nursery`, `/api/token`
   and root PWA behavior unchanged while rehearsing.
5. Temporarily set registration open, recreate the container, visit
   `/internal/`, enroll a passkey, and save recovery codes outside the Pi.
   Invite the other parents/caregivers explicitly. Close registration again
   and recreate the container after household onboarding. Valid, unaccepted
   invitations permit new-account enrollment even while open signup is closed.
6. Test account recovery, caregiver denial, native enrollment and revocation
   with synthetic data. Native pairing opens the origin's root by default;
   during staging visit `/internal/` manually and enter the connection code in
   Account. Check phone/watch emulator and dedicated-device behavior before
   connecting nursery hardware.

## Backups and restore drills

The image includes `internal-tool.mjs`. Use SQLite's online backup, not a copy of
only the live file (WAL may contain committed rows):

```bash
docker compose exec internal node internal-tool.mjs backup --database /var/lib/babysteps/internal.sqlite --destination /var/lib/babysteps/backup-YYYYMMDD.sqlite
docker compose exec internal node internal-tool.mjs restore-check --database /var/lib/babysteps/backup-YYYYMMDD.sqlite
```

Copy the backup into a private directory, encrypt it with an operator-managed
recipient (for example `age -r RECIPIENT`), verify decryption/restore on a fresh
host, then move the encrypted artifact off-device. Keep encryption recovery keys
separate from the Pi. Backups include accounts, recovery hashes and sessions as
well as care data. Retain daily/weekly/monthly backups according to household
policy; alert on failures, free disk space and stale backups. Do not put backups
in GitHub releases or expose them through nginx.

A restore drill must use a separate volume and the matching build. Run integrity
and foreign-key checks, open the app, compare family/profile/event/list/nursery
counts, and exercise a queued-operation retry. After an incident restore, revoke
sessions/devices as appropriate so an old snapshot cannot revive revoked access.
Stop writes before replacing the production database; keep the old volume for
review. Never run `docker compose down -v` during upgrades or ordinary rollback.

## Migration tooling

Sign into the staged internal app first to create a stable owner account. Export
the legacy family and nursery data separately, then create a private JSON file:

```json
{
  "data": { "version": 1, "exportedAt": "...", "profile": {}, "profiles": [], "events": [], "shopping": [], "tasks": [] },
  "familyId": "NEW_RANDOM_UUID",
  "nursery": [],
  "ownerAccountId": "VERIFIED_INTERNAL_ACCOUNT_ID",
  "ownerProfileId": "EXISTING_PARENT_PROFILE_ID",
  "sheetId": "SOURCE_SPREADSHEET_ID"
}
```

Replace the placeholder `data` with the real export. Nursery records use
`{ id, kind, data }`; ids must be stable across reruns. The tool keeps all profile
and record ids, archived people, unknown JSON fields and old event variants.
It only stamps new family metadata and establishes the one explicit owner's
membership. It never claims other profiles by matching email. This file contains
private records: use mode 600 and keep it outside the repository.

Run a dry run first; it prints counts and a source fingerprint, not health data:

```bash
node dist-internal/internal-tool.mjs migrate --database PRIVATE_DB_PATH --file PRIVATE_IMPORT_FILE
```

A trusted operator must verify source-family authority, review account/profile
mapping, back up both stores, drain known device outboxes and pause ALL legacy
writers (PWA, phone, watch, voice and nursery) before applying:

```bash
node dist-internal/internal-tool.mjs migrate --database PRIVATE_DB_PATH --file PRIVATE_IMPORT_FILE --apply --source-paused
```

Import is atomic and repeatable for the exact same reviewed input. It refuses to
overwrite an existing internal family or reuse a source Sheet for another
migration. A changed input requires review, never a forced merge into production.
The imported family becomes available in the owner's selector; other users must
accept new membership invitations.

## Production cutover, updates and rollback

After counts/reports/offline checks pass, build the PWA for `/`, switch static
assets to the internal build, enroll phone/watch accounts and replace nursery/
voice integrations with scoped credentials. Keep the source Sheet read-only or
an explicit one-way export. Do not leave legacy clients writing into it.
Native clients can still choose legacy mode deliberately; the server never maps
shared legacy bearer tokens into internal memberships.

Pin/review the Node image and auth dependency versions during updates. Back up
before an upgrade; startup runs forward migrations before health becomes ready.
The schema ledger rejects altered or unknown migrations, so an older image may
refuse an upgraded database. Test upgrade/rollback with a copied volume first.
Deploy the whole `dist-internal` directory (including chunks), not just its entry
file. Never reuse the stateless events API release file for this backend.

Before internal writes, restore the legacy web/config to roll back. After
internal writes, pause writes, export/reconcile the internal log and validate the
recovery dataset before returning to Sheets. An old Sheet is no longer a current
backup. Keep the SQL volume and reports. Credential/account revocation must not
delete tracked people or their entries.

The existing separate `rpi` repo installer/updater has not been changed or run.
Adopt these artifacts there only after its maintainer reviews persistent volumes,
proxy routing, backups and release gating. No production installation, family
cutover, external Google configuration or real-device test is performed by
checking in these files.
