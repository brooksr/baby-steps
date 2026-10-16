# First overnight test

For version 0.4, start once for continuous night/nap capture; no nightly schedule is needed. Configure optional [summary delivery](CONTINUOUS_MONITORING.md) once if using the receiver. The morning Stop/export below is a first-night verification step, not a daily requirement. Resume afterward to capture naps, or leave monitoring on and review automatically delivered data once live sync has been verified.

Version 0.3 can collect sound measurements plus experimental local classifications and likely episodes. Follow [Local sound classification and reporting](CLASSIFICATION.md) for the model build and rehearsal. No manual crying notes are needed. Keep the existing feed/diaper notes with timestamps; tomorrow we can compare those care events with sound activity. No raw audio is retained, so the night cannot be retrospectively reclassified with a different model, and care notes cannot prove which sounds were crying.

## Build and verify before collecting the night

Run from the project directory in your regular terminal:

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
ANDROID_SERIAL=1c23683a ./gradlew :app:connectedDebugAndroidTest
adb -s 1c23683a install -r app/build/outputs/apk/debug/app-debug.apk
adb -s 1c23683a shell am start -n com.babysteps.nurserysensor/.MainActivity
```

Unlock the phone for the device test and do not touch it during automation. Run the device test BEFORE tonight's data collection: the test runner may uninstall/reinstall the app and erase its private database. Installing with `adb install -r` preserves data. Do not uninstall, clear app storage or run connected tests after the real night until the reports have been exported.

## Before bed

1. Enable automatic date and time on the phone. Earlier test logs had a June date while the computer was in October. The report shows phone time and stores UTC timestamps plus the session timezone.
2. Grant microphone and notifications. Tap Start Monitoring. Confirm On, Running and changing measurements.
3. Open Reports. Confirm a new recording session appears and its saved bucket count grows after 5–10 seconds. On Monitor, classification should say Running locally and display scores. If it shows a storage error, stop and resolve it before the overnight run. A classifier error leaves numeric monitoring running and must be recorded before choosing whether to disable classification.
4. Make a small sound and check the level changes. Save an `ambient_noise` manual marker with the phone's placement and white-noise/fan settings in the note. Confirm marker count increases.
5. Stop this short rehearsal, export JSON to Downloads and confirm the file exists in Files. Open/reopen the app and confirm the rehearsal report is still listed. Export CSV too if desired.
6. Start a NEW session for the actual night. Leave the phone plugged in in a consistent position and turn the screen off. Do not reboot or force-stop. Continue your existing feed and diaper notes; optional in-app care markers are available but you do not need to duplicate your notes or annotate crying.

## In the morning

1. Reopen the app. Check whether monitoring is still On and inspect session continuity. Version 0.4 can automatically recover on the Android 10 nursery phone; recovered sessions do not prove uninterrupted capture. Note gaps and errors.
2. Tap Stop Monitoring and wait for Stopped. This flushes the final partial numeric bucket.
3. Select the overnight session under Overnight reports. Check status, elapsed duration, valid capture coverage, silenced/unobserved time, energy average, peaks and minute timeline.
4. Tap Export JSON and save to Downloads as `babysteps-session-ID.json`. Export CSV as `babysteps-session-ID.csv`. JSON contains all session metadata and manual markers; CSV contains the numeric observations for plotting. Exports are UTF-8; JSON timestamps are UTC ISO-8601; CSV uses CRLF and decimal points.
5. Share both files tomorrow, along with bedtime/wake time, room conditions and the timestamped feed/diaper notes (include timezone/date). Reports contain no audio. Care notes are context, not sound labels.

Saved sessions survive normal app closure, reboot and `adb install -r` updates. If Android terminates capture abruptly, the next app launch marks the saved session interrupted and uses the last persisted heartbeat as its end. The unknown tail is explicit; an unfinished bucket may be lost. No automatic deletion is enabled for this first run.

## Data format and recovery

JSON schema version 2 includes `session`, `capture`, `classification`, `summary`, `observations`, `markers`, `predictions` and `episodes`. Classification status/model/hash identify whether local inference actually worked. Markers have `source: "manual"`; episodes have `source: "model_experimental"`. Per-bucket `meanSquare` is normalized PCM energy, and `soundLevelDbfs`/`peakDbfs` are uncalibrated relative levels. Silenced-only buckets have null sound values. Missing buckets are not fabricated. Sample durations derive from complete 250 ms audio windows; elapsed time and bucket offsets use a monotonic clock. Coverage is the measured valid sample duration divided by elapsed duration (capped at 100%); this is sample coverage, not proof that the microphone heard every event. Numeric CSV keeps the earlier schema 1 shape; events have their own schema 2 CSV.

SQLite stores sessions, bins and markers in app-private `nursery-nights.db`. The on-phone export is the preferred transfer method. If export fails, Stop first and copy all three database/WAL files without uninstalling:

```bash
mkdir -p overnight-backup
adb -s 1c23683a exec-out run-as com.babysteps.nurserysensor cat databases/nursery-nights.db > overnight-backup/nursery-nights.db
adb -s 1c23683a exec-out run-as com.babysteps.nurserysensor cat databases/nursery-nights.db-wal > overnight-backup/nursery-nights.db-wal
adb -s 1c23683a exec-out run-as com.babysteps.nurserysensor cat databases/nursery-nights.db-shm > overnight-backup/nursery-nights.db-shm
```

WAL/SHM may be absent if SQLite checkpointed and closed; an absent-file message for those optional files is expected. Keep the files together. Do not open or edit the live database on the phone. The export can also be copied from Downloads with `adb pull /sdcard/Download/babysteps-session-ID.json .` after selecting that location in the picker.
