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
  - `domain/legacyEvents.ts` — reads rows written under an older schema. Nursing
    (`breastfeed`) and `bottle` are one `feed` event now (with `method`, and
    optional `durationMinutes`/`amountOz`); old rows still live in the shared
    sheet and in IndexedDB, so both stores migrate on read rather than rewriting
    history. Retire a variant the same way — never mutate stored rows in place.
  - `domain/dates.ts`, `domain/summary.ts`, `domain/firstYear.ts` — derived stats.
  - `domain/diapers.ts` — feed → diaper lags and the next-change prediction.
  - `domain/cadence.ts` — gentle feed/bath rhythm nudges.
  - `domain/growth/` — WHO standards data + assessment logic.
  - `domain/csv.ts`, `domain/reference.ts` — CSV parsing + typed reference-data accessors.
  - `domain/dateRange.ts` — the inclusive local-day span behind the Log and
    Reports date filters, plus its presets. An empty end is open, so `ALL_TIME`
    needs no separate "filter off" flag, and a reversed pair is read as the span
    meant rather than as nothing.
  - `domain/download.ts` — client-side file download helper.
- `src/data/reference/*.csv` — **single source of truth** for reference data.
  Imported as raw text via `?raw` in `src/data/referenceSheets.ts` (bundled, so
  it works offline). Surfaced on the Learn page. Do NOT duplicate into `public/`.
- `src/components/` — React views. `App.tsx` owns the tab router + store wiring.
  `DateRangeFilter` is shared by the Log and by the Reports "Custom" period.
- `src/storage/` — local, Google Sheets, and hybrid stores. New event fields
  must be persisted here (see `googleSheetsStore.ts` column mapping).
  - `store.snapshot()` reads profile + events together. On the sheets store
    that's a single `values:batchGet`, so the two halves can never come from
    different versions of the sheet — this is the read every path should use.
    **Reads must not write.** `initialize()` seeds the Profile row only when the
    sheet has none; rewriting it on every read would clobber an edit another
    device made in between.
- Style: object keys and array entries are alphabetized; CSS is one big
  `styles.css` using CSS variables (`--font-body` Quicksand, `--font-display`
  Fraunces). Keep edits matching the surrounding idiom.

### Adding a new profile field

`profileHeaders` in `googleSheetsStore.ts` is positional: append the new key at
the end so existing sheet rows keep their columns, and widen `PROFILE_RANGE`,
`PROFILE_ROW_RANGE`, and the header write in `initialize()` to match (they are
`A:J` as of `gender`). The local Dexie store needs no change — it stores the
whole profile object.

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

### Stage 2 — Checklists & schedules (DONE)
Added the **Care** tab (`components/Care.tsx`) plus `milestone` and `vaccine`
event types sharing one `refId` column in the Sheets store. Reference rows carry
stable ids (`getMilestoneById` / `getVaccinationById`); toggling a row in the
Care view adds/deletes the corresponding event via `App.handleToggleRef`.
4. **Milestone checklist** — `getMilestones()` grouped by age, age-appropriate
   rows tagged via `getAgeDays`, achieved date shown.
5. **Vaccination schedule** — `getVaccinationSchedule()` anchored to `birthDate`
   (calendar-month due dates), overdue highlighting, and next-due in the header.

### Live sync (outside the staged plan)

The shared sheet has several caregivers writing to it, so the UI polls instead
of waiting for a reload:

- `App.tsx` polls `trackerStore.snapshot()` every 45s while the tab is visible,
  and immediately on `visibilitychange` / `focus` / `online`. Chained timeouts
  (`startPolling`), never `setInterval`, so a slow read can't stack.
- `domain/snapshot.ts` fingerprints the result. State is only swapped when the
  fingerprint moves, so a quiet sheet costs zero re-renders and never disturbs
  someone mid-entry. The stringify is key-order independent on purpose — two
  reads of the same row must fingerprint the same.
- Every write bumps `mutationRef` first, and a poll drops its result if that
  counter moved while it was in flight, so an older read can't reinstate rows
  from before the write.
- Sheets requests go out `cache: 'no-store'` — a cached 200 would just hand back
  the rows we already have.

Sign-in is meant to be a once-per-device event. Three things keep it that way,
and all three matter: the silent renewal chain in `googleSheetsAuth.ts`
re-arms itself after a *failed* renewal (otherwise one hiccup lets the token
lapse), the launch reconnect retries before it will show a sign-in screen, and
the reconnect screen keeps retrying silently behind itself so it can heal
without a tap.

### Outside the staged plan
- **Bath** — a `bath` event carrying nothing but time and notes, so it needs no
  new Sheets column (it reads and writes the base row, like `sleep`). Dashboard
  has a quick action plus a "Last bath" status card. Baths are counted in days,
  not hours, so it uses `formatDaysAgo` (calendar-day diff — "Yesterday", not
  "14h ago") rather than `formatAgo`.
- **Diaper rhythm** (`domain/diapers.ts`) — no new event type, all derived from
  the `diaper` and `feed` events already logged.
  - `getFeedToDiaperLags()` — mean wait from a feed to the next wet / next dirty
    diaper, dropping pairs more than 6h apart as unrelated. Shown as two Reports
    insight cards.
  - `predictNextDiaper()` — a recency-weighted average of recent gaps between
    changes (weights halve every 3 days, so a changing routine shows up fast),
    projected off the last change and pulled toward the usual feed → wet lag when
    a feed was logged since. Interval spread becomes the window and the
    confidence; it returns `null` under 4 intervals rather than guessing. Shown
    as a Dashboard status row. Informational only — see Guardrails.
  - Wet/dirty per-day averages ride along in `firstYearAnalytics.stats`, averaged
    over the days that logged any diaper so the splits add up to the total.
- **Cadence nudges** (`domain/cadence.ts`) — `getCadenceReminders()` flags a feed
  past 3h (`FEED_CADENCE_HOURS` 2–3, day and night) and a bath past 3 calendar
  days (`BATH_CADENCE_DAYS` 2–3). Rendered as `.status-row.gentle` rows on the
  Dashboard — a lavender edge, deliberately not the red `.urgent` used by the
  fever alert. Three rules keep them gentle: nothing fires until the *top* of the
  range has passed, nothing fires while a feed timer is running, and nothing
  fires with no earlier event to measure from (an empty log means unknown, not
  overdue). Copy suggests offering a feed or a bath and points at the
  pediatrician — never more than that.
- **Date range filters** (`domain/dateRange.ts` + `components/DateRangeFilter.tsx`)
  — presets plus From/To on the Log, and as a fifth **Custom** period on Reports.
  Custom is the only Reports period that filters by calendar day; Week/Month/Year
  still count back over the days that logged something, so a quiet stretch shows
  as a gap under Custom but is skipped by the others.
- **Theme** — the light/dark control lives in **Settings → Appearance**. The app
  header holds only the wordmark; Settings is also the only way into **Learn**
  (still routable at `#learn`, and the bottom nav stays visible there).
- **Profile gender** (`BabyProfile.gender`) — recorded because growth standards
  are sex-specific, but only the WHO *boys'* curves are bundled. A profile set to
  girl is still charted against them, and `GrowthStandards` says so on the card
  rather than comparing silently. Adding the girls' curves means three more CSVs
  plus a standards table, and is the real fix.
- **Timezone** is a select over `Intl.supportedValuesOf('timeZone')`
  (`getTimezoneOptions`), which always includes the device zone and whatever the
  profile already holds — a zone chosen on another device must stay selectable.
- **Hero age** — after birth the profile band headlines `formatAgeSummary()`
  ("2 weeks"): days for the first fortnight, then weeks, then calendar months,
  then years. The exact "N days old" line sits under it only from day 14, since
  before that the headline already says days. Pre-birth the band still shows the
  big due-date countdown number, which is what `.profile-band h1` is sized for —
  hence the smaller `.age-headline` variant for words.

## V2 — deferred

V1 is feature-complete and paused. The remaining roadmap items are deferred to a
future V2 and should not be started without an explicit go-ahead. The reference
data for several of them already ships (see `domain/reference.ts`).

The Learn page no longer advertises any of this — it lists only what ships, so
anything added below must not reappear there until it is actually built.

### V2.1 — Inventory & richer tracking
- **Milk inventory** — track pumped-milk stash (add on pump, subtract on a bottle
  feed from stash). New lightweight inventory store or derive from existing pump
  and `feed` events. Low-stock indicator.

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
- **Calendar** — no calendar integration ships today (the Dashboard embed and
  `domain/calendar.ts` were removed). An embed + subscribe link needs no
  API/quota if it comes back; only enable the **Calendar API** (scope
  `calendar.events`) if we want to read/write events in-app.
- **Photos** — no photo integration ships today (the header album link and
  `domain/media.ts` were removed). Google Photos blocks iframing and, since the
  2025 Library API changes, there is no whole-album read scope. If we ever pull
  photos in-app, use the **Photos Picker API** (user-picked), not the Library API.

## Sample / seed data

`domain/seed/firstMonthSeed.ts` builds a deterministic first-month dataset with
planted WARNING (low diapers/feeds on days 3 & 12) and DANGER (fever days 10 &
30) markers plus growth points above/below range; `fullYearSeed.ts` does the
same across a year. Markers are asserted in the seed test.

These are **test and development fixtures only** — the Settings buttons that
loaded them into live data were removed, since seeding merges through the active
store and would write sample rows straight into the shared Google Sheet.

## Guardrails

- This app is **not a medical device.** Never add diagnosis, vitals monitoring,
  or dosing advice — see the Learn page "will never support" list. Reference
  ranges are informational and must point users back to their pediatrician.
- Keep it offline-first: bundle data (no runtime fetches for core features),
  and make sure new state flows through the hybrid store so it syncs.
