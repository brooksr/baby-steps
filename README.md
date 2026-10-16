# BabySteps

BabySteps is a private, offline-first progressive web app for tracking baby care and sharing the log with a household. It runs entirely in the browser, stores data locally with IndexedDB, and can optionally synchronize through a Google Sheet you control. There is no BabySteps backend (an optional token broker, below, makes sign-in one-time on a self-hosted copy).

## What it tracks

- Feeds, pumping, diapers, sleep, baths, tummy time, temperature, mood, medication, appointments, growth, and notes
- Feed, sleep, and pumping timers; diaper and feeding predictions; newborn range checks; and daily summaries
- WHO growth charts, first-year reports, milestones, vaccination schedules, and age-based “What to expect” guidance
- Multiple child and parent profiles, caregiver attribution, reversible profile archiving, shared tasks, and a shopping list
- Parent sleep and care-load reports, menstrual-cycle logging, and food, drink, and symptom logs

BabySteps is a record-keeping aid, not medical advice or a diagnostic tool.

## Babysteps app

This repo also contains the tested native Android phone app and standalone
Pixel Watch app in [`android/`](android/README.md), imported from `oneplus`
commit `c60348b`. The phone includes the Nursery sound monitor and reaches the
family log through the Pi; the watch logs care entries through its events API.
Open `android/` in Android Studio. The PWA and Pi keep their existing paths.

- [Monorepo plan and future development path](docs/MONOREPO.md)
- [Phone architecture, offline writes, build and deployment](docs/BABYSTEPS_APP.md)
- [Android setup, watch setup and device verification](android/README.md)

Reference CSVs are shared at build time. Kotlin web compilation is possible,
but needs a Multiplatform extraction and browser adapters; the development
plan sets out the trial and parity checks before replacing the PWA.

## Internal accounts and database roadmap

The planned internal backend will use BabySteps accounts and SQLite, with
passkeys as primary sign-in and Google as an optional linked identity. The
[architecture and rollout plan](docs/INTERNAL_BACKEND.md) covers authentication,
family permissions, offline sync, Sheets migration and Pi operations. Tested
schema and authorization primitives live in `src/server/internal/`; the running
app still uses its existing local/Google storage and sign-in paths.

## Technology

- React 18, TypeScript, and Vite
- Dexie and IndexedDB for offline storage
- Google Sheets API for optional household sync
- Vitest and Testing Library
- A service worker and web app manifest for installable PWA behavior

Reference data is bundled from `src/data/reference/*.csv`, so guidance and lookup tables remain available offline.

## Getting started

Node.js 24 is recommended to match the GitHub Actions workflow.

```bash
npm ci
npm run dev
```

Open the address printed by Vite. A new installation starts with a neutral `Baby` profile; update its name, dates, care team, and household details in Settings.

Google Sheets sync is optional. Without its environment variables, the app works locally in IndexedDB. To enable sync, create `.env.local`:

```bash
VITE_GOOGLE_CLIENT_ID=your-google-oauth-web-client-id.apps.googleusercontent.com
VITE_GOOGLE_SHEET_ID=your-spreadsheet-id
```

The spreadsheet ID is the value between `/d/` and `/edit` in a Google Sheets URL. Do not commit `.env.local` or a real spreadsheet ID.

## Google Sheets setup

1. Create a Google Cloud project and enable the **Google Sheets API** and the **Google Drive API**.
2. Configure the OAuth consent screen (scopes: Sheets, `drive.file`, email) and create a Web application OAuth client.
3. Add each development or production site origin to the client’s authorized JavaScript origins.
4. Create a blank Google Sheet and set the two environment variables above.
5. Start BabySteps, open Settings, and connect Google Sheets.

Optional settings, all safe to leave out:

| Variable | What it does |
| --- | --- |
| `VITE_GOOGLE_CLOUD_PROJECT` | Project id. The admin checklist links straight to its Audience page. |
| `VITE_GOOGLE_OAUTH_PUBLISHED` | `true` once the consent screen is **In production**, which drops the test-user step. |
| `VITE_GOOGLE_API_KEY` | Enables the Google Picker (enable the **Google Picker API**; create the key **in the same project as the OAuth client** and restrict it to the Picker API and your site). Lets the app share a sheet it did not create. The Picker's app id is read from the OAuth client id. |

### Families and who can sign in

One family is one spreadsheet. The sheet above is the first family. Anyone who signs in without a profile in a family sees none of it and is offered to start their own, which creates a new spreadsheet in their own Drive.

To add someone, a parent adds them in Settings → Family with their Google account and taps **Invite**, which sends the link and the sign-in steps by the phone's share sheet or by email. Before they can sign in:

- **Test users:** while the OAuth app is in Testing mode, add their account on the consent screen's Audience page. Google offers no API for this. Publishing the app removes the step (people then see an "unverified app" notice and can continue).
- **Sharing:** the app shares a sheet it created automatically. Your hand-made first sheet is shared by hand until a parent taps **Let BabySteps share this sheet** once (needs the Picker settings), after which it is automatic there too.

A caregiver who signs in sees the children's Home, where they can log anything but a birth, plus the Care page's Key info and Emergency tabs. This only limits what the app shows. Anyone the sheet is shared with can still open the sheet and read all of it.

Every name, phone number and email lives in the sheet, not in the repository. Someone else can run their own copy of this repo against their own sheet and their own OAuth client.

The app creates and maintains its own worksheet headers. Writes use raw cell values so dates and notes round-trip without Google Sheets interpreting them as dates or formulas.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server on all interfaces |
| `npm run lint` | Run ESLint |
| `npm test` | Run the Vitest suite once |
| `npm run build` | Type-check and create the production build |
| `npm run preview` | Serve the production build locally |

Before shipping a change, run:

```bash
npm run lint
npm test
npm run build
```

## GitHub Pages deployment

The workflow in `.github/workflows/deploy.yml` builds and deploys the `dist` directory with GitHub Pages. In the repository settings:

1. Set Pages source to **GitHub Actions**.
2. Add repository variables named `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_SHEET_ID` if the hosted build should use Google Sheets, plus any of the optional ones above.
3. Add the deployed site’s origin to the OAuth client’s authorized JavaScript origins.

The current Vite base path is `/baby-steps/`. If the repository or hosting path is different, update `base` in `vite.config.ts` before deploying.

## Raspberry Pi build and one-time sign-in

The same workflow's `pi` job builds for a self-hosted copy served from the site root, and publishes it as a rolling GitHub release (`pi-latest`, built from `main`) that the host pulls.

On a static site, Google sign-in lasts about an hour: the browser-only flow never issues a refresh token. The Pi build adds a small stateless **token broker** (`server/token-broker.mjs`, Node 24, no dependencies) at `/api/token/`, which holds the OAuth client secret and lets each device keep a refresh token, so signing in is a one-time event per device. To run it:

1. In Google Cloud Console → Credentials → your Web client, add the site root (e.g. `https://your-host/`) as an **Authorized redirect URI** (in addition to the JavaScript origin), and copy the **client secret**.
2. On the host, run the broker with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ALLOWED_ORIGINS` (the site's origin) in its environment, and proxy `/api/` to it (port 8787 by default).
3. Build the app with `VITE_GOOGLE_TOKEN_BROKER=/api/token` (the `pi` job does).

The secret must never be put in a `VITE_` variable: everything in those ends up in the public bundle. The broker stores no tokens; if it is unreachable, the app falls back to the ordinary hourly sign-in.

## Data and privacy

Local-only data stays in that browser’s IndexedDB. When Google Sheets is connected, care records are written to the configured sheet and are governed by that Google account’s sharing settings. Exports may contain sensitive family and health information; handle them accordingly.

The repository contains neutral starter values only. Personal profile data, addresses, phone numbers, OAuth credentials, and spreadsheet IDs belong in the running app or local/deployment configuration, not in source control.

## License

BabySteps is available under the [MIT License](LICENSE).
