# The Babysteps app (native Android)

How the phone app is built, how it reaches the family log, how to ship a
change, and what is worth doing next. The root README's "Babysteps app" section
is the one-screen summary; this is the long form.

## What it is

The `:app` module is two things in one APK (`com.babysteps.nurserysensor`,
label "Babysteps"):

- **Babysteps** — the web app (`src/` in the repo root) rebuilt in Jetpack
  Compose: Home, Log, Reports, Care, Shopping, To-do, Settings and Learn, for
  every child and parent on the family sheet.
- **Nursery** — the existing sound monitor (foreground service, YAMNet
  classification, nightly summaries), now one tab of the app. It is the only
  tab the web app does not have.

## Current optional internal path

The phone/watch can now enroll a BabySteps account through a passkey-authenticated
browser device code. Their shared `android/internal-client` library handles
Keystore-backed credentials, short access-token rotation and server/family/account
isolation. Phone caregivers receive a scoped view and server-stamped attribution;
watch and nursery credentials have narrower capabilities. See
[the internal backend guide](INTERNAL_BACKEND.md) for implementation and rollout
status. It remains opt-in; existing shared-token installations keep working.

The architecture below describes that existing **legacy Sheets path**. Its
Google-only future-auth sequence is historical context, not the new primary plan.

## How the legacy phone reaches the data

```
phone ──HTTPS + Bearer APP_API_TOKEN──▶ Pi (Funnel :8443, nginx /api/events)
                                         └─ babysteps-events container
                                              └─ service account ─▶ family Google Sheet
```

- `GET  /api/events/app` — the whole tracker (profiles, entries, shopping,
  tasks), gzipped. The phone filters per person itself.
- `GET  /api/events/app/nursery` — the sensor's nights and cry episodes, for
  Reports → Night & Day.
- `POST /api/events/app` — `{ op, ... }`, one store call: `addEvent`,
  `updateEvent`, `deleteEvent`, `addProfile`, `saveProfile`, `archiveProfile`,
  `restoreProfile`, `saveShoppingItem`, `removeShoppingItem`, `saveTask`,
  `removeTask`.

Server: babysteps `src/server/appApi.ts` (tests in `appApi.test.ts`). Client:
`care/data/CareRepository.kt`. **Change the op list in both together.**

The token is separate from `EVENTS_API_TOKEN` (which voice assistants and the
watch hold) because this one can edit and delete. It lives in the Pi's
`~/babysteps/events.env` and in the phone's private prefs (`babysteps-app`).

## Code map (`app/src/main/java/com/babysteps/nurserysensor/care`)

Paths in this map and Gradle commands below are relative to `android/`. Web
counterparts are under the repo root `src/`. See [the monorepo plan](MONOREPO.md)
for the cross-platform workflow and Kotlin web migration gates.

| Path | What | Web counterpart |
|---|---|---|
| `model/Model.kt` | `CareEvent`, `Profile`, `ShoppingItem`, `TaskItem`, `Tracker` — JSON-backed, so an edit keeps fields this app does not know | `domain/types.ts`, `legacyEvents.ts` |
| `domain/Dates.kt` | day keys, clocks, durations, ages, units, temperature | `dates.ts`, `units.ts`, `temperature.ts` |
| `domain/Reference.kt` | the bundled CSVs | `reference.ts`, `data/referenceSheets.ts` |
| `domain/Care.kt` | family, diaper details, daily summary, diaper prediction, cadence | `family.ts`, `diaperDetails.ts`, `summary.ts`, `diapers.ts`, `cadence.ts` |
| `domain/Growth.kt` | WHO standards, gestation, newborn check, first-year analytics, date ranges, check-up span | `growth/*`, `firstYear.ts`, `dateRange.ts`, `checkup.ts` |
| `domain/Expect.kt` | what to expect, cycle, inputs/outputs, parent report | `whatToExpect.ts`, `cycle.ts`, `intakeOutput.ts`, `parentReport.ts` |
| `domain/Nights.kt` | Night & Day, cry context, feed clock, feed order, nursery data | `babyNights.ts`, `cryContext.ts`, `feedClock.ts`, `feedOrder.ts`, `nurserySensor.ts` |
| `domain/Lists.kt` | shopping, tasks, timeline text, emergency guides | `shopping.ts`, `tasks.ts`, `Timeline.tsx`, `emergency.ts` |
| `data/` | Pi client + outbox, device prefs (active person, "logged by", feed tab, theme, timers) | `storage/*`, `localStorage` |
| `ui/` | one file per screen, plus `Components`, `Theme`, `Icons`, `AppShell` | `components/*`, `styles.css` |

Each domain object names the TypeScript module it ports. When the web app's
logic changes, port the change to the same object and add a case to
`app/src/test/.../care/CareDomainTest.kt`.

### Web display parity — Android 0.6.1 (October 17, 2026)

The native phone/tablet UI now follows the recent PWA changes: newest-first Log,
Home and Reports timelines; exact-type hero links; compact icon/sync header;
aligned hero readings; main advice tips in banners with notes collapsed; visible
growth percentiles with age comparison collapsed; full-width charts; simpler
Night & Day sections; and separate Settings and Account tasks.

`Cadence` ends the bath window strictly after the original local bath time three
calendar days later, including DST changes. Elapsed readings highlight the
window; whole cards highlight only after its end. `Diapers` allows an overnight
latest boundary of the earlier of eight elapsed hours since the last change or
7am, while the device-local clock is between 7pm and 7am. At 7am the learned
daytime window resumes. These are household display preferences, not clinical
advice. Predictions remain unavailable without sufficient history. Matching
boundary cases live in `CareDomainTest.kt`.

Account pairs this device with the internal backend. Passkeys, optional Google
linking, recovery, sessions and family invitations use the existing secured
website; they are not new native authentication flows. The advanced shared-token
form stays collapsed. Sync flushes the account-scoped outbox before fetching the
full snapshot, both manually and when returning to the foreground. It never
copies another account's cache or queue.

The emulator-only `CareParityDeviceTest` uses a synthetic offline family. Build
its APK with `:app:assembleDebugAndroidTest`, then install/run it with an explicit
`adb -s emulator-SERIAL` target and the test class filter. Its device guard refuses
household hardware. Never run a whole connected-test suite on the nursery phone
or family tablet. Wear's compact UI has no equivalent report/settings layouts;
no watch installation is part of this release.

### Writes and offline

Every change is applied on screen at once and appended to a durable outbox
(prefs `babysteps-app-state`), then sent in order. A 401/429/5xx or no network
keeps it queued; a 400 or 409 (e.g. editing an entry deleted elsewhere) drops
it and shows "Not saved". The phone names new entry, shopping and task ids, and
the Pi returns the existing row for a repeated `addEvent`, so a retry after a
lost reply never writes twice. The last full read is cached in
`files/babysteps-tracker.json`, so the app opens with no signal. Reads poll
every 45 s while the app is in front, like the web app.

### Assets kept in step with the web app

- Reference CSVs are generated build assets from the canonical root
  `src/data/reference/*.csv`. Gradle packages them as `assets/reference/`; JVM
  tests read that same source directory. No refresh command or checked-in copies.
- `ui/Icons.kt` — Lucide paths generated from the web app's
  `node_modules/lucide-react/dist/esm/icons` (shapes converted to path data).
  The original generator was not committed. For now update the matching Kotlin
  vector explicitly when adding an icon; keep the Lucide license notice. A
  reproducible generator remains follow-up work.
- `res/font/` — Quicksand and Fraunces variable fonts (OFL, licences in
  `assets/licenses`).
- Launcher icon — the web app's `public/icons/maskable-512.png` as an adaptive
  icon on its cream background.

## Build and test

```bash
cd android # from the monorepo root
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME=~/Library/Android/sdk
./gradlew :app:testDebugUnitTest :wear:testDebugUnitTest :app:lintDebug :wear:lintDebug :app:assembleDebug :wear:assembleDebug
adb -s YOUR_PHONE_SERIAL install -r app/build/outputs/apk/debug/app-debug.apk
```

- **Installing on the nursery phone restarts the app.** On Android 10 the
  `RecoveryReceiver` resumes monitoring by itself on `MY_PACKAGE_REPLACED`;
  confirm with `adb shell dumpsys activity services com.babysteps.nurserysensor | grep isForeground`.
- **Try UI changes on the emulator first** (`Medium_Phone_API_37.0`, can run
  headless with `-no-window`). With no token set it shows whatever is in the
  cache file, so sample data can be pushed with
  `adb shell run-as com.babysteps.nurserysensor sh -c 'cat /data/local/tmp/t.json > files/babysteps-tracker.json'`.
  The web app's `buildFirstMonthSeed` (run with `npx vite-node` from the
  babysteps repo) makes realistic sample data.
- Server side (babysteps): `npm run lint && npm test && npm run build && npm run build:server`.

## Deploying the Pi side

- Code: push babysteps `main`; CI publishes a release and the Pi's cron
  `update.sh` installs the new `events-api.mjs` within ~5 minutes and
  restarts the container.
- **Env changes need the container recreated**, not restarted — `docker
  restart` keeps the environment it was created with. Re-run rpi
  `scripts/babysteps/install.sh`, or on the Pi: `docker rm -f babysteps-events`
  followed by the `docker run` from that script's step 5.
- `install.sh` generates `APP_API_TOKEN` once. The container log line ends
  `· app on` when the route is live.

## Future improvements

**Native authentication (the biggest gap).** The newer
[internal backend plan](INTERNAL_BACKEND.md) establishes BabySteps accounts,
passkeys and SQLite, with Google as an optional linked identity. Use that plan
for new backend work. The Google-only sequence below describes an incremental
improvement to the existing Sheets-backed deployment. Today the phone is trusted by a
single shared bearer token, and every phone with it is the full view. Better:

1. **Sign in with Google on the phone** (Credential Manager / Sign in with
   Google) and send the ID token to the Pi instead of a shared secret.
2. **The Pi verifies it** (Google's JWKS, audience = the app's OAuth client)
   and resolves the email against the family's profiles with the same
   `getAccess` rule the web app uses — parent → full, caregiver → caregiver
   view, anyone else → refused. That makes the Pi a real access check, which
   the web app cannot be.
3. **Per-person views on the phone**: honour the caregiver role (Home with
   `CAREGIVER_EVENT_TYPES`, Care's Key info and Emergency only), stamp
   `caregiverId`/`loggedBy` from the signed-in person instead of the
   remembered picker, and show "Signed in as".
4. Keep `APP_API_TOKEN` only for unattended devices (the nursery phone), or
   replace it with a device-bound credential, and rotate it from Settings.
5. Store any token with the Android Keystore rather than plain private prefs.

**Sync**

- Ask the Pi for changes since a version (or an ETag on the export) instead of
  re-reading the whole log every 45 s; the export grows by ~1,000 rows a month.
- Merge on conflict: an edit queued offline currently overwrites whatever
  another device saved to that row in the meantime.
- A sync-status screen listing queued changes, with retry and discard.

**Parity with the web app**

- Family setup, inviting and sheet sharing (Google-only today; needs native
  auth first).
- Import currently adds only rows the sheet lacks; the web import also merges.
- Night-shift backfill, if it is ever switched back on in the web app.

**Android-native extras**

- Home-screen widget and a lock-screen/ongoing timer for feeds and sleep, like
  the watch's ongoing activity.
- Notifications for the gentle reminders (feed past 3 h, bath past 3 days) and
  scheduled medications.
- Share the watch's queue and timer logic with the phone, or have the watch
  use `/api/events/app` too.
- Release signing and a versioned release build (currently a debug build).

**Engineering**

- Reference CSVs now come from the canonical monorepo source at build time.
  Add reproducible icon/op-list generation next; those are still maintained
  explicitly.
- Port more of the web app's domain tests; add Compose UI tests for the
  quick-add form and the outbox.
- Move the remaining hand-written JSON field names into one schema shared with
  `googleSheetsStore.ts`.
