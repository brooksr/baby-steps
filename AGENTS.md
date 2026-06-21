# AGENTS.md

Guidance for AI agents (and humans) working in the BabySteps repo.

## What this app is

BabySteps is an offline-first PWA for shared baby-care tracking (built around
one baby, Theo). React 18 + TypeScript + Vite, with a hybrid local
(Dexie/IndexedDB) + Google Sheets store. No backend of our own.

## Commands

```bash
npm run dev      # local dev server (host 0.0.0.0)
npm run build    # tsc -b && vite build  — must pass before shipping
npm run lint     # eslint .
npm test         # vitest run
```

Always run `npm run lint`, `npm test`, and `npm run build` before considering a
change done.

## Layout & conventions

- `src/domain/` — pure logic + data (no React). Co-located `*.test.ts`.
  - `domain/types.ts` — the `CareEvent` union is the core data model. Adding a
    new tracked thing usually starts here with a new event variant.
  - `domain/dates.ts`, `domain/summary.ts`, `domain/firstYear.ts` — derived stats.
  - `domain/growth/` — WHO standards data + assessment logic.
  - `domain/csv.ts`, `domain/reference.ts` — CSV parsing + typed reference-data accessors.
  - `domain/download.ts` — client-side file download helper.
- `src/data/reference/*.csv` — **single source of truth** for reference data.
  Imported as raw text via `?raw` in `src/data/referenceSheets.ts` (bundled, so
  it works offline). Surfaced on the Learn page. Do NOT duplicate into `public/`.
- `src/components/` — React views. `App.tsx` owns the tab router + store wiring.
- `src/storage/` — local, Google Sheets, and hybrid stores. New event fields
  must be persisted here (see `googleSheetsStore.ts` column mapping).
- Style: object keys and array entries are alphabetized; CSS is one big
  `styles.css` using CSS variables (`--font-body` Quicksand, `--font-display`
  Fraunces). Keep edits matching the surrounding idiom.

### Adding a new event type (the common path)

1. Add the variant to the `CareEvent` union + `careEventLabels` in `types.ts`.
2. Persist it: extend the row mapping in `storage/googleSheetsStore.ts` and the
   local store if needed.
3. Add a form branch in `components/QuickAddDialog.tsx` and a quick-action in
   `components/Dashboard.tsx`.
4. Fold it into `domain/summary.ts` (daily totals) and `domain/firstYear.ts`
   (trends) as appropriate.
5. Add tests next to the logic.

## Reference data already shipped

These CSVs exist in `src/data/reference/` and are parsed by typed getters in
`domain/reference.ts` — the features below mostly need UI + an event type, the
data is ready:

- `developmental-milestones.csv` → `getMilestones()`
- `temperature-ranges.csv` → `getTemperatureBands()`, `classifyTemperatureC()`
- `tummy-time-by-age.csv` → `getTummyTimeGuide()`
- `vaccination-schedule.csv` → `getVaccinationSchedule()`
- `mood-scale.csv` → `getMoodScale()`

## Staged roadmap — feasible features

Ordered so each stage unblocks the next. Stage 0 is done; later stages build on it.

### Stage 0 — Foundations (DONE)
- WHO growth standards data + charts + assessment.
- Newborn first-weeks diaper/feed range checks.
- Quicksand/Fraunces typography.
- CSV infrastructure: `parseCsv`, `CsvTable`, `downloadText`, raw-imported
  reference sheets, typed `domain/reference.ts` getters, Learn page tables.
- Reference CSVs for milestones, temperature, tummy time, vaccines, mood.

### Stage 1 — Simple manual-entry logs (DONE)
Added `temperature`, `tummytime`, and `mood` events through the full pipeline
(types → Google Sheets columns `celsius`/`moodLevel` → quick-add forms →
Timeline → Dashboard quick actions).
1. **Temperature entries** — `temperature` event stores canonical `celsius`;
   quick-add accepts °F/°C; Timeline shows band via `classifyTemperatureC()`;
   Dashboard raises a fever alert (urgent under 3 months via `getAgeDays`).
2. **Tummy time** — `tummytime` event (`durationMinutes`). _Follow-up:_ show
   daily total vs `getTummyTimeGuide()` range in Reports.
3. **Mood / fussiness** — `mood` event (`level` 1–5 from `getMoodScale()`).
   _Follow-up:_ optional mood strip in Reports.

Also shipped: the shared **family calendar** embed (`domain/calendar.ts` +
`components/FamilyCalendar.tsx`) on the Dashboard, with an "add to your Google
Calendar" subscribe link.

### Stage 2 — Checklists & schedules (DONE)
Added the **Care** tab (`components/Care.tsx`) plus `milestone` and `vaccine`
event types sharing one `refId` column in the Sheets store. Reference rows carry
stable ids (`getMilestoneById` / `getVaccinationById`); toggling a row in the
Care view adds/deletes the corresponding event via `App.handleToggleRef`.
4. **Milestone checklist** — `getMilestones()` grouped by age, age-appropriate
   rows tagged via `getAgeDays`, achieved date shown.
5. **Vaccination schedule** — `getVaccinationSchedule()` anchored to `birthDate`
   (calendar-month due dates), overdue highlighting, and next-due in the header.

Also: the shared Photos album moved from a Dashboard card to a persistent
**app header link** (`App.tsx` header + `domain/media.ts`).

## V2 — deferred

V1 is feature-complete and paused. The remaining roadmap items are deferred to a
future V2 and should not be started without an explicit go-ahead. The reference
data for several of them already ships (see `domain/reference.ts`).

### V2.1 — Inventory & richer tracking
- **Milk inventory** — track pumped-milk stash (add on pump, subtract on bottle
  from stash). New lightweight inventory store or derive from existing pump/
  bottle events. Low-stock indicator.

### V2.2 — Notifications & media (needs platform plumbing)
- **Feed & med reminders** — schedule local notifications via the service
  worker (`public/sw.js`) + Notification/Push API. Settings to configure
  intervals; respect quiet hours.
- **Photo growth journal & PDF export** — attach photos to growth/note events
  (IndexedDB blobs; Sheets stores a reference only). Generate a shareable PDF
  summary (growth charts + milestones) for the pediatrician.

### V2.3 — Collaboration
- **Multi-caregiver handoff notes** — structured shift handoff (last feed/sleep/
  diaper + free note), leaning on the existing shared Google Sheet for sync.

### V2 — also worth doing
- Tummy-time daily total vs `getTummyTimeGuide()` and a mood strip in Reports
  (the Stage 1 follow-ups).
- An explicit "Disconnect Google" control in Settings (calls `signOutGoogle()`).
- **Editable Key info** — make `domain/medicalInfo.ts` (hospital, OB, contacts,
  "to have on hand") user-editable and persisted on the profile, instead of
  hard-coded. Today it's static + a prompt list shown in the Care tab and a
  hospital-directions shortcut on the Dashboard.

## Google integrations

- **Sheets API** — already the sync backend (`storage/googleSheetsStore.ts`,
  OAuth in `googleSheetsAuth.ts`). Keep enabled.
- **Calendar** — the shared calendar is currently an *embed* + subscribe link
  (`domain/calendar.ts`), which needs no API/quota. Only enable the **Calendar
  API** (scope `calendar.events`) if we later want to read/write events in-app.
- **Photos** — shared album is a *link-out* (`domain/media.ts`); Google Photos
  blocks iframing and, since the 2025 Library API changes, there is no
  whole-album read scope. If we ever pull photos in-app, use the **Photos
  Picker API** (user-picked) rather than the Library API. For now, no API needed.

## Sample / seed data

`domain/seed/firstMonthSeed.ts` builds a deterministic first-month dataset with
planted WARNING (low diapers/feeds on days 3 & 12) and DANGER (fever days 10 &
30) markers plus growth points above/below range. Load it from
**Settings → Sample month** (merges via the active store, so it seeds the Google
Sheet when connected). Markers are asserted in the seed test.

## Guardrails

- This app is **not a medical device.** Never add diagnosis, vitals monitoring,
  or dosing advice — see the Learn page "will never support" list. Reference
  ranges are informational and must point users back to their pediatrician.
- Keep it offline-first: bundle data (no runtime fetches for core features),
  and make sure new state flows through the hybrid store so it syncs.
