# Prototype build and device history

Archived README from `oneplus` at c60348b. Statements such as "no networking"
and "single screen" describe earlier versions, not today’s app. For current
setup and commands use [the Android README](../README.md), and for architecture
use [the native app guide](../../docs/BABYSTEPS_APP.md).

# Babysteps (Android) and the Nursery Sensor

Version 0.4 verification (2026-10-12, OnePlus 5T / Android 10): `assembleDebug`, 38 JVM unit tests, `lintDebug` (0 errors), the Apps Script receiver's mocked tests and all 6 connected device tests pass. Device tests ran with `-Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true` so AGP does not uninstall the app and erase its database. Automatic sheet delivery is live (2026-10-12) through the Babysteps Pi at `/api/nursery`: the phone's first sync was acknowledged, rows appeared in the four Nursery tabs, and a repeat sync updated rows without duplicating them.

A small native Kotlin / Jetpack Compose Android app for a plugged-in nursery phone. It measures sound levels, runs optional experimental local YAMNet classification, saves overnight numeric summaries and likely sound episodes, and exports reports. No audio recording files, automatic uploads, camera, or speech transcription are implemented.

For version 0.4, follow [Continuous monitoring and summary delivery](CONTINUOUS_MONITORING.md) for always-on recovery, the native timeline, device-default dark mode and optional automatic sheet delivery. [Local sound classification](CLASSIFICATION.md) remains offline; HTTPS delivery sends metadata only and requires one-time receiver setup. The implementation roadmap is in [Overnight monitoring and reporting plan](OVERNIGHT_PLAN.md).

Supports Android 8.0+ (API 26). App ID: `com.babysteps.nurserysensor`.

## 1. Open and set up the project

1. Install the current stable [Android Studio](https://developer.android.com/studio). Use a release supporting Android Gradle Plugin 9.4 (Rabbit 1 or newer). No Play account is needed.
2. Choose **Open** and select this directory (`android`, containing `settings.gradle.kts`), not the `app` subdirectory.
3. In **Tools → SDK Manager**, install **Android 17 / API 37.0**, **Android SDK Build-Tools 36.0.0**, and **Android SDK Platform-Tools**. The emulator is optional. Accept the SDK licenses.
4. In **Settings → Build, Execution, Deployment → Build Tools → Gradle**, select Android Studio's bundled JDK as the Gradle JDK. JDK 17+ is required; JDK 21 is a good command-line choice. The system Java 11 is too old.
5. Let Gradle sync finish. The first sync/build needs internet access for Gradle and Maven dependencies. Android Studio normally creates `local.properties` with your SDK path; this file is ignored by Git.

Pinned tooling: AGP 9.4.0, Gradle 9.6.0, Kotlin / Compose compiler 2.3.20, Compose BOM 2026.09.00, compile/target SDK 37.0. AGP 9 uses built-in Kotlin; there is intentionally no separate `org.jetbrains.kotlin.android` plugin. Versions are in the two `build.gradle.kts` files.

These choices follow the [AGP compatibility table](https://developer.android.com/build/releases/agp-9-4-0-release-notes), [built-in Kotlin guide](https://developer.android.com/build/migrate-to-built-in-kotlin), and [Compose BOM guide](https://developer.android.com/develop/ui/compose/bom).

For a terminal on macOS, run these before the build (adjust the SDK path on other systems):

```bash
cd android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
java -version
```

If building outside Android Studio, `ANDROID_HOME` points Gradle to the SDK. Windows uses `gradlew.bat` instead of `./gradlew` and its installed SDK/JDK paths. No global Gradle installation is needed.

## 2. Prepare the phone and verify ADB

1. On the phone open **Settings → About phone**. Find **Build number** (on some phones under Software information) and tap it seven times. Enter the phone PIN if requested. This enables Developer Options.
2. Open **Settings → System → Developer options** (the location varies by manufacturer). Enable **USB debugging**.
3. Connect with a USB cable that supports data, unlock the phone, and accept **Allow USB debugging?** for your computer. You can enable “Always allow from this computer” on your own computer.
4. On your computer run:

```bash
adb devices
```

The serial number must have status `device`. For `unauthorized`, unlock the phone and approve its dialog. If empty, try another cable/port and a USB data/file-transfer mode. Windows may require the manufacturer's USB driver. If multiple devices are listed, use `adb -s YOUR_SERIAL ...` with each command.

## 3. Build, install, and run

```bash
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.babysteps.nurserysensor/.MainActivity
```

`adb install -r` installs the app the first time and updates it later. Preserve the same debug signing key for updates. If a different computer's key causes `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, uninstalling the old app resets its permissions/data; use that only if you intend the reset. No release signing or Play Store configuration is required for this personal debug install.

You can also select the phone and press **Run ▶** in Android Studio.

In the app:

1. Tap **Grant Permissions**. Allow microphone access “While using the app” and notifications when prompted. If previously denied permanently, use **App Settings → Permissions**.
2. Tap **Start Monitoring** while the app is visible. Granting permission alone does not start monitoring.
3. Confirm **Monitoring: On**, **Service status: Running**, and changing numeric values. A microphone privacy indicator and a nursery monitoring notification should appear.
4. Turn the screen off. The foreground service continues capturing independently of the activity.
5. Tap **Stop Monitoring** in the app or notification. “Stopped” is published after microphone and wake-lock cleanup. Last-session numbers remain visible, labeled as historical. Starting again clears them.

Notifications are requested but not a prerequisite for capture on Android 13+. If denied or the notification channel is disabled, Android can hide the drawer notification while still listing the foreground service in its active-app task manager. Enable notifications/channel in App Settings for the intended persistent drawer display. The app never suppresses Android privacy indicators.

## The Babysteps app (phone)

The app opens on Babysteps itself — the web app's Home, Log, Reports, Care,
Shopping, To-do and Settings, rebuilt natively in Compose — with the nursery
monitor as one more tab, **Nursery**, which only this Android app has.

- **Data goes through the Pi**, not Google sign-in: `GET /api/events/app` reads
  the whole tracker (gzipped) and `POST /api/events/app` runs one store op, with
  the Pi's `APP_API_TOKEN` (in `~/babysteps/events.env`; enter it in Settings →
  Babysteps Pi). See the root `AGENTS.md` → "The native Android app".
- **Offline first**: every change lands in a durable outbox and on screen at
  once, and sends in order; the phone names its own ids so a retry never writes
  twice. The last read is cached, so the app opens with no signal.
- **Ported logic** lives in `care/domain` (one object per `babysteps/src/domain`
  module) and is tested in `CareDomainTest`. The reference CSVs are packaged directly from
  `../src/data/reference` by Gradle; edit them there. Icons are Lucide (generated from
  the web app's `lucide-react`), fonts Quicksand and Fraunces (OFL, licences in
  `assets/licenses`).
- **Not ported**: Google sign-in, family setup, sheet sharing and invites (the
  web app does those), and the night-shift backfill (off in the web app too).
  Every person is shown, so the phone is the full view, not the caregiver one.

Build, deploy, code map and future work (including native sign-in): [../docs/BABYSTEPS_APP.md](../../docs/BABYSTEPS_APP.md).

## Pixel Watch app (`:wear`)

A standalone Wear OS app (`com.babysteps.watch`, no phone companion). It shows
the last feed, diaper and sleep, times a nursing feed, and logs bottles and
diapers. It talks to the Babysteps Pi over the watch's own connection (Wi-Fi,
LTE or the phone's Bluetooth proxy):

- `GET /api/events/status` every minute while the app is open, for the
  status lines. "Not updated since…" means the read is over 10 minutes old.
- `POST /api/events` for each entry, with `Authorization: Bearer
  $EVENTS_API_TOKEN`. Every entry is queued on the watch with the time it was
  tapped, then sent, so an entry tapped with no signal goes out later at its
  own time. A 400 is shown and dropped; a 401, 5xx or no network keeps it
  queued.
- The feed timer is local, because the Pi cannot run one. Done sends one
  finished nursing feed: `timestamp` is the start, `durationMinutes` the time
  nursing with pauses left out, and the side is `both` only if each side had
  at least a minute. While it runs it shows as an
  ongoing activity on the watch face.

Install and set up:

1. On the watch: Settings → Developer options → Wireless debugging → Pair new
   device. Then on the Mac: `adb pair <ip>:<pair-port> <code>` and
   `adb connect <ip>:<port>`.
2. `./gradlew :wear:assembleDebug` and
   `adb -s <ip>:<port> install -r wear/build/outputs/apk/debug/wear-debug.apk`.
3. In the app: Settings. The URL defaults to the Pi. Tap the token field, then
   on the Mac run `adb -s <ip>:<port> shell input text "$(ssh <pi> "sed -n 's/^EVENTS_API_TOKEN=//p' ~/babysteps/events.env")"`.
   Leave Child blank unless the family has more than one. Save.

Design: the Babysteps app's dark theme and its Lucide icons (feed blue with
`milk`, diaper amber with `wind`, sleep violet with `bed`/`moon`; see
`wear/.../Theme.kt`). Home leads with time since the last feed. The nursing
timer screen has per-side times, pause, and Done on the bottom edge. Bottle
amounts are set with the crown in half ounces. An entry is confirmed as soon
as it is saved on the watch, and sent in the background. Opening the app while
a timer runs goes straight to the timer. `--es screen timer|bottle|diaper|settings`
on the launch intent opens that screen (for a future Tile, and for checking
over adb).

The pure logic (status text, timer and request bodies) is unit tested in
`wear/src/test` with `./gradlew :wear:testDebugUnitTest`.

## What the numbers mean

- Capture: **16,000 Hz, mono, signed 16-bit PCM**, using Android `AudioRecord` with the broadly supported `MIC` source.
- Window: **4,000 samples / 250 ms**. Partial reads accumulate into a complete window before processing.
- RMS amplitude: `sqrt(mean((sample / 32768)²))`, normalized to 0–1.
- Current level: `20 * log10(RMS)`, displayed in **dBFS** (decibels relative to digital full scale).
- Window peak: `20 * log10(max(abs(sample / 32768)))`.
- Session peak: highest window peak since this monitoring session started.
- Rolling average: `10 * log10(mean(window mean-square powers))` for the latest **120 windows / 30 seconds**. During startup it uses available windows. This is an energy average, not an arithmetic mean of decibels.
- Live numeric history: latest **240 windows / 60 seconds** in RAM. Process death clears only this live dashboard buffer.
- Overnight storage: one-second numeric buckets and manual markers in app-private SQLite. Saved sessions survive normal process death and app updates; no automatic deletion is enabled for the first night. The report excludes silenced input from sound averages and distinguishes it from unobserved time. Stop flushes the partial final bucket.
- Exact zero is displayed as **−120 dBFS** to avoid infinity. Louder input approaches **0 dBFS**; positive acoustic-looking readings like “32 dB SPL” would imply a calibration we do not have.

**This is not calibrated sound pressure level (dB SPL).** Microphone gain, manufacturer processing/AGC, placement, cases, and individual phones affect readings. Use it for relative changes in the same setup. It is not a laboratory sound meter or a medical/safety alarm. On Android 10+, a silenced recording configuration produces an explicit warning and metadata flag, rather than treating Android-supplied zeros as proof of a quiet nursery.

An observation conceptually looks like this (there is no network serializer in V1):

```json
{
  "timestamp": "2026-10-12T12:00:00Z",
  "soundLevel": -32.4,
  "peakLevel": -18.7,
  "rmsAmplitude": 0.02399,
  "rollingAverage": -35.2,
  "sessionPeak": -14.3,
  "microphoneSilenced": false
}
```

## Architecture and important files

One app module, native SQLite for reports, and a MediaPipe adapter isolated from the service; no dependency injection framework:

```text
MainActivity (Compose dashboard, runtime permissions, visible Start tap)
    → MonitoringService (foreground lifecycle + notification + wake lock)
        → AudioCapture (IO worker / temporary PCM window)
            → AudioStatistics → SoundObservation → MonitoringStore → dashboard
            → NightAccumulator → NightRepository (SQLite) → NightReports / JSON / CSV
            → bounded ClassificationPipeline → YAMNet adapter → scores → EpisodeDetector
            → EventSink (numeric/classification metadata only; no-op today)
```

| File under `app/src/main/java/com/babysteps/nurserysensor/` | Purpose |
| --- | --- |
| `MainActivity.kt` | Single screen; Compose collects lifecycle-aware `StateFlow` snapshots. |
| `monitoring/MonitoringService.kt` | Starts foreground immediately, launches capture, handles notification Stop and cleanup. |
| `monitoring/MonitoringStore.kt` | Shared process-local state and bounded numeric history; Main-thread writes. |
| `monitoring/SensorLog.kt` | Structured JSON logcat entries, metadata only. |
| `audio/AudioCapture.kt` | Owns `AudioRecord`; nonblocking reads and cancellation checks; erases PCM windows and releases recorder in `finally`. |
| `audio/AudioStatistics.kt` | Pure Kotlin signal math, observations, bounded history. |
| `audio/AudioClassifier.kt` | Framework-independent borrowed-window contract and relevant scores. |
| `events/EventSink.kt` | Metadata event model and suspend sink interface; `NoOpEventSink` is used now. |
| `reporting/NightModels.kt` | One-second power aggregation, coverage and persisted report models. |
| `reporting/NightRepository.kt` | Native SQLite sessions, summaries, markers and interruption recovery. |
| `reporting/NightReports.kt` | Saved-session report, minute timeline, manual markers and document-picker export. |
| `reporting/NightExport.kt` | Versioned JSON and numeric CSV with explicit units and UTC timestamps. |
| `classification/YamnetClassifier.kt` | MediaPipe CPU adapter and relevant-category mapping. |
| `classification/ClassificationPipeline.kt` | Separate bounded inference worker, erasure, timing, drops and failure handling. |
| `classification/DetectionModels.kt` | Pure Kotlin PCM window assembly and per-category episode hysteresis. |

`app/src/main/AndroidManifest.xml` declares the permissions and a non-exported microphone service. `app/src/test/.../AudioStatisticsTest.kt` tests pure logic; `app/src/androidTest/.../MonitoringDeviceTest.kt` exercises the real device workflow.

Think of `MonitoringStore` as a small in-process reactive store, and the foreground service as an OS-managed worker whose lifetime is separate from the screen. Rotation or leaving the dashboard does not stop monitoring. Main-thread state writes make the numeric history safe to collect from Compose.

## Foreground service and permissions

| Permission | Why |
| --- | --- |
| `RECORD_AUDIO` | Runtime microphone access. |
| `POST_NOTIFICATIONS` | Runtime notification visibility on Android 13+. |
| `FOREGROUND_SERVICE` | Declare foreground work. |
| `FOREGROUND_SERVICE_MICROPHONE` | Modern microphone foreground-service permission. |
| `WAKE_LOCK` | Partial wake lock only during capture, to keep CPU processing with screen off. |
| `RECEIVE_BOOT_COMPLETED` | Recover prior monitoring consent on Android 10; post a resume notification on newer Android. |
| `INTERNET` | Optional HTTPS numeric-summary and event-metadata delivery; never audio. |

The visible, resumed activity starts the service from an explicit button tap after microphone permission is granted. The service declares `foregroundServiceType="microphone"` and passes the microphone type to `startForeground` on Android 11+. Older phones use the two-argument foreground-service API. This follows Android's [while-in-use foreground service restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start) and [microphone service requirements](https://developer.android.com/develop/background-work/services/fgs/service-types#microphone).

After an explicit Start, monitoring consent persists across process death. The Android 10 nursery phone uses `START_STICKY` and boot/update recovery; capture failures retry after 30 seconds while permission remains granted. Stop disables recovery. On Android 11+ a visible app is required to resume after an interruption; boot/update posts a resume notification. Force-stop, power loss and manufacturer restrictions cannot be bypassed. See [recovery behavior and setup](CONTINUOUS_MONITORING.md).

Stop cancels the capture coroutine. Nonblocking reads check cancellation frequently; `finally` erases samples, stops/releases `AudioRecord`, releases the wake lock, updates status, removes the notification, and stops the service. Errors follow the same cleanup path and appear on the dashboard. Repeated Start requests cannot create multiple recorders.

## Privacy boundary and future additions

```text
microphone → bounded RAM-only PCM → local statistics / classification → metadata
```

PCM is never logged, saved, sent to a sink, or retained in the store. A reused 250 ms buffer is zeroed after processing and on exit; platform audio buffers are released with the recorder. Version 0.4 adds `INTERNET` for explicitly enabled metadata delivery and `RECEIVE_BOOT_COMPLETED` for recovery; there is still no storage or camera permission. Numeric reports and the durable delivery queue use private SQLite. AndroidX can create `files/profileInstalled`; MediaPipe can cache the bundled model at `cache/drishti_asset_cache/yamnet.tflite`. Neither is audio. MediaPipe Tasks also logs usage events through Google datatransport; the manifest removes its `cct` upload backend, so those events are discarded on the phone and never sent to `firebaselogging.googleapis.com`. The privacy test exempts only those exact cache files and verifies the cached model hash. Cleartext network traffic and backups are disabled. Manual care notes are not uploaded by automatic delivery.

Local classification now uses a YAMNet adapter behind `AudioClassifier`, on a separate worker with one pending window. It assembles 975 ms inputs every second, clears borrowed/queued PCM, and converts relevant scores into experimental episodes using class-specific thresholds. The service imports no MediaPipe classes. Numeric capture continues if classification fails; session metadata retains model identity, status, timing and drops. See `docs/CLASSIFICATION.md` for exact policies and limits. Stored relevant model scores allow episode thresholds to be re-evaluated tomorrow without keeping audio, but another model cannot retrospectively classify discarded PCM.

For Home Assistant / Raspberry Pi integration, implement `EventSink.send(NurseryEvent)` with a user-configurable endpoint. Only metadata should be serialized. Add networking permission, timeouts, and a bounded asynchronous delivery queue at that time, so a slow/offline server does not stall capture. There is no URL or network client today.

Camera can be an independent `camera/` subsystem producing its own metadata events through `EventSink`. Add its permission, foreground-service type, capture lifecycle, and numeric movement model when implementing it. Do not couple camera frames to the current audio service or store raw frames by default. No camera code or permissions are present now.

## Logs and diagnostics

```bash
adb logcat -v time NurserySensor:I '*:S'
adb shell dumpsys activity services com.babysteps.nurserysensor
adb shell dumpsys audio
adb shell dumpsys power
```

For crash diagnostics:

```bash
adb logcat -v time AndroidRuntime:E NurserySensor:I '*:S'
```

Structured entries include `service_created`, `microphone_opened`, `audio_statistics` (every 10 seconds), `stop_requested`, `capture_cancelled`, `microphone_released`, `monitoring_finished`, `service_destroyed`, and failures. No raw samples or speech contents are logged.

## Tests and phone verification

```bash
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
./gradlew :app:connectedDebugAndroidTest
```

Unit tests cover silence, RMS/dB conversion, negative full-scale overflow, sine-wave energy, averaging and eviction, session-peak reset, bounded history, invalid inputs/confidence, silenced-input metadata, and observations containing no PCM. The device test needs an initially unlocked device with a usable microphone (API 34+ recommended); a fresh install exercises the actual permission dialog. It launches the dashboard, starts/stops from the UI, starts a second session, checks notification and screen-off observations, then invokes the notification's actual Stop PendingIntent while locked. Both stops check no active recording configuration and no further observations; the test also compares private data files before/after. It does not dismiss or bypass a PIN lock screen. Permission-controller button IDs can differ on manufacturer devices; use the manual checklist if that automation needs adaptation.

Version 0.2 adds aggregation tests for power averages, partial final buckets, gaps, silenced input, clipping, coverage and CSV formatting, plus regression tests for cancellation during final persistence and release on a storage failure (22 unit tests total). The device test additionally verifies a completed saved session, manual-marker JSON escaping, JSON schema/CSV row counts, and saved buckets through a second SQLite connection. Run connected tests before real collection: the runner may uninstall/reinstall and erase app-private data. Export real nights before any later connected-test run.

Manual acceptance checklist:

1. Fresh install: microphone is not granted, Start is disabled. Deny microphone access: no service starts. Grant from the app or App Settings: dashboard updates and Start enables.
2. Start: microphone indicator, foreground notification, start time and numeric readings appear. Clap near the phone; levels and session peak rise.
3. Lock the phone for several minutes, then reopen: monitoring stayed On and the start time stayed the same. An overnight run on the target phone is the reliability check.
4. Stop from dashboard: service/notification disappear, microphone indicator clears, and values stop changing. Start again and test Stop from notification, plus rapid Start/Stop taps and rotation.
5. Deny notifications: monitoring can still run; the dashboard explains drawer visibility. Grant notifications for regular use. Toggle Android's microphone privacy control while running and check the silenced warning (Android 10+).
6. Stop and inspect `dumpsys audio`/`dumpsys power`; there should be no active recording for this app or held `Babysteps:AudioMonitoring` wake lock. Start another audio app to confirm microphone access is available.
7. Inspect app-private files before/after several minutes of monitoring using the debug build:

```bash
adb shell run-as com.babysteps.nurserysensor find . -type f
```

There should be no recording, PCM, WAV, or audio files. The source has no writes and no network permission. Force-stop or reboot: monitoring remains Off until explicitly started again.

### Verified results (2026-10-12)

The user ran Gradle and ADB in a regular terminal because this agent's sandbox blocks ADB and Gradle's local sockets. The saved test reports and device logs were inspected afterward.

- **Passed:** debug APK assembly and lint (warnings remain; no lint errors).
- **Passed:** all 13 Gradle unit tests.
- **Passed:** ADB install and app launch on `1c23683a`, OnePlus A5010, Android 10.
- **Passed:** the final `connectedDebugAndroidTest` report contains 1 test, 0 failures, 0 errors, 0 skips.
- **Verified on that phone:** microphone permission approval; foreground capture and notification; dashboard Stop; starting a new session; observations continuing while screen off; notification Stop PendingIntent; microphone release, notification removal and no further observations after each Stop; no unexpected private files created (only AndroidX's known `files/profileInstalled` cache is excluded).

The device test handles Google/AOSP permission controllers, does not try to dismiss the phone's PIN lock screen, and waits for asynchronous notification removal. The final run took approximately 12 seconds on-device; screen-off capture was checked for 2 seconds. Overnight reliability, permission denial/permanent denial, and newer-Android foreground-service behavior remain separate manual/device checks. Leave the phone initially unlocked and let automation operate without tapping during test runs.

Version 0.2 verification: all 22 JVM tests passed, the corrected cleanup sequence passed the device test, and the user installed/rehearsed JSON export. A pulled 10.869-second rehearsal JSON was checked: 11 buckets, 10.5 seconds of valid measurements, matching energy/peak/coverage totals, no silenced input or clipping, and metadata-only output. The phone's June date required correction before the real night. Gradle remains blocked in this agent's sandbox by its local lock socket (`Operation not permitted`).

The checked-in wrapper JAR was assembled from Gradle 9.6.0 wrapper/CLI/helper classes bundled with the installed Android Studio, because download access was unavailable. See `gradle/wrapper/NOTICE.md`. Once dependencies are available, `./gradlew wrapper --gradle-version 9.6.0 --distribution-type bin` can regenerate standard wrapper artifacts.

Version 0.3 verification: 31 JVM unit tests pass. The user-run Gradle build/unit tests/lint succeeded, and all app Kotlin sources compile locally against the actual downloaded MediaPipe dependency. The October 12 OnePlus run passed model silence/no-network, schema migration, and graceful model-load failure tests. The live monitoring test passed capture, screen-off, Stop cleanup, persistence and JSON checks, then failed its final file comparison because MediaPipe caches the bundled model. That assertion now verifies and permits only the exact model cache; rerun all four device tests to confirm the fix. Gradle/ADB remain blocked by local socket restrictions for this agent. Rehearse document-picker JSON/events export on the phone before tonight.
