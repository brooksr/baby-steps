# Overnight monitoring and reporting plan

## Continuous monitoring update

Version 0.4 changes the intended operation from separate nightly starts to one explicitly enabled continuous capture for nights and naps. It adds conservative Android 10 restart/boot recovery, device-default light/dark theme, and a native sound/event timeline. Google Sheets is a metadata destination, not the chart UI. Optional HTTPS summary delivery uses a durable queue and a supplied token-protected Apps Script receiver; it remains disabled until the receiver is deployed and configured. See [Continuous monitoring and summary delivery](CONTINUOUS_MONITORING.md) for setup, schemas, recovery limits and verification. Sleep remains unknown when unlogged; the 20:00–05:00 routine is context only. Movement is not measured.

Babysteps Nursery Sensor will become a local sound monitoring and reporting app. Tonight's first run establishes sound patterns and monitoring reliability. The next increment adds on-device classification and validates whether likely crying can be detected usefully in this nursery.

Version 0.2 persistence/export was verified on the phone, including a pulled rehearsal JSON whose totals and format were checked. Version 0.3 now implements the MediaPipe/YAMNet adapter, bounded CPU worker, experimental episodes, richer reporting and Monitor / Reports / Settings UI. Thirty-one JVM unit tests pass; the native model/dependency and database migration still need networked Gradle/device verification. See [Local sound classification and reporting](CLASSIFICATION.md) before tonight.

## First night

Persist session metadata, one-second numeric summaries, microphone-silenced coverage, service errors and manual event markers. Show saved sessions and summaries on the phone and export versioned JSON plus CSV. Preserve partial sessions after process termination. Do not persist raw audio or interpret numeric amplitude as a classification.

Use native SQLite for this first persistent version to avoid additional build dependencies before tonight. Keep the database access behind one small repository; Room can replace it later if useful. Keep all nights until explicit deletion is implemented. Export is initiated by the user and contains metadata only.

Before bed, install the updated debug APK without uninstalling, enable automatic phone date/time, start monitoring, and verify that persisted summaries increase. Place the plugged-in phone consistently. Note white-noise/fan settings. The family will keep their existing feed and diaper notes; no manual crying annotations are expected. Those care timestamps can be compared with sound patterns tomorrow. Optional in-app markers are feed, diaper, room_note and ambient_noise, all user annotations rather than model predictions.

In the morning Stop, open the saved report, and export JSON and CSV. Evaluate coverage, gaps, silenced periods, level distribution, peaks, and annotated events. An interrupted session must not be reported as an entirely quiet night. Abrupt termination may lose the last unfinished one-second bucket; the saved end is the last persisted heartbeat, not the time the app is reopened.

## Local model integration

Implemented in version 0.3: MediaPipe Audio Classifier and compatible YAMNet float32 v1, bundled by the build, using 15,600-sample inputs and a one-second hop. Run CPU inference and benchmark on the OnePlus A5010 before the classified night. Model labels include baby crying, speech, snoring and cough. Sources: [MediaPipe Android](https://developers.google.com/edge/mediapipe/solutions/audio/audio_classifier/android), [YAMNet labels](https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv).

Add a bounded inference worker separate from capture. Track model version, inference latency, dropped windows and model failures. Preserve multiple relevant category scores. Do not equate scores with calibrated certainty or zero input with a quiet room. Numeric monitoring should continue if classification fails.

Add per-class start/end thresholds, repeated evidence, episode merging and duration estimation. Cry, speech, snoring and short coughs require different timing rules. Prioritize likely crying and sound reporting; expose other labels as experimental until validated. Do not claim sleep state or identify who made a sound from a room microphone.

## Evaluation and MVP

Use licensed public fixtures and controlled playback at the phone's installed position, including white noise, fans, music, adult speech, doors, distance and overlapping sounds. Compare live manual notes with detections across several nights. Measure false episodes per night, missed observed episodes, detection delay, duration error, capture coverage, inference gaps, memory and temperature.

Tonight's audio cannot be reclassified tomorrow because it is not retained. Feed/diaper notes and exported numeric data support baseline/context analysis but are not ground-truth cry labels and cannot establish cry detection accuracy. Classifier validation requires future live inference or separate authorized test fixtures. Custom training would need a separately agreed dataset.

The MVP provides persistent sessions, a morning summary and level timeline, likely cry episodes, explicit monitoring coverage and interruptions, session history, deletion/retention controls, and metadata export. Add user-configurable Home Assistant delivery through EventSink after local reporting and classification are useful. No endpoint is configured now.

## Tomorrow's work

When the first-night exports are available, check capture and inference coverage first; tune reporting, event thresholds and interruption handling based on evidence. Stored relevant category scores can be replayed through revised episode policies without audio. Compare feed/diaper timestamps as context, not cry ground truth. Report the actual device inference latency and drops, validate against separate labeled fixtures, and update this plan with measured results. This is a continuation when the user returns with the data, not a scheduled unattended task.
