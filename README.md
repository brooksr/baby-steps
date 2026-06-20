# BabySteps

Mobile-first React tracker for Theo Roche.

## Google Sheets Storage

The app targets this spreadsheet:

https://docs.google.com/spreadsheets/d/1VG9px1j-KF29i2J6AG_PP57hOM8V-wLPgP-9VTdURUc/edit

Browser writes to Google Sheets require Google OAuth. Create a `.env.local` file with:

```bash
VITE_GOOGLE_CLIENT_ID=your-google-oauth-web-client-id.apps.googleusercontent.com
```

Restart the dev server, open Settings, and connect the Google Sheet. Until connected, the app uses local IndexedDB fallback storage.
