# Local sound classification and reporting

Version 0.3 adds experimental on-device YAMNet classification, a Monitor / Reports / Settings dashboard, live level history, and saved sound episodes. Numeric monitoring remains independent of inference. Existing version 0.2 sessions and care notes are preserved by a transactional SQLite schema 1 to 2 upgrade.

## Build and install before tonight

The first networked Gradle build downloads the versioned Google [YAMNet float32 v1 model](https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite) into generated assets and bundles it in the APK. It uses `com.google.mediapipe:tasks-audio:1.0.0`, the version in Google's [Android audio-classifier sample](https://github.com/google-ai-edge/mediapipe-samples/blob/main/examples/audio_classifier/android/app/build.gradle). The download validates the TFLite header and records the actual SHA-256 in the APK and each classified session. This is model identification, not a pre-pinned upstream checksum. Classification remains offline with no runtime model downloads; version 0.4 networking is optional metadata delivery only.

```bash
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
ANDROID_SERIAL=1c23683a ./gradlew :app:connectedDebugAndroidTest
adb -s 1c23683a install -r app/build/outputs/apk/debug/app-debug.apk
adb -s 1c23683a shell am start -n com.babysteps.nurserysensor/.MainActivity
```

Run connected tests BEFORE collecting the real night, because the runner may erase app data. Export any real reports first. Do not uninstall or clear storage to upgrade; `install -r` preserves the database. After tests, install the normal APK again.

## Short rehearsal

1. Verify version 0.3.0. In Settings, leave Local classification on for the next session. Enable microphone/notification permissions and correct the phone's automatic date/time.
2. In Monitor tap Start Monitoring. Check sound readings and Classifier: Running locally. A label such as Uncertain / other sound is a valid result, not a failure.
3. Speak near the phone and observe speech scores. For an initial cry/cough/snore check, use separately licensed test sounds at a normal listening level. Do not assume this establishes real nursery accuracy.
4. Leave monitoring on with the screen off for a minute, then Stop. Reports should show classification status completed, predictions, model hash, inference timing, and any confirmed episodes.
5. Export JSON and reopen it from Downloads. It must have schemaVersion 2, classification.enabled true, classification.status completed, a 64-character SHA-256, and nonempty predictions. Export numeric CSV and events CSV if useful.
6. If classification fails or drops many windows, preserve the error/timing metadata for analysis. Numeric reporting continues. Settings can disable classification for a dependable level-only baseline. Start a fresh overnight session after the rehearsal.

## Processing and event rules

The foreground service owns one AudioRecord microphone. Capture remains 16 kHz mono, signed PCM16, with 250 ms measurements. A capture-thread ring assembles 15,600-sample / 975 ms model inputs with a 16,000-sample / one-second hop. A separate CPU worker owns the MediaPipe task. There is at most one running inference and one pending window; replacing a pending window increments droppedWindows and zeroes that buffer. Silence caused by Android privacy controls resets the ring and is not classified. Capture gaps reset model context. Native inference buffers are cleared after each call and the task closes on Stop.

Relevant category scores are persisted for baby_cry, speech, snoring, cough and ambient_noise, plus the highest original model category. Unknown means no relevant category reached the display threshold of 0.30; it is not a trained or calibrated certainty score. Only the specific Baby cry, infant cry category maps to baby_cry; adult crying or arbitrary loud sounds are not relabeled as baby crying. The model cannot identify who made a sound. No speech transcription is produced.

Episode policies are initial tuning values, versioned as experimental-v1:

| Category | Start score | Continue score | Confirming frames | Quiet frames to end |
| --- | --- | --- | --- | --- |
| baby_cry | 0.35 | 0.20 | 2 | 2 |
| speech | 0.45 | 0.25 | 2 | 2 |
| snoring | 0.40 | 0.25 | 3 | 2 |
| cough | 0.45 | 0.25 | 1 | 1 |
| ambient_noise | 0.50 | 0.30 | 2 | 2 |

An episode starts at the first confirming window's estimated start and ends at the last supported window's end. A short quiet gap can remain inside the episode; its duration is an estimated interval, not summed cry seconds. Inference gaps over 2.5 seconds close episodes instead of spanning unknown coverage. Categories may overlap and their totals must not be added as if mutually exclusive. Stop flushes active confirmed episodes. Unconfirmed spikes do not become episodes.

Inference failure is recorded separately from microphone/service errors and does not stop numeric capture. Stop drains pending inference; after a five-second timeout it records a classifier error and cancels further results while releasing microphone/wake-lock resources. A blocked native inference may finish later; session-ID guards prevent it updating a new session's live dashboard.

## Reports and exports

Monitor shows current/rolling/peak dBFS, a one-minute trace, classifier status and latest relevant scores. Reports show saved-session coverage, minute energy averages, loudest seconds, per-category episode counts/durations, care notes, inference timing, drops and errors. Settings lets you switch classification off before a session and opens Android permission/date settings. Feed/diaper notes remain contextual data, not ground-truth cry annotations.

JSON schema 2 retains the prior session, capture, summary, observations and markers fields and adds predictions and episodes. classification includes enabled/status/model/hash, detector policies and timing/drop metrics. Old sessions export with classification disabled. Metadata is streamed to the chosen document rather than building a huge JSON tree in memory.

Numeric CSV retains schema 1 and its 13-column timeline shape. The separate events CSV uses schema 2 with source, label, UTC times, offsets, duration, max model score and note; model_experimental and manual records remain distinct. All files use UTF-8; CSV uses CRLF, decimal points and quoted text where required. No export contains PCM.

Tomorrow's review should first confirm overnight capture/inference coverage and align feed/diaper notes with the timeline. Model scores can then guide threshold tuning, but care timestamps cannot establish missed/false crying rates. Accuracy evaluation needs separate labeled fixtures or later direct observations. No sleep-state or movement classifier is included.

## Verification limits for this implementation

Thirty-one pure JVM tests cover signal math, aggregation/export CSV, cleanup cancellation, episode hysteresis/gaps/overlap and PCM-window construction/reset. The user-run Gradle build/unit tests/lint succeeded, and all app sources compile locally against the actual MediaPipe dependency. The October 12 OnePlus run passed model inference without microphone/network, legacy-schema migration, and numeric persistence after a simulated model-load failure. The live monitoring test passed capture/Stop/persist/export checks but failed its final privacy assertion on MediaPipe's model cache. The corrected assertion permits only `cache/drishti_asset_cache/yamnet.tflite` and checks its SHA-256 against the bundled asset; it does not exempt arbitrary cache files or audio. Rerun the device tests to verify that correction. Gradle still cannot open its local lock socket in this agent's sandbox.
