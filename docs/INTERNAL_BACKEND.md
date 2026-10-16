# BabySteps internal accounts and database

## Implementation and rollout status

The optional internal backend is implemented in this repository: BabySteps-owned
accounts, passkeys, optional linked Google sign-in, SQLite persistence, a
versioned API, an offline PWA, and account enrollment for phone/watch/nursery.
The normal build still uses the existing local/Sheets path. Enable the new PWA
explicitly with `VITE_INTERNAL_API=/api/v1`; run its separate backend on the same
HTTPS origin. No existing family is migrated by starting either build.

The permanent passkey hostname approved for this household is
`raspberrypi.tailc2b8e3.ts.net`; the deployment example uses its current `:8443`
HTTPS origin. Passkeys bind to the hostname, while verification checks the exact
origin including port. Keep these values stable once people enroll.

| Phase | Repository deliverable | Remaining rollout gate |
| --- | --- | --- |
| 0 — foundations | Independent account/family ids, schema ledger, policy and contracts | Complete locally |
| 1 — repository | Family-scoped snapshots, validated mutations, revisions, atomic receipts/change feed, archives and migration tools | Complete locally; source migration is separate |
| 2 — accounts | Passkeys, recovery, sessions, Google linking, invitations, device enrollment and audit activity | Live Google consent/client configuration and household enrollment |
| 3 — API/PWA | `/api/v1`, server caregiver projection, isolated IndexedDB/outbox, conflict controls and existing care screens | Stage the opt-in build on the approved Pi origin |
| 4 — Android/Wear | Shared encrypted credential client, scoped enrollment/rotation, phone caregiver view, watch logging, nursery delivery | Rehearse the complete flow on dedicated phone/watch hardware; Keystore tested on emulator |
| 5 — migration | Dry-run/import fingerprinting, atomic fresh-family import, online backup/integrity/export tools | Owner must enroll, approve mappings, pause legacy writers and validate real family totals |
| 6 — operations | Docker/Compose, proxy examples, persistent-volume/backup/restore/upgrade runbook | Pi installation, off-device encrypted backup schedule and separate `rpi` updater adoption |

These gates distinguish implemented code from production cutover. Local tests
cannot prove a Google account's external configuration, a physical watch's UI,
or a household's recovery/backup arrangements. Do not mark the live migration
complete until those steps have been performed. See the concrete
[deployment and cutover runbook](../deployment/internal/README.md).

## Build and development

Use Node 24. Dependencies are pinned for SimpleWebAuthn (browser/server) and jose.
The built-in Node SQLite API emits an experimental warning on local Node 24.0;
review the exact Node patch/image in deployment and keep it updated.

```bash
npm ci
npm run lint
npm test
npm run build
npm run build:server
npm run build:internal
npm run test:e2e
```

The internal server and CLI bundle to `dist-internal/`, including shared chunks.
Deploy the whole directory, not just `internal-api.mjs`. Existing Pi events API
and token-broker artifacts remain independent. To build the internal PWA:

```bash
VITE_INTERNAL_API=/api/v1 npm run build -- --base /internal/
```

For a development server, set that variable and proxy `/api/v1` to the internal
server on loopback behind HTTPS. The automated browser test creates a temporary
localhost certificate, fresh SQLite database and virtual passkey authenticator;
it never uses a household account or production credentials. On Linux install
Chromium once with `npx playwright install --with-deps chromium`. CI runs this
alongside the web/API checks.

Runtime configuration:

| Variable | Meaning |
| --- | --- |
| `BABYSTEPS_DATABASE_PATH` | Required persistent SQLite path, outside static/release directories |
| `BABYSTEPS_ORIGIN` | Required exact HTTPS origin for Origin/WebAuthn checks |
| `BABYSTEPS_RP_ID` | Required passkey relying-party hostname |
| `BABYSTEPS_BOOTSTRAP_TOKEN_HASH` | Optional SHA-256 hash of a private first-account setup token; usable only before any account exists |
| `BABYSTEPS_REGISTRATION_OPEN` | `true` permits open signup; otherwise a valid invitation is required for a new account |
| `BABYSTEPS_GOOGLE_CLIENT_ID` | Optional Google OIDC web client id; no Sheets/Drive scopes needed |
| `HOST`, `PORT` | Default loopback `127.0.0.1:8790`; container sets host `0.0.0.0` behind a loopback-only published port |

Do not expose this API as a public plain-HTTP service. Configuration and database
failures stop startup rather than choosing an empty family or Sheets fallback.
The health endpoint returns ready only after opening/migrating the database.

## Code map

| Path | Responsibility |
| --- | --- |
| `src/storage/contracts.ts` | Type-only store interfaces, independent of Dexie |
| `src/domain/internalApi.ts` | Shared mutation/bootstrap wire contracts |
| `src/server/internal/database.ts` | SQLite configuration and checksum-verified forward migrations |
| `schema.sql`, `migrations/*.sql` | Accounts, credentials, families, memberships, records, receipts and sync metadata |
| `authorization.ts` | Deny-by-default membership/actor policy; separate from legacy `getAccess` |
| `validation.ts` | JSON merge-patch semantics and document validation |
| `familyRepository.ts` | Family-bound reads, mutations, projections, revisions and change cursors |
| `accounts.ts` | WebAuthn/OIDC verification, sessions, recovery, invites and native credential rotation |
| `httpApi.ts`, `main.ts` | Origin/CSRF/body/rate limits, authenticated routes and Node adapter |
| `migration.ts`, `tool.ts` | Reviewed dry-run/import, backup, integrity and operator export |
| `src/storage/internalClient.ts` | Account-bound requests, isolated cache/outbox and conflict recovery |
| `src/InternalApp.tsx` | Opt-in PWA using the existing tracking screens |
| `android/internal-client/` | Shared phone/watch Keystore, enrollment and mutation mapping |
| `deployment/internal/` | Opt-in stateful hosting and cutover instructions |

## Local verification record

Verified on 2026-10-16 with synthetic accounts and records:

- ESLint and all 612 tests across 69 Vitest files pass.
- Legacy PWA, opt-in `/internal/` PWA, legacy Pi API and internal API/tool builds pass.
- Browser acceptance passes with a virtual passkey: registration/login/recovery,
  offline queued writes, revision conflicts, caregiver isolation, SQLite online
  backup/restore checks and desktop/mobile layout checks.
- Phone/watch/shared-client builds and lint pass; 67 JVM tests and one emulator
  Android Keystore instrumentation test pass. No household device was reinstalled.

These checks do not substitute for the live rollout gates above. CI repeats the
web/API/browser checks and Android builds, lint and JVM tests. Keystore emulator
instrumentation is a local check; physical-device rehearsal remains required.

## Identity, membership and access

An account is a BabySteps identity. A profile remains a child, parent or
caregiver in a particular family's log. A membership links an account to a
parent/caregiver profile in one family. Children need no accounts. One account
can join several families; each membership is checked independently.

Internal account and family ids are opaque, independent of Google email and
spreadsheet ids. Email stays contact data. Legacy families retain their current
spreadsheet ids until migration; `legacy_sheet_id` records provenance, never a
second live writer. A Google sign-in method does not select Google storage.

A verified principal is constructed only after session validation. Repository
calls re-read the account, membership and actor profile in their transaction.
Disabled accounts, revoked memberships and archived actors are denied, including
operation retries. Every SQL lookup includes family scope; SQLite foreign keys
alone are not authorization. The last active, linked parent cannot be archived.
Profile rows cannot be deleted; archive/restore keep their fields and entries.

Parents receive full family data. Caregiver bootstrap responses contain only
active child profiles, permitted key info and limited Home summary entries;
they exclude parent records, household lists and private entry notes. Caregivers
can create permitted child entries, never births, edit/delete operations or full
exports/history. Attribution is stamped from live membership. Watch responses
are narrower still: child identity and feed/diaper/sleep status, without care-info
addresses. The legacy Sheets caregiver view remains a UI view, not a server
security boundary.

## Authentication and recovery

WebAuthn ceremonies use SimpleWebAuthn, requiring discoverable credentials and
user verification. Challenges expire after five minutes, are tied to an HttpOnly
browser flow cookie and purpose, and are consumed once. The server verifies
challenge, RP id, exact origin and signatures. Store public keys and counters,
never private keys. Support additional passkeys and revocation; the last usable
passkey/Google sign-in method cannot be revoked through ordinary management.

Registration shows ten high-entropy recovery codes once, along with the account
id. Only digests are stored. Download and keep these somewhere private and
independent of the Pi. Recovery consumes one code, revokes existing sessions,
passkeys, Google linking and native installations, and opens a fresh session for
adding a new passkey. Remaining codes survive a lost response. The Account page
shows recent security activity; no outbound email service is required. Lost
passkeys plus lost recovery codes require an operator-reviewed identity process;
there is deliberately no email-only account takeover shortcut.

Browser sessions are opaque random tokens in Secure/HttpOnly/host-only cookies,
with separate CSRF tokens, Origin checks, seven-day idle and thirty-day absolute
expiry. Sensitive credential/invite actions require authentication within ten
minutes. Account settings expose session/device revocation. Session tokens are
not stored in localStorage. The PWA binds mutation requests to the original
account as well as family, preventing an old outbox from being sent under a new
browser login.

Google is optional: explicitly link it from Account while recently signed into
BabySteps. jose verifies Google issuer, audience, expiry, nonce and signature
against Google's keys. The stable `sub` identifies the link; matching emails
never link accounts. A linked Google login issues the same BabySteps browser
session. Sheets OAuth grants and refresh tokens are not BabySteps sessions.
A real Google sign-in requires the operator to configure the OAuth client for
the approved origin; browser acceptance tests do not impersonate a Google user.

References: [SimpleWebAuthn server](https://simplewebauthn.dev/docs/packages/server),
[OWASP passkeys](https://cheatsheetseries.owasp.org/cheatsheets/Passkey_Security_Cheat_Sheet.html),
[session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
[Node SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html),
[Google OIDC verification](https://developers.google.com/identity/openid-connect/openid-connect).

## Native enrollment and unattended devices

Phone, watch and nursery use a device-code flow: begin on the device, sign in
with a passkey in the browser, review the requested device purpose and selected
family in Account, approve, then finish on the device. No password or Google
credential goes through a watch keyboard. The browser passkey provides the
primary authentication; native code exchanges a one-use, expiring device grant.

Access tokens expire after fifteen minutes. Refresh tokens rotate, are stored as
server-side hashes and expire after ninety days. Reuse revokes the installation;
a lost refresh response may require re-enrollment, while queued records remain
safe. Device revocation also prevents refresh. Android credentials, including
legacy token migration, use AES-GCM with a non-exportable Keystore key. A missing
or corrupted key fails closed. Watch/phone queues and timers are scoped to their
account/family; switching or disconnecting does not send an old queue as someone
else. Legacy mode requires an explicit choice.

Capabilities are bound server-side to installation and family:

- Phone: the signed-in member's parent/caregiver permissions.
- Watch: limited status plus new feeds/diapers; no profile/list edits or exports.
- Nursery: validated numeric/classification metadata delivery and minimal latest
  care status; no care-log mutation/export. It uses a separate credential and
  family-specific nursery SQLite file. Stop monitoring before changing families.

The nursery batch validator rejects audio, transcripts and unexpected fields.
Server keys incorporate the enrolled device identity, so one device cannot overwrite
another's metadata by choosing its record key. Re-enrolling the same device under
the same account/family rotates its credential chain while retaining metadata
identity, so earlier nights are not duplicated. Repeated payloads are idempotent.
The old voice/nursery/app bearer tokens still work only on their legacy server;
they grant no internal membership. Voice assistants can use the constrained
watch enrollment/mutation contract for feeds/diapers; broader voice actions need
an explicitly designed capability extension.

## Persistence and offline sync

SQLite uses WAL, foreign keys, busy timeout and parameterized queries. Migrations
run in one transaction and are recorded with checksums. Never edit an applied
migration; append another and test a populated upgrade. Server/tool processes
use a private umask. Database files belong in persistent local volumes, not
network filesystems, Git, static hosting or rolling release directories.

Each mutation has a family-scoped operation id, expected revision and merge
patch. Omitted fields survive older clients; `null` explicitly clears an optional
field. The server stamps canonical attribution/timestamps and checks referenced
profiles. Data, revision, change invalidation and retry receipt commit together.
A birth updates the child's date in that same transaction and returns its related
profile revision. Stale edits return conflict; removed entries/list rows retain
tombstones and cannot silently resurrect. People are always archived.

Bootstrap returns data, revisions and a cursor from one read transaction.
Change pagination pins a high-water mark; completed cursors can poll for later
writes. Feed rows are invalidations, not historical payload snapshots: clients
refresh current bootstrap data after a change. An explicitly expired cursor
returns 410 and triggers a new bootstrap. Initial retention is conservative:
receipts, tombstones and change rows are kept, with no automatic pruning. Define
and test a maximum offline interval before introducing pruning; do not remove
receipts simply to save space. This favors correctness at the household's
current volume over premature storage cleanup.

PWA caches/outboxes are namespaced by deployment/API base, account and family.
The service worker bypasses APIs entirely and separates root/staged app shells.
Offline writes retain original ids, timestamps and operation ids. Conflicts stay
queued for explicit retry against the latest version or discard; export is
available. Reconnect always rechecks authorization. Revocation cannot remotely
erase data already cached on an offline device; sign-out hides that account's
screen and retains its pending data in its own namespace.

## Safe migration and operations

Use [the runbook](../deployment/internal/README.md) for exact commands. The CLI
supports `migrate-schema`, `migrate`, `backup`, `restore-check` and `export`.
Migration only targets a fresh internal family, validates references, preserves
ids/archived people/unknown fields and records a source fingerprint for retries.
Nursery data and pending device outboxes are separate from `TrackerExport` and
must be handled explicitly. Only the explicitly verified owner is linked;
other members accept invitations, never email-matched claims.

Before applying a real import: establish source authority, review ownership
mapping, take backups, drain queues, and pause every legacy writer. Applying
requires `--apply --source-paused`; these flags record the operator's assertion,
not proof the remote Sheet is actually paused. Compare family/report totals
before switching clients. Do not dual-write Sheets and SQLite.

The repository contains opt-in Docker/Compose/proxy assets and backup/restore
procedures. Production still needs persistent-volume installation, encrypted
backups off the Pi, scheduling/alerts, dedicated-device rehearsal and adoption
by the separate `rpi` updater. Before internal writes, legacy routing can be
restored. After internal writes, pause/export/reconcile first: an older Sheet is
not a current backup. An older binary may reject a newer schema, so test rollback
with copied volumes and keep backups/builds together.

## Future work after rollout

- Measure full-bootstrap cost after invalidations; add revisioned record fetches
  if it materially improves polling, without weakening cursor consistency.
- Add bounded retention/cleanup with expired-cursor and long-offline tests.
- Add more native UI/device tests, account/device naming and credential-change
  notification delivery if an operator chooses a contact provider.
- Add a dedicated voice capability beyond the current feed/diaper contract and
  complete its Home Assistant enrollment flow before retiring legacy voice routes.
- Review server hosting/availability if use grows beyond one household/Pi; a
  PostgreSQL adapter can preserve account/family ids if multi-host operation is needed.
- Keep Kotlin UI sharing separate from this backend transition; the staged
  Multiplatform trial in the monorepo plan remains future work.
