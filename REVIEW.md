# BabySteps — V1 Review

A final pass over architecture, design, and goal achievement. The north star:
**supporting the mother** — a tired, often one-handed parent who needs the truth
quickly and without judgment.

---

## 1. Architecture

**Shape.** React 18 + TypeScript + Vite PWA. Clean three-layer split:
`domain/` (pure logic + data, fully unit-tested), `components/` (React views),
`storage/` (local Dexie/IndexedDB + Google Sheets, behind a hybrid store).
Data is event-sourced: one `CareEvent` union is the spine; everything derives
from it. Reference data (WHO standards, milestones, vaccines, temperature,
tummy time, mood) ships as bundled CSVs with typed getters.

**Strengths**
- Offline-first: the app always works on-device; Google Sheets is an additive
  sync layer that degrades gracefully to local.
- Pure, tested domain logic (37 tests) — growth bands, newborn checks,
  temperature classification, CSV parsing, and the seed's planted markers.
- Single source of truth for reference data; one parser/table/ download path.
- Deterministic seed (`domain/seed/firstMonthSeed.ts`) makes the assessment UI
  verifiable, including warning/danger states.

**Risks / debt** (carry into V2)
- **Sheets-as-database is brittle.** Columns are positional; adding a field
  means widening ranges (`A:AE`) and appending columns in lock-step across
  `eventHeaders` / `eventFromRow` / `eventToRow`. Easy to misalign.
- **Naive concurrency.** Merge is by id; `updateEvent` overwrites. Two
  caregivers editing the same entry can clobber each other. `syncState` exists
  but isn't used for real conflict resolution.
- **Chatty sync.** Every refresh re-`initialize()`s and re-reads all rows. Fine
  at a month of data; a full year + frequent edits could get slow or brush
  Sheets rate limits. A cached read + incremental sync is the V2 fix.
- **Auth lifetime.** GIS implicit flow issues ~1h access tokens with no refresh
  token. We now persist the token and silently re-auth (see §4), which covers
  day-to-day reuse — but while the OAuth app is in **testing**, Google expires
  the grant about weekly, so an occasional reconnect tap is unavoidable until
  the app is published/verified.
- **Local-fallback divergence.** Events created while in local fallback aren't
  pushed until the next `connect()`. Acceptable for one primary device; worth
  hardening if usage spreads across devices.

## 2. Design

Calm, mother-friendly visual language: Quicksand body + Fraunces display, soft
blue palette, big card tap targets, mobile-first with safe-area padding. Tone is
supportive rather than clinical.

**Working well**
- Quick-add grid puts logging one tap away.
- Dashboard surfaces what matters at a glance: last feed/diaper, today's totals,
  newborn check, fever alert, upcoming meds/appointments.
- Reference data is transparent (viewable + downloadable), which builds trust.

**Gaps against the "tired mother" test**
- **No dark / night mode.** 3am feeds happen in the dark; a light-only UI is
  literally blinding. Highest-value comfort fix.
- **Feed context is thin.** We show *when* the last feed was, but not *how long
  ago* (elapsed) nor *which side is next* — the two things a nursing mother asks
  most. The data (`side`, `startedAt`) is already captured.
- **Tone of warnings.** "Below expected range" / "Below expected" is honest but
  can read as alarming to a postpartum parent. Pair every flag with a calm,
  concrete next step and reassurance (some already do; make it consistent).
- **Six bottom-nav tabs** is a lot for one-handed reach. Consider demoting Learn
  to the header (like the album) and keeping 5 primary tabs.
- **No support lifeline.** No one-tap link to lactation support, the
  pediatrician, or postpartum/mental-health resources.

## 3. Goal achievement

| Goal | Status |
|------|--------|
| WHO boy growth standards + charts + at/below/above assessment | ✅ |
| Newborn first-weeks diaper/feed range checks | ✅ |
| Learn page (monitors / never-supports / feasible) + CSV data | ✅ |
| Quicksand + Fraunces typography | ✅ |
| Shared family calendar (embed + subscribe) | ✅ |
| Shared photo album (header link) | ✅ |
| Stage 1 logs: temperature (fever alert), tummy time, mood | ✅ |
| Stage 2 checklists: milestones + vaccinations | ✅ |
| Full first-month seed with warning + danger markers | ✅ |
| Persistent Google login on device | ✅ (see §4) |
| Remaining feature stages | ⏸ deferred to V2 |

**Central goal — supporting the mother:** the tracking, reassurance scaffolding,
and at-a-glance status are in place. The biggest unrealized wins are *comfort and
context* (night mode, "X ago / next side," supportive warning copy, a support
lifeline) rather than more tracking surface area.

## 4. Login persistence (this pass)

Previously the access token lived only in memory and used `prompt:'consent'`, so
every launch returned to the consent/login screen. Now:
- The token + expiry persist in `localStorage`; a grant flag records that the
  user consented on this device (`googleSheetsAuth.ts`).
- Re-auth uses `prompt:''` — it reuses the existing grant silently and only
  shows UI when Google genuinely needs it.
- On launch, if the device was granted before, the app **silently reconnects**
  (`connect(false)`) and skips the login screen; a guarded timeout prevents a
  blocked popup from hanging boot, and any failure falls back to the splash for a
  one-tap reconnect (never a divergent silent local mode).

Caveat: testing-mode grants still lapse ~weekly until the OAuth app is verified.

## 5. Mother-first pass (done)

1. ✅ **Night mode** — `domain/theme.ts`, applied early in `main.tsx`, dark
   palette + surface overrides in `styles.css`, toggle in the app header
   (defaults to the device's system preference, choice persisted).
2. ✅ **"Last fed 2h 10m ago · next: right"** — Dashboard feed/diaper cards now
   show elapsed time (`formatAgo`) and the next nursing side from the last
   breastfeed.
3. ✅ **Reassuring warning copy** — softened growth below/above text, a calm
   next-step line on off-track newborn days, and a gentler fever banner; every
   flag pairs the fact with a concrete, low-alarm next step.
4. ✅ **Support lifeline** — `domain/medicalInfo.ts` + the **Key info** section
   in Care (hospital with one-tap directions and drive time, OB, public
   emergency/poison-control lines, and prompts for the rest to gather), plus a
   hospital-directions shortcut on the Dashboard. Personal contacts are prompts
   for now; editable/persisted is a V2 item.
5. ✅ **Trimmed primary nav to 5** — Learn moved into the app header; bottom nav
   is Home / Log / Reports / Care / Settings.

## 6. Caveat that matters

The milestone, vaccination, and temperature reference tables were composed as
scaffolding. **Have a clinician review them before anyone relies on them**, and
keep the not-a-medical-device framing prominent (the Learn page already does).
