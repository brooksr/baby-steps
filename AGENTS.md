# AGENTS.md

Guidance for AI agents (and humans) working in the BabySteps repo.

## What this app is

BabySteps is an offline-first PWA for shared baby-care tracking (built around
Theo, plus any sibling added since — and the parents doing the tracking). React
18 + TypeScript + Vite, with a hybrid local (Dexie/IndexedDB) + Google Sheets
store. No backend of our own.

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
    Per-day averages go through `getDayMetricStats`, which counts today as the
    fraction of it that has elapsed (`getDayFraction`) rather than as a whole day
    — otherwise every average sags all morning. That fraction is floored at a
    quarter day so a 00:30 entry can't be extrapolated into a wild rate, min/max
    skip the day in progress while any finished day exists, and a *level* like
    `weightOz` is averaged plainly, since it is not a per-day rate.
  - `domain/diapers.ts` — feed → diaper lags (mean plus the quickest/slowest of
    them) and the next-change prediction.
  - `domain/diaperDetails.ts` — stool color and poop size as fields: resolves a
    stored value to a `stool-colors.csv` id, and reads both out of a note for
    rows logged before either field existed.
  - `domain/feedClock.ts` — when feeds happen across the day and how long they
    run at each of those times, in bands of 1, 2, or 3 hours.
  - `domain/feedOrder.ts` — the same day read by feed *order* instead: the
    average clock time of the first feed of the day, the second, and so on,
    over a feeding day that runs 5am to 5am and only over days whose feed count
    was an ordinary one.
  - `domain/cadence.ts` — gentle feed/bath rhythm nudges.
  - `domain/whatToExpect.ts` — picks the Home "What to expect" copy for one
    profile at one moment: the pregnancy by gestational week before the birth,
    the day/week/month window after it.
  - `domain/growth/` — WHO standards data + assessment logic.
  - `domain/csv.ts`, `domain/reference.ts` — CSV parsing + typed reference-data accessors.
  - `domain/dateRange.ts` — the inclusive local-day span behind the Log and
    Reports date filters, plus its presets. An empty end is open, so `ALL_TIME`
    needs no separate "filter off" flag, and a reversed pair is read as the span
    meant rather than as nothing.
  - `domain/checkup.ts` — the span since the last growth measurement, behind the
    Reports "Check-Up" period.
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

### Sheets values: RAW in, coerce out

Writes use `valueInputOption=RAW`. **Do not change this to `USER_ENTERED`.**
USER_ENTERED lets Sheets *interpret* what we send: a bare `2026-08-15` becomes a
date cell, and reading it back with `UNFORMATTED_VALUE` returns a serial number
instead of the string — which is exactly how the profile birth date stopped
surviving a round trip (and `dueDate` hid the same bug behind its default).
RAW also keeps a note beginning with `=` as text rather than a formula.

Rows written before the switch still hold serials, so `optionalDateString()`
converts a numeric cell back to a date string on read (Sheets epoch is
1899-12-30). Every date-ish column goes through it — never plain
`optionalString` — and we migrate on read rather than rewriting history.

### Adding a new profile field

Append the new key to the end of `profileHeaders` so existing sheet rows keep
their columns, and widen `PROFILE_RANGE`, `PROFILE_HEADER_RANGE`, and
`profileRowRange()` to match (they are `A:N` as of `phone`). The local Dexie
store needs no change — it stores the whole profile object.

**Reads find a column by header name, not by position.** `columnIndex()` builds
the map from the sheet's own header row, first occurrence winning, and falls back
to our array position for any header the sheet does not name (which is what a
sheet written by an older build looks like). This exists because the live Profile
tab grew a duplicate `parentRole` header past the end of the columns we write:
harmless where it sat, but one hand-inserted column away from shifting every
field after it and misreading whole rows. Writes stay in our canonical order, and
`initialize()` rewrites the header row once a session — including blanking a
trailing header cell that repeats one of our own names. A header we do not
recognise belongs to whoever added it and is left alone.

### Several children — and the parents

One profile row is one tracked person, and an event has always carried `babyId`,
so the data model needed no new shapes — what changed is that nothing may assume
there is exactly one profile, or that a profile is a baby.

- `profile.kind` is `child` or `parent`; **a row written before parents existed
  has no `kind`, and every one of those is a child**, so `getProfileKind`
  defaults rather than guessing. A parent carries `parentRole` (`mom`/`dad`/
  `parent`) and **no `dueDate`** — `dueDate` is optional on `BabyProfile` for
  exactly that reason, and the baby-only modules (`getDueDateStatus`,
  `getGestationInfo`, `getPregnancyOutlook`) return nothing without it instead of
  inventing one. Do not give a parent a due date to satisfy a type.
- `tracksCycle()` gates the cycle feature on `parentRole === 'mom'`.
- `App` branches the whole view on `isParent`: `ParentDashboard` and
  `ParentReports` instead of `Dashboard` and `Reports`, and the **Care tab drops
  out of the nav** (milestones and immunisations are a child's). `view` falls
  back to the dashboard when the active tab is not one a parent has, so landing
  on Care and then switching does not leave an empty screen.
- `snapshot()` fills `childEvents` **only when the active profile is a parent** —
  their report is partly about the babies. A child's own view has no use for a
  sibling's rows, and carrying them would churn its fingerprint on every poll.
- `domain/family.ts` (was `children.ts`) — the id (`createProfileId` slugifies the name, because
  `babyId` is a column a caregiver reads in the sheet), `createFamilyProfile`
  (a new person starts from the defaults; only units and timezone carry over,
  since those describe the household), and the **device-local** active-profile
  choice — its storage key is still `babysteps.activeChild` so a device that
  already stored one does not lose it.
  Device-local on purpose: the sheet holds every child, but one parent switching
  to the twin must not move everyone else's screen.
  Siblings are stamped strictly after the children already there — the switcher
  orders by `createdAt`, and on a fresh device the first child is seeded lazily,
  so two can otherwise land in the same millisecond and swap places.
- `Profile!A:K` is open-ended now, one row per child. A save finds the child's
  row by id (`profileRowRange`), an add writes the next free row, and a remove
  **blanks the row** rather than deleting it — row numbers stay put, a blank row
  is skipped on read, and the child's entries are never touched. Removing a
  child takes them out of the switcher; it is not a purge.
- `store.snapshot(query)` returns `profiles` (all children, oldest first) plus
  `profile`/`events` for `query.babyId` — the child named, or the first one. It
  is still a single `values:batchGet`, however many children there are.
- `App` keeps the active id in `activeChildRef` as well as in state: a poll that
  started before a switch must not apply a read about the previous child, and
  every write names the child (`babyId` on an event, `id` on a profile patch) so
  it cannot land on whoever happens to be first.
- Timers (`domain/timers.ts`) are keyed by child — twins can each be nursing.
  A device still holding the old flat map hands those timers to the child that
  asks and stores them nested on the next write.
- `sortProfiles` puts **children before parents**, each oldest first — this is a
  baby tracker, so the switcher opens on the babies.
- `ChildSwitcher` renders in the header only when there is more than one person,
  so a single-baby tracker looks exactly as it did. Copy that used to say "Theo"
  goes through `getFirstName(profile)`.
- An export carries every child (`profiles`) and every child's entries; an
  export taken before this existed carries one `profile`, and still imports.

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
- `stool-colors.csv` → `getStoolColors()`, `isStoolColorFlagged()`
- `fetal-development-by-week.csv` → `getFetalWeeks()`
- `what-to-expect-by-age.csv` → `getAgeStages()`
- `what-to-expect-notes.csv` → `getExpectationNotes()`

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

### Parent tracking (sleep, cycle, and the baby events that touch them)

- **What a parent logs is the event types that already existed** — `sleep`,
  `mood`, `temperature`, `medication`, `appointment`, `note` — against their own
  profile id. Only `menses` is new. Feeds, diapers and growth stay on the baby's
  Home rather than being offered against the wrong person.
- **`menses` is one *day* of a period, not a period.** People log bleeding as it
  happens and miss the odd day, so `domain/cycle.ts` groups days back into
  periods on read (a gap of up to two days stays the same period; three starts a
  new one) rather than asking anyone to close a period out. One entry per day,
  heaviest `flow` winning.
- `domain/cycle.ts` — cycles are measured **start to start**. Averages run over
  the last 6 cycles, and a span under 21 or over 60 days is dropped from them: a
  two-month hole is missed logging, not a two-month cycle, and averaging one in
  poisons every prediction after it. Dropped cycles are still listed and counted
  (`droppedCycles`), the way the feed-order day trimming is surfaced.
  - **Ovulation is counted back from the predicted next period, never forward
    from the last one** — the luteal phase (~14 days) is the stable half of a
    cycle whatever its length. The fertile window is ovulation −5/+1 days (sperm
    last about five days, the egg about one).
  - `predictCycle` returns null under two counted cycles — the line
    `predictNextDiaper` draws. The window spans shortest-to-longest recent cycle
    and never closes tighter than ±1 day around the average; confidence comes
    from the spread.
  - **Guardrail: this is arithmetic on logged dates.** Every surface says so —
    not contraception, not a fertility test, not a pregnancy test, and irregular
    postpartum cycles make it rougher still. Do not add anything that reads as a
    fertility or contraceptive recommendation.
- `domain/parentReport.ts` — a parent's nights, keyed by the **evening** the
  sleep started (before 10am belongs to the night before), so one night is one
  row rather than splitting at midnight. Over 16h is a timer left running, not a
  sleep, and is dropped the way a 4h+ feed is.
  - `interruptions` is when a baby event landed *inside this parent's own logged
    sleep*. It needs no attribution and asks a different question from the care
    counts: not who got up, but whose sleep was broken into. Keep them separate.

### Who logged it (`caregiverId`)

- `caregiverId` on `BaseCareEvent` is **the profile id of a tracked parent**, and
  it is optional. Every row written before the column existed carries none, and
  an entry with no caregiver is "not recorded" — never a guess at whoever was
  most likely on. `getCaregiverName` returns nothing for an id whose profile has
  since been removed, so the entry reads as unattributed rather than showing a
  dangling id.
- The quick-add "Logged by" picker shows **only on a child's entry** (a parent
  logging their own sleep is not doing it for someone else) and defaults to this
  device's last choice, stored device-locally under `babysteps.caregiver`. That
  default is what makes the field get filled in at all; picking "Not recorded"
  clears it rather than pinning the previous person.
- `getParentReport(parentEvents, childEvents, caregiverId)` returns the load
  three ways: `care` (everything the household logged), `care.mine` (this
  parent's recorded share) and `care.unattributed` (entries naming nobody).
  **Show all three.** A report that showed only the attributed share would read
  as "you did less" on a log where people simply did not fill the field in.

### The guardians are the parent profiles

`careInfo.guardians` was a pair of name/phone boxes on the Key Info card, which
said the same thing as a parent profile and drifted from it. A parent carries a
`phone` now, and `KeyInfo` builds its guardian cards from the parent profiles
(`getCaregivers`), showing "Name · Role" and a tappable number.

- `careInfo.guardians` is **deprecated, still read, and still written back
  untouched**. A household that has not added parents yet sees the old list
  exactly as before, and saving the rest of the Key Info card carries it through
  rather than quietly dropping a phone number. Do not delete the field.
- The Key Info editor no longer has guardian boxes; it points at Settings →
  Family instead, so one record covers the guardian list, the switcher, and the
  "Logged by" picker.

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
- **Diaper color & size** — a dirty (or both) change carries `poopSize`
  (small/medium/large) and `color`, a `stool-colors.csv` id. The reference row's
  guidance shows under the selector, styled `.field-note.flagged` when
  `flagFromDay` has passed — black only after the first week (meconium before
  it), red/white/gray at any age, normal and green never. Age is taken at the
  *entry's* time, so back-dating moves the line. Wet-only changes carry neither
  field. Sizes are weighted for reporting by `POOP_SIZE_WEIGHTS` — large 1,
  medium 2/3, small 1/3, and a change logged without a size counts as a medium
  one — the middle of the scale is the honest guess, where either extreme would
  bias the daily figure. `FirstYearPoint` and `DailySummary` both
  carry the size counts plus the weighted `poopLoad`; Reports shows a Poops/day
  card (weighted average, size breakdown, weighted total vs. raw change count)
  and the daily Dirty card adds the same breakdown once anything that day is
  sized. Every per-day Reports card carries its min–max range under the average;
  a range collapses to one number when the span never varied, and it is left off
  where it would be meaningless (a longest-sleep max, an L/R split). Color used to be a free-text box and size was never a field, so
  `migrateStoredEvent` resolves old spellings ("mustard" → `normal`) and reads
  both out of the note ("big yellow blowout") on the way in — an unrecognized
  word is kept as written, and history is never rewritten. See Guardrails: the
  note repeats the reference row and points at the pediatrician, nothing more.
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
- **Feed clock** (`domain/feedClock.ts` + `components/FeedClock.tsx`) — no new
  event type: the shape of the feeding day, derived from the `feed` events
  already logged, scoped by the selected Reports period.
  - Two charts over the same bands, so a bar on the left and a bar on the right
    are the same stretch of clock: **Feeds by time of day** (counts) and **Feed
    length by time** (mean length of the feeds that started there). Feeds are
    bucketed by the hour they *started*, so a session running past its band
    still belongs to the time it was offered.
  - Band width is a 1h/2h/3h control on the section heading. Three is the
    default — eight bands fit a phone and each holds enough feeds for its
    average to mean something. At 24 bands there is no room for a number over
    each bar, so the per-bar values drop and the hour ticks thin to every third;
    the tap readout still names any band.
  - Length comes from `getEventDurationMinutes`, so a nursing `durationMinutes`
    or an `endedAt` span both count and an untimed bottle does not — the card
    says "N of M timed" rather than averaging a missing length as zero. Over
    `MAX_FEED_MINUTES` (4h) is a timer left running, not a feeding, and is
    dropped the way `feedGapStats` drops an overnight gap.
  - `feedsPerDay` divides by how much of that band was actually *observed*:
    whole days count 1, a band later today counts the fraction of it that has
    passed, and one still to come counts 0 — the `getDayFraction` reasoning
    applied to a slice of the day, so the evening does not read quiet every
    morning. Under a quarter of a band observed it returns null rather than
    extrapolating. Bars stay raw counts (an empty hour draws no bar at all);
    the rate that corrects for a partial day is on the readout.
  - `busiest` needs only a feed, but `longest`/`shortest` need
    `MIN_BAND_SAMPLES` (3) timed feeds — like `predictNextDiaper`, it declines
    rather than naming a band off one session. Informational only, see Guardrails.
- **Feed order** (`domain/feedOrder.ts` + `components/FeedOrder.tsx`) — the
  companion cut to the feed clock, over the same `feed` events and the same
  Reports period. The clock asks "how busy is 9am?"; this asks "what time is the
  third feed usually?" — feeds are numbered within their local day and each
  index is averaged across days.
  - One row per index on a shared 24-hour track, so the shape of a day reads
    straight down the column. The bar is the earliest-to-latest spread that
    index has run to and the mark inside it is the average, so an unsettled feed
    shows as a wide bar rather than hiding inside its own mean. Each row also
    carries the mean wait since that day's previous feed, and the day count
    behind it.
  - **The feeding day starts at `FEED_DAY_START_HOUR` (5am), not midnight** —
    this module only. Counting from midnight made a 1am feed the *first* feed of
    a new day when it is really the tail of the night before, which put a Feed 1
    in the small hours and pushed the whole sequence out of step. Five is past
    the night feeds and early enough that a real morning start still lands on
    the right day. The day key shifts the *calendar date* rather than
    subtracting hours, so a DST change cannot move the boundary. Everywhere else
    in the app still uses `getLocalDateKey`'s midnight.
  - Slot stats are **offsets from the day start** (0–1440), not clock times, so
    they sort and plot in the order the day happens and a day can cross midnight
    — 11pm and 1am are 18h and 20h into the same day. `toClockMinutes` converts
    one back for reading; the track and its axis both run start-hour to
    start-hour, so a late feed sits at the right-hand end where it belongs.
  - Each index averages only the days that actually reached it, so a day still
    in progress contributes the feeds it has had without dragging down the ones
    it has not — no partial-day weighting is needed here, unlike the feed clock.
  - **Only ordinary days count**: a feeding day is included when it logged
    between `FEED_DAY_MIN_FEEDS` (9) and `FEED_DAY_MAX_FEEDS` (11) feeds. A day
    holding three is a hole in the log or the ragged end of the selected range,
    and folding one in stretched every index across the clock — its lone morning
    feed is "feed 1" exactly like a proper day's, and its afternoon one is
    "feed 2" where a full day is on its fifth. Trimming is what makes a row's
    spread mean "when this feed happens" rather than "how uneven the logging
    was". Days are dropped whole, never trimmed feed by feed.
    **These bounds are tuned to a newborn's ~10 feeds a day and will need
    revisiting as feeding drops off** — once a typical day is seven feeds, no
    day clears 9 and the section says so instead of charting.
  - `days` is the counted days and `loggedDays` every day in the span; the
    `.feed-order-scope` line under the summary says "8 of 22 days · only days
    with 9–11 feeds · day starts 5:00 AM", because every number in the section
    is about that subset rather than about the whole period.
  - Under `MIN_ORDER_DAYS` (3) days an index still shows, dimmed via
    `.feed-order-row.sparse`, and `typicalCount` stops the summary sentence at
    the first thin index so one long day cannot stretch the sequence.
  - `formatMinutesOfDay` in `domain/dates.ts` renders an average time of day —
    it belongs to no date, so it formats off a fixed UTC instant (a DST
    transition must not shift it) while still following the reader's 12/24-hour
    locale.
- **What to expect** (`domain/whatToExpect.ts` + `components/WhatToExpect.tsx`) —
  the Home orientation card, under the alerts and the newborn check: what is
  happening today comes first, what to expect of this week comes after it. No new
  event type — it reads the profile and three CSVs.
  - Two phases share the card. Before the birth it reads the pregnancy by
    gestational week, counted back from `dueDate` (which is 40w0d by definition,
    so no new profile field is needed). After it, the day / week / month window
    the baby is in. Weeks past the last written row clamp to it — a pregnancy at
    42 weeks still has week 41 to say — but a due date early enough to sit before
    week 4 returns null and the card is absent rather than inventing a row.
  - `what-to-expect-by-age.csv` tiles **0–730 days with no gap and no overlap**,
    on the same ladder `formatAgeSummary` uses: days, then weeks, then months.
    `whatToExpect.test.ts` asserts the tiling, so a new row has to be spliced in
    by adjusting its neighbours' bounds rather than dropped on top of them.
  - **Which age the stage is read at** (`getStageAgeDays`) is the whole preterm
    story, in one line: `max(min(ageDays, 28), ageDays - correctionDays)`. The
    newborn window runs on the calendar — milk coming in, the cord stump,
    meconium and regaining birth weight all happen a fixed number of days after
    the birth however early it was — so inside 28 days the stage is chronological.
    Past it, skills lead and the stage follows corrected age. The `min` is what
    stops a 34-weeker jumping *backwards* to "Day 1" on day 29: the card holds at
    the end of the newborn window until corrected age catches up, and can never
    move backwards as the days pass (asserted). For a term birth the two ages are
    equal and the formula is just the age.
  - The card says which age it is reading, and says it three ways, because
    "corrected" alone would be wrong in the middle case: reading at the actual
    age, at the corrected age, or **held at the newborn window while corrected
    age catches up**. `basis` is only `'corrected'` while the correction is
    actually moving the answer.
  - **Personal notes** (`what-to-expect-notes.csv`) are matched on
    **chronological** age, not the corrected age the stage uses — a car seat
    screen, a cord stump and an RSV season arrive on the calendar. A profile can
    match several audiences at once (`preterm` *and* `late-preterm` *and* `boy`);
    `AUDIENCE_ORDER` sorts preterm above sex-specific ones and the card keeps the
    first `MAX_NOTES` (3), since a preterm note changes what you do today.
  - **Copy tokens**: `{name}`, `{their}`, `{them}`, filled by `personalize()`.
    `{name}` is deliberately the only *subject* available — it is singular
    whatever the pronouns are, so a verb written in the CSV agrees for every
    profile. A `{they}` token would need "he is" and "they are" to be two rows.
    A test fails the build on any token in the shipped copy that is not on the
    list, so a `{they}` cannot reach the Home screen as literal braces.
  - **Ages 2–18 are outlined, not written.** `FUTURE_STAGE_OUTLINE` names seven
    bands (toddler through late adolescence) and the themes each has to cover.
    It is exported so the shape is reviewable and the coverage is testable, and
    **deliberately rendered nowhere** — the Learn page lists only what ships, and
    a roadmap on the Home screen would be advertising an unbuilt feature. Past
    two years the card says the guidance stops there and points at Care and the
    pediatrician. A preterm baby stays inside the copy past 730 chronological
    days, because the stage is read at corrected age.
  - Informational only — see Guardrails. The footnote points at the pediatrician
    and the copy suggests nothing beyond ordinary caregiving.
- **Cadence nudges** (`domain/cadence.ts`) — `getCadenceReminders()` flags a feed
  past 3h (`FEED_CADENCE_HOURS` 2–3, day and night) and a bath past 3 calendar
  days (`BATH_CADENCE_DAYS` 2–3). Rendered as `.status-row.gentle` rows on the
  Dashboard — a lavender edge, deliberately not the red `.urgent` used by the
  fever alert. Three rules keep them gentle: nothing fires until the *top* of the
  range has passed, nothing fires while a feed timer is running, and nothing
  fires with no earlier event to measure from (an empty log means unknown, not
  overdue). Copy suggests offering a feed or a bath and points at the
  pediatrician — never more than that.
- **Reports page order** — the period control sits directly above the first
  thing it changes. Everything above it (First Year, recent trends, growth
  standards) is period-independent; everything below (Insights, Feed clock, Feed
  order, and the day/period summary) reads from the selected period. The control
  block carries the Custom date picker and the Check-Up summary with it, since
  those are part of choosing a period rather than results of one. Two Insights
  cards are deliberately all-time (Longest sleep, Weight gain) and say so on the
  card.
- **Date range filters** (`domain/dateRange.ts` + `components/DateRangeFilter.tsx`)
  — presets plus From/To on the Log, and as a **Custom** period on Reports.
  Custom and Check-Up are the Reports periods that filter by calendar day;
  Week/Month/Year still count back over the days that logged something, so a
  quiet stretch shows as a gap under those two but is skipped by the others.
- **Check-Up period** (`domain/checkup.ts`) — a Reports period spanning the last
  growth measurement through today, so a visit can be described as "since last
  time". Weights and lengths are taken at the appointment, so the last
  measurement *is* the last appointment; `birth` counts as one so the first span
  starts at the hospital, a row with no numbers on it can't anchor, and a
  measurement dated ahead of today is skipped rather than collapsing the span.
  Needs no new event type or column. The card above the charts names the anchor
  date and what was measured then; with nothing measured yet the period says so
  instead of charting all time.
- **Theme** — the light/dark control lives in **Settings → Appearance**. The app
  header holds only the wordmark; Settings is also the only way into **Learn**
  (still routable at `#learn`, and the bottom nav stays visible there).
- **Event colors** — care events are color-coded by family (feeds blue, diapers
  amber, tummy teal, bath cyan, sleep indigo, meds/temp/vaccines coral,
  birth/growth/milestones green, mood pink, appointments/notes slate). The pair
  rides on the element as `data-event={type}` plus two custom properties:
  `--event-tint` for the mark, `--event-fill` for the surface behind it. The
  Home quick-add grid and the Log timeline chip both read them, so one block
  keeps the four surfaces in step. Reports tags each metric card and `MiniChart`
  (which takes an `event` prop) — cards carry no icon, so a 3px leading edge does
  the coding, and the chart bars draw in the family tint over its fill. Care tags
  its Milestones and Vaccinations sections, which tints the idle `.check-box`;
  the done and overdue states are more specific and still take the box over. The
  one stacked chart is the exception: wet vs dirty is a different dimension from
  the family hue, so those two parts keep their own blue/amber pair, and the
  selected bar deepens with a `filter` rather than switching to a fixed blue. Both fall back to the old flat blue, so an untagged
  element is unchanged, and `.quick-button` takes the fill on *itself* rather
  than on the `[data-event]` rules — those would outrank `.timer-active` and a
  running timer must still be able to take the tile.
- **Nav colors** — each bottom-nav tab owns a hue, keyed off `data-nav={tab.id}`
  and carried by two custom properties: `--nav-tint` colors the idle icon,
  `--nav-fill` fills the selected pill. Fills stay pastel in both themes (the
  trick `--accent` already plays) so one dark ink reads on all five; only the
  tints are re-picked under `[data-theme='dark']`, where the light ones would
  disappear into the panel.
- **Age basis** — `GrowthStandards` opens on **corrected** age, since the WHO
  curves are built on term births. The control only appears when there is
  gestation to correct for, and `activeBasis` falls back to actual otherwise, so
  a term profile never sees it.
- **Profile gender** (`BabyProfile.gender`) — recorded because growth standards
  are sex-specific, but only the WHO *boys'* curves are bundled. A profile set to
  girl is still charted against them, and `GrowthStandards` says so on the card
  rather than comparing silently. Adding the girls' curves means three more CSVs
  plus a standards table, and is the real fix.
- **Timezone** is a select over `Intl.supportedValuesOf('timeZone')`
  (`getTimezoneOptions`), which always includes the device zone and whatever the
  profile already holds — a zone chosen on another device must stay selectable.
- **Preferred units** (`BabyProfile.preferredUnits`) — American is the default;
  metric display/input converts at the UI boundary while stored event fields
  remain canonical ounces, inches, and Celsius. American weight can be shown as
  pounds + ounces or ounces only.
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
  dosing advice, or contraceptive/fertility guidance — see the Learn page "will
  never support" list. Reference ranges and cycle estimates are informational and
  must point users back to their pediatrician, doctor, or midwife.
- Keep it offline-first: bundle data (no runtime fetches for core features),
  and make sure new state flows through the hybrid store so it syncs.
