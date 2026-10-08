# BabySteps

BabySteps is a private, offline-first progressive web app for tracking baby care and sharing the log with a household. It runs entirely in the browser, stores data locally with IndexedDB, and can optionally synchronize through a Google Sheet you control. There is no BabySteps backend.

## What it tracks

- Feeds, pumping, diapers, sleep, baths, tummy time, temperature, mood, medication, appointments, growth, and notes
- Feed, sleep, and pumping timers; diaper and feeding predictions; newborn range checks; and daily summaries
- WHO growth charts, first-year reports, milestones, vaccination schedules, and age-based “What to expect” guidance
- Multiple child and parent profiles, caregiver attribution, reversible profile archiving, shared tasks, and a shopping list
- Parent sleep and care-load reports, menstrual-cycle logging, and food, drink, and symptom logs

BabySteps is a record-keeping aid, not medical advice or a diagnostic tool.

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

1. Create a Google Cloud project and enable the Google Sheets API.
2. Configure the OAuth consent screen and create a Web application OAuth client.
3. Add each development or production site origin to the client’s authorized JavaScript origins.
4. Create a blank Google Sheet and set the two environment variables above.
5. Start BabySteps, open Settings, and connect Google Sheets.

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
2. Add repository variables named `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_SHEET_ID` if the hosted build should use Google Sheets.
3. Add the deployed site’s origin to the OAuth client’s authorized JavaScript origins.

The current Vite base path is `/baby-steps/`. If the repository or hosting path is different, update `base` in `vite.config.ts` before deploying.

## Data and privacy

Local-only data stays in that browser’s IndexedDB. When Google Sheets is connected, care records are written to the configured sheet and are governed by that Google account’s sharing settings. Exports may contain sensitive family and health information; handle them accordingly.

The repository contains neutral starter values only. Personal profile data, addresses, phone numbers, OAuth credentials, and spreadsheet IDs belong in the running app or local/deployment configuration, not in source control.

## License

BabySteps is available under the [MIT License](LICENSE).
