# BabySteps-owned authentication and database

## Decision and current state

Move toward a BabySteps-owned account service and database hosted alongside the
Pi deployment. Use passkeys as the primary sign-in, with Google as an optional
linked identity for the same account. Authentication and storage are independent:
a Google sign-in must not require a Google Sheet. Keep the local-only PWA and
existing Sheets installations working while the new backend is built.

This introduces a stateful backend. The Pi will hold family/health records,
identity keys and session records, so it will need persistent storage, backups,
restore drills, monitoring and an explicit upgrade process. GitHub Pages can
continue serving the legacy PWA; the first internal-backend deployment should
serve the PWA and API on one HTTPS origin to simplify browser sessions.

### Implemented foundation

- `src/server/internal/types.ts`: stable account ids, memberships, principal,
  identity-provider and storage-provider types. Accounts are separate from care
  profiles; email is neither an account id nor permission to join a family.
- `authorization.ts`: deny-by-default family policy, distinct from the PWA's
  offline view selection. Checks the verified account, active membership and
  unarchived parent/caregiver profile in the requested family. Caregivers only
  qualify for child Home, Key info and permitted new child entries.
- `schema.sql`: SQLite v1 tables for accounts, linked identities, passkeys,
  sessions, families, profiles, records, memberships, change cursors and operation
  receipts. Family-scoped keys/foreign keys and a no-profile-deletion trigger
  provide structural protection. JSON preserves existing domain fields.
- `database.ts`: explicit database opening, foreign keys, WAL, busy timeout,
  transactional schema initialization and a migration checksum. Reopening keeps
  existing data; unknown/changed migrations fail rather than rewriting history.
- Tests cover identity uniqueness, cross-family membership, profile retention,
  rollback, persistence, schema mismatch and authorization denial cases.

**This is not an enabled backend.** Nothing imports it from the running HTTP
server, no credentials can be registered, and no new production data is written.
The existing Google/Sheets and device-token flows retain their behavior.
`openInternalDatabase(path)` is a development API, not a migration command or
production server. Use Node 24 (the repo's CI/runtime baseline). Node's bundled
SQLite avoids native npm builds on the Pi, but its API maturity must be reviewed
against the pinned Node version before production; the local Node 24.0 runtime
emits an experimental warning. See [Node 24 SQLite documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html).

```bash
npm run test:internal
npm run lint
npm test
npm run build
npm run build:server
```

Validation on 2026-10-16: all 583 tests (including 10 new foundation tests),
ESLint, the production PWA build and the Pi API build passed. The PWA output and
Pi bundle remain unchanged because the foundation is not wired into either
runtime. The existing web bundle-size advisory and local SQLite experimental
warning remain. `.github/workflows/checks.yml` runs these checks on PRs and main;
the hosted workflow itself has not yet run.

The SQL file is imported as raw text by Vite for tests. Vite 5 predates
`node:sqlite`, so the implementation loads that Node built-in with `createRequire`.
Do not import this module into browser code. An eventual dedicated server build
must bundle the SQL, preserve Node built-ins, and target the selected Node 24
runtime. No Android code or reference data changes are needed for this phase.

## Identity and sign-in design

An **account** is a BabySteps user. A **profile** is a child, parent or caregiver
in one family's care log. A **membership** connects an account to a family and
its parent/caregiver profile. One account can belong to multiple families;
children do not need accounts. Existing profile `email` stays contact data.
For internal families, access comes from membership, never an email comparison.

Use opaque random account/family ids, not names or spreadsheet ids. Legacy
Sheets retain their current ids until migration; `families.legacy_sheet_id`
records provenance, not a live second writer. `FamilyStorageProvider` is a
contract for future routing, not a currently selectable setting. Keep a family's
storage mode explicit. A sign-in failure must never silently route to Sheets or
a different family's cached database.

### Primary sign-in: passkeys

Use a maintained WebAuthn server implementation; do not implement the signature
protocol in application code. Use discoverable credentials and require user
verification. The server issues a short-lived, single-use challenge and checks
challenge, RP id, allowed origin, signature and user verification on completion.
Persist challenges and consume them atomically; the current schema does not yet
include a challenge table. Record credentials/public keys, never private keys.
Support multiple passkeys and credential revocation. Treat signature counters
according to the verifier's synced-passkey guidance rather than assuming every
counter regression is an attack.

Choose the permanent HTTPS hostname/RP id before enrolling real users; moving
origins later affects credentials. Android Credential Manager needs the matching
Digital Asset Links configuration and allowed native origins; watch support
may use phone-assisted device enrollment rather than typing credentials.

Account recovery is part of the first usable release: recovery codes stored as
hashes, a second passkey, notification of credential changes, and a clear
lost-all-devices process. Never let possession of a family invite alone recover
an existing account. Recovery/reset endpoints require throttling and generic
responses. Password login is not part of v1; if required later, introduce a
reviewed password/recovery flow with Argon2id and breached-password controls,
not a homemade password hash in the profile JSON.

These decisions follow [OWASP's passkey guidance](https://cheatsheetseries.owasp.org/cheatsheets/Passkey_Security_Cheat_Sheet.html).
The authentication library and recovery delivery mechanism remain to be selected
and pinned in the first implementation PR.

### Optional Google sign-in

Verify Google's OIDC token signature, issuer, audience, expiry and nonce on the
server. Link the verified stable `sub` to a BabySteps account using a fixed
trusted issuer configuration; email is display/contact information. Existing
Sheets OAuth access tokens and the token broker's refresh tokens are not a
BabySteps session or proof of membership.

Link Google only while signed into the intended BabySteps account with recent
reauthentication. Never auto-link two accounts just because Google reports the
same email. The unique `(provider, subject)` key prevents duplicate ownership;
a conflict needs an explicit recovery/account-merge process. Do not unlink the
last usable sign-in method. Google login for an already linked account issues
the same BabySteps session as passkey login. Sheets import/export requests
additional Google permissions separately; normal internal sign-in needs no
Drive or Sheets scopes.

### Sessions and unattended devices

For the same-origin PWA, use random opaque sessions in a `Secure`, `HttpOnly`,
`SameSite=Lax`, host-only cookie (prefer `__Host-` with `Path=/`). Store only a
cryptographic digest on the server. Apply idle and absolute expiry, session
rotation, revocation and recent-auth checks for sensitive account operations.
Cookie-authenticated writes need Origin checks and CSRF protection; SameSite
alone is insufficient. Never store browser session/refresh tokens in localStorage.

Android uses short-lived access credentials and rotated refresh credentials,
protected with Keystore-backed storage. Browser cookie sessions must not be
accepted as arbitrary long-lived native bearer credentials. Define separate
credential tables/handlers for refresh rotation and reuse detection; the
foundation's session table is not that protocol. Bind refreshes to installation
and account, with per-device listing/revocation. Sign-out clears that account's
UI state and stops syncing; never silently sends its outbox under another account.

Nursery phones, watches and voice assistants need separately revocable,
family-bound device credentials with explicit capabilities. For example nursery
metadata delivery does not grant export/edit of the care log. Store credential
hashes, provide rotation and record last use. Existing shared bearer tokens
remain on the legacy routes during migration and must never grant access to new
multi-family routes. Device credentials, challenges, invitations, recovery,
audit records and refresh families still need schema migrations.

See [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
and [CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

## Database, authorization and sync

SQLite is the initial choice for one Pi/server process on local persistent disk.
Use parameterized queries, WAL, foreign keys and transactions. Keep the file
outside release directories, e.g. `.babysteps/internal.sqlite` for development
and a mounted `/var/lib/babysteps` directory in production. Do not use network
filesystems or copy only the live `.sqlite` file while ignoring WAL. Use an
online SQLite backup or a controlled checkpoint/stop and verify a restore.
PostgreSQL becomes an option if multi-instance hosting or measured write load
requires it; a database adapter can change without changing account ids.

### Rules for the repository and API adapter

The new repository must implement a family-bound `BabyTrackerStore` adapter or
an equivalent server repository boundary. Instantiate it only after resolving
server-side identity/membership. The current `BabyTrackerStore` type lives with
Dexie in `storage/store.ts`; extract its contracts to a neutral file before
reusing them in the internal server. Never use the browser Dexie store as a
server-side fallback. A SQL schema is not yet a complete persistence adapter.

Every query includes authenticated family scope, including reads by record id,
export, reports, nursery rows and retries. Fetch live actor/profile/membership
state for authorization. SQLite has no built-in row-level authorization here;
foreign keys cannot replace scoped queries. Before writing an event, validate
its `babyId` belongs to the family and the operation-specific payload. Do not
accept actor/account ids, roles or revisions as trusted request claims.

`canPerformFamilyAction` does not project response fields, verify a cookie, or
validate an event payload. Future handlers must do all three. Caregiver Home
responses must return only necessary child data, never a full `TrackerExport`
filtered on the client. Do not expose parent records, full histories, lists,
contact/account directories or settings through those responses. Stamp new
caregiver entries from verified membership; parent attribution choices can name
only current authorized family caregivers. Enforce archive/restore rules and
prevent revoking the last parent in the membership service.

A write transaction must atomically:

1. Check current authorization and expected revision.
2. Check the operation receipt, scoped to family and actor. Reject operation-id
   reuse with a different request hash or actor; otherwise return the same result.
3. Apply the validated mutation, increment revision and append its change row.
4. Save the operation receipt/result, then commit.

A partial failure rolls back all four. The foundation supplies tables and
constraints, not this write service. Emit tombstones for removed entries/list
items; profiles are archived and retain every field/entry. Reject stale edits
with a conflict response; never silently overwrite another device's newer row.

Add a versioned API such as `/api/v1/families/:familyId/...`. Define bootstrap,
scoped caregiver reads, mutation envelopes, paginated changes and conflict
responses as shared JSON contracts/test fixtures for TypeScript and Kotlin.
Envelopes need operation id, expected revision and payload; responses need
canonical revision and opaque cursor. Pagination must have a snapshot high-water
mark so concurrent writes do not skip rows. Filter cursors by family and
permissions; expired/pruned cursors trigger a scoped full bootstrap. Define
receipt/tombstone retention around the longest supported offline interval.
Keep sensitive values out of URLs and request logs.

Offline storage remains on each device. Namespace new caches/outboxes by
**server deployment + account + family + backend**. Existing `babysteps` and
`babysteps-<sheet>` databases remain unchanged until explicitly migrated. Queue
writes with original ids/timestamps; authorization is checked again on reconnect.
Revoked caregivers can retain data previously cached on their device; offline
revocation is not remote erasure. Offer an explicit pending-changes export when
expired/revoked credentials prevent sync, without showing another account's data.

## Migration and rollout plan

| Phase | Work | Completion gate |
| --- | --- | --- |
| 0 — foundation (this change) | Identity contracts, policy, schema/migration runner, tests and plan | No production routing change; web checks and foundation tests pass |
| 1 — repository | Family-scoped SQL adapter, validators, revision/idempotent mutation service, change feed and migration tooling | Contract tests against real SQLite; rollback/retry/cross-family/archival cases |
| 2 — accounts | Passkeys, challenges, recovery, sessions, optional Google linking, memberships/invites, bootstrap ownership | End-to-end registration/login/logout/recovery/linking; CSRF/replay/throttle/revocation tests |
| 3 — API and PWA | Versioned authenticated API, scoped caregiver projections, independent auth/store selection and offline outbox | Parent/caregiver/no-membership matrix; account/family switch isolation; offline conflict/retry tests |
| 4 — native clients | Android sign-in/Keystore, attribution, caregiver view, device enrollment and watch migration | Emulator and dedicated-device tests; legacy clients still work on legacy families |
| 5 — family migration | Dry run, signed-in owner confirmation, backup, import and controlled cutover | Counts/ids/fields validated; no concurrent Sheets/internal writers; restore drill passes |
| 6 — operations | Persistent Pi deployment, encrypted backups off-device, monitoring, upgrades and release/rollback runbooks | Fresh-host restore, restart/redeploy durability and credential revocation rehearsed |

Phases 1/2 can develop behind an explicit opt-in, but do not enable family
cutover until phases 3–6 meet their gates. Phase 6 operational preparation starts
before production data arrives. Production configuration must fail closed when
the database or auth setup is unavailable, not boot a blank family or fall back
to the old shared-token server.

### Moving an existing family from Sheets

1. Require a verified BabySteps account and proof of authority over the source
   family. Reauthenticate; never use the old email-only "I'm this parent" claim
   flow or a sheet id as proof. Decide which existing parent profiles map to
   which accounts, with explicit invitation acceptance for other people.
2. Export all profiles (including archived ones), events, lists and nursery data.
   `TrackerExport` does not include nursery data or pending client outboxes;
   capture those separately. Preserve unknown JSON fields, UTC timestamps, old
   event variants and original ids. Back up the source before migration.
3. Dry-run an import with an explicit old-sheet → new-family mapping. Rewrite
   only family ownership metadata, preserve profile/event ids and links, validate
   references and summaries, and issue a report. Deduplicate imported rows and
   record migration provenance so rerunning cannot duplicate records or accounts.
   An email is a proposed invitation contact, not automatically a membership.
4. Drain queues on known devices, schedule a cutover window and stop legacy
   writes (including voice, watch and nursery delivery). Take a final export and
   import it transactionally. New family ids never reuse sheet ids.
5. Point one test installation at the internal family, verify domain reports and
   offline round trips, then reconnect other clients through explicit enrollment.
   Preserve legacy local databases and exports until validation is complete.
6. Make Sheets a historical snapshot or an explicit one-way export. Do not
   dual-write or perform unsupervised bidirectional merging. Google authentication
   can remain linked even when the Sheet is no longer used.

Before the first internal write, rollback can restore legacy routing. After
internal writes, switching back to an old Sheet loses changes: pause writes,
export and reconcile internal changes into a validated recovery dataset before
returning to Sheets. Never silently "roll back" by discarding the SQL database.
Old clients require an explicit compatibility/upgrade policy; do not aim the
legacy full-family Android export endpoint at a new multi-family database.

## Future development checklist for humans and agents

- Keep auth libraries pinned and use established WebAuthn/OIDC verification;
  select the Google client configuration for native/web audiences explicitly.
- Keep stable account membership separate from the legacy PWA `getAccess` view.
  Do not describe today's Google caregiver view as server-enforced security.
- Add numbered, forward-only schema migrations; never edit an applied migration.
  Each migration needs a populated-database upgrade test and backup/restore notes.
- Add encrypted backup retention/restore, disk-capacity alerts, API health checks,
  rate limiting and session/credential audit logging without health-record bodies.
- Specify enrollment/recovery, last-parent protection, invitation expiry/replay,
  session/refresh expiry, account unlink/merge and deletion/retention policy before
  exposing their endpoints. Account credential revocation must not delete a person.
- Add HTTP-level denial tests: foreign-family ids, forged actor fields, stale
  cookies, revoked memberships, archived actors, changed operation payloads,
  concurrent edits, malformed payloads and caregiver response-field leaks.
- Extend cross-platform contract fixtures to phone/watch; do not make a Kotlin
  UI migration a prerequisite for the account/database transition.
- Update the existing Pi installer/updater in the separate `rpi` repo: persistent
  volumes, Node runtime pin, new reverse-proxy routes, migrations before readiness,
  secrets, ownership/permissions and health probes. Its files are outside this
  change. Existing stateless-release installation cannot safely deploy stateful
  storage without these changes.
- Revisit hosting if availability needs exceed a single Pi. Document uptime,
  ownership, data location and recovery expectations before offering this beyond
  the household. Google Sheets remains a supported legacy deployment mode until
  a separate, explicit retirement decision.
