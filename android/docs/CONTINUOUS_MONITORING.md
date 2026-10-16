# Continuous monitoring and summary delivery

Version 0.4 adds persisted monitoring consent, an Android-native sound/event timeline, device-default light/dark mode, and optional HTTPS delivery. Start once and leave monitoring running through nights and naps. Explicit Stop disables recovery. Continuous monitoring is not guaranteed against power loss, force-stop, microphone revocation or manufacturer process restrictions.

## Install and start

Export existing data before connected tests, and Stop monitoring first. Tests disable delivery and delete the sessions they create, so synthetic events never reach the family sheet. Without the `leaveApksInstalledAfterRun` property AGP uninstalls the app after the run, erasing its database.

```bash
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug &&
ANDROID_SERIAL=1c23683a ./gradlew :app:connectedDebugAndroidTest -Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true &&
adb -s 1c23683a install -r app/build/outputs/apk/debug/app-debug.apk &&
adb -s 1c23683a shell am start -n com.babysteps.nurserysensor/.MainActivity
```

Tap Start Monitoring once. You do not need to start again for naps or each evening. Keep the phone plugged in, automatic date/time enabled, and the foreground notification enabled. Settings → Battery Optimization Settings opens Android's settings; select Babysteps and permit background operation on this dedicated phone. No exemption is silently requested.

The Android 10 OnePlus uses a sticky foreground service. Android can recreate it after process termination; boot (after the first unlock) and app-update receivers also resume previously enabled monitoring. Capture errors retry after 30 seconds when permission remains granted. Every recovered capture creates a new session; the old session's unknown tail is marked interrupted, not quiet. Explicit Stop persists disabled state before cancelling capture.

On Android 11+ this implementation conservatively requires a visible activity to resume a microphone session after interruption. After boot/update it posts a resume notification instead of starting a background microphone. Opening the app resumes prior consent while visible. Force-stop cannot be worked around: reopen the app to resume. Android's [foreground-service restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start) and [microphone service rules](https://developer.android.com/develop/background-work/services/fgs/service-types#microphone) take precedence over an always-on preference.

## Chart and dark mode

Reports shows a native Compose timeline with 1-hour, 12-hour and 24-hour ranges. Likely cry, speech and snoring episodes are aligned with sound levels and local manual feed/diaper markers. The usual 20:00–05:00 routine is a contextual band, not measured sleep. Actual sleep is unknown, including unlogged naps. Movement is not measured; microphone peaks do not identify motion. Google tracking events are not downloaded into the Android chart in this increment. Babysteps can later join them with delivered metadata by UTC timestamp.

The app follows the device's light/dark setting, including chart labels and lines. There is no separate theme setting to keep in sync. The dashboard renders at most 360 sound points and reads the latest 24 hours of bins for a continuous session; full exports retain the session history.

## One time receiver setup

Automatic delivery is off until you enter a receiver URL and token. No endpoint or token is hard-coded in the APK, and no Google credentials go on the phone.

### Babysteps Pi (recommended)

The Babysteps events API on the Raspberry Pi receives delivery at `POST /api/nursery` (`babysteps/src/server/nurseryApi.ts`). It writes to the family sheet with the Pi's service account, which the sheet is already shared with. The Pi is reachable from anywhere through Tailscale Funnel, so the phone works on any network.

1. Deploy a Babysteps build that includes `nurseryApi.ts`: push to `main`, then the Pi's `update.sh` picks it up within five minutes. Re-run `rpi/scripts/babysteps/install.sh`; it adds the `/api/nursery` nginx route and generates `NURSERY_API_TOKEN` in `~/babysteps/events.env`. That token is separate from `EVENTS_API_TOKEN`: it can write only the four Nursery tabs.
2. Read the token on the Pi: `grep NURSERY_API_TOKEN ~/babysteps/events.env`. Do not paste it into chat, source control or a sheet cell.
3. On the phone, Settings → Automatic summary delivery: URL `https://raspberrypi.tailc2b8e3.ts.net:8443/api/nursery`, that token, enable delivery, Save Delivery Settings, Sync Now.
4. The status should read `Last sync … queue clear`, and the four tabs listed below appear in the sheet. Tap Sync Now again: rows update rather than duplicate. `receiver HTTP 401` means a wrong token, `409` means a Nursery tab already holds rows under a different header, and `502` means the Pi could not reach the sheet (it retries).

While monitoring, the phone also reads `GET /api/nursery` with the same token every two minutes: the last feed and diaper from the Events tab and the last `baby_cry` episode. It shows them in the monitoring notification, which is public on the lock screen and redrawn every minute. After 20 minutes without a successful read it is marked stale. The Apps Script fallback has no read, so its notification stays plain.

The phone sends the token as `Authorization: Bearer`. The endpoint upserts by `recordKey` with one writer at a time, writes values RAW (a formula-looking string stays text), and replies with exactly the keys it stored.

### Apps Script fallback

`integration/google-apps-script/Code.js` implements the same contract as a Google Apps Script web app, for use without the Pi. Apps Script cannot read request headers, so the phone also sends the token in the request body. To use it: add the code to a standalone Apps Script project, set the Script Properties `SHEET_ID` (`1VG9px1j-KF29i2J6AG_PP57hOM8V-wLPgP-9VTdURUc`) and `NURSERY_TOKEN` (`openssl rand -hex 32`), deploy it as a web app executing as you, and enter its `/exec` URL and token on the phone. See [Google's deployment documentation](https://developers.google.com/apps-script/guides/web).

Revoke a lost token by changing it on the receiver and the phone. The token is stored in private Android preferences with backup disabled; this debug app is not hardened against a person with authorized ADB/root access to the phone.

## Machine readable sheet data

The sheet is shared with the Babysteps app, so it gets only what review and reports need, about 100 rows per day. Per-second measurements, per-minute levels, model frames, and ambient/unknown episodes stay on the phone; export JSON for detailed analysis. The receiver creates no charts and never edits the baby-tracking Events tab. It writes four tabs:

| Tab | Granularity | Main fields |
| --- | --- | --- |
| Nursery Nightly Summaries | One upserted row per night (local noon to noon, labelled by the evening's date) | nightOf, timezone, window, status (`in_progress`/`complete`), expected/captured/valid ms, coveragePercent, sessions, average/peak dBFS, cry episodes/total/longest, speech, snoring and cough counts/totals, ambientNoiseMs |
| Nursery Sound Episodes | One completed episode (baby_cry, speech, snoring, cough) | sessionId, episodeId, label, startUtc, endUtc, durationMs, maxScore, source |
| Nursery Sound Levels | One wall-clock 15-minute interval per session (:00/:15/:30/:45), clipped to the session | startUtc, endUtc, durationMs, validMs, coveragePercent, soundLevelDbfs, peakDbfs, clippedWindows |
| Nursery Sessions | Upserted capture-health row per session | UTC boundaries/observed-through time, status/errors, coverage, average/peak dBFS, model identity/status/errors, inference counts/latency/drops, app version/timezone, unknown sleep/unmeasured movement |

Every row starts with `recordKey` and `schemaVersion`. Delivery schema 2 is separate from full local export schema 2. Schema 1 (per-minute rows) was never deployed; upgrading drops its unsent queue, and the receiver rejects it. If a **Nursery Minute Summaries** tab exists from earlier setup, delete it. A tab created by hand with only a header row is given the receiver's header automatically; a tab with data rows and a different header is refused rather than overwritten.

For Babysteps: Nightly Summaries are the report row; Sound Episodes are the input for future suggested events (for example, a likely cry at 02:13). Sound Levels support a coarse night chart and future quiet/sleep-window suggestions. The nursery app makes no sleep, mood or movement claims: `sleepState` is always `unknown` and `movementState` is `not_measured`, and suggestions belong in Babysteps, labelled as suggestions. Timestamps are ISO-8601 UTC strings; numeric cells stay numeric and missing values are blank. Sound is uncalibrated dBFS, not SPL. A model score is not a probability or ground-truth label.

Averages use valid-duration-weighted energy, not averages of decibels. A 15-minute row is queued when the interval closes (or at Stop/interruption for the partial last one). The current and previous nights are recomputed every sync, so late episodes update the summary. Episodes upload only when confirmed and closed. A year of continuous monitoring is roughly 35,000 interval rows, comfortably within Sheets' limits; a backend database is still the right next step if more detail is wanted.

The service attempts HTTPS delivery every five minutes, at most four batches of 100 records per cycle. SQLite stores pending records across process death and offline periods. Acknowledgements must contain exactly the submitted keys. Updated session summaries cannot be erased by stale acknowledgements. The receiver upserts by recordKey under a script lock; a retry after a lost response does not append duplicates. Apps Script's [ContentService response redirect](https://developers.google.com/apps-script/guides/content) is followed with GET, without forwarding the token/request body to the redirected host.

While monitoring is stopped, automatic delivery is stopped too. Tap Sync Now or resume monitoring to drain queued final data. Capture does not wait for networking. Delivery errors leave numeric data local and show a retry status. Device tests intentionally disable delivery; re-enable it after testing.

All local observations, predictions, queued/sent metadata and sessions currently remain until app data is cleared. For multi-week operation, monitor storage growth and establish a retention/archive policy before claiming unattended long-term reliability. Apps Script/Sheets also have capacity and execution quotas; a backend database is the appropriate next step if the feed outgrows a personal spreadsheet. No automatic deletion was added.

## Verification

```bash
node integration/google-apps-script/receiver.test.mjs
```

Pure Kotlin tests cover signal statistics, cleanup, episode detection, timeline energy averaging/gaps/bounds, and HTTPS URL validation. Device tests additionally cover migration to schema 3, a durable delivery queue and stale acknowledgement protection. Local mocked receiver tests cover token enforcement, upserts/retries, device/field validation, rejection of raw-audio fields and fabricated sleep states, and formula-injection escaping. These are not a deployed end-to-end delivery test.

After installing, verify light/dark mode on the phone, Start/Stop and screen-off capture, an optional Android 10 reboot recovery rehearsal, and actual HTTPS acknowledgements. Do not reboot, upgrade or run instrumentation tests during tonight's real collection. Keep a first-night export as a fallback even when sync is configured.
