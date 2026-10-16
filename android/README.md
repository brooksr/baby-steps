# BabySteps Android and Pixel Watch

Open this directory (`android/`, containing `settings.gradle.kts`) in Android
Studio. It is one Gradle build with two independently installed apps:

- `:app` — native BabySteps Home, Log, Reports, Care, Shopping, To-do,
  Settings and Learn, plus the Nursery sound monitor.
  Application id: `com.babysteps.nurserysensor`, version 0.5.0.
- `:wear` — standalone Pixel Watch care logging, status and nursing timer.
  Application id: `com.babysteps.watch`, version 0.1.0; no phone companion required.

Imported from `oneplus` commit `c60348b`. New development belongs here.
See [the monorepo plan](../docs/MONOREPO.md) and
[the phone architecture and port map](../docs/BABYSTEPS_APP.md).

## Tooling

Pinned versions: Gradle 9.6.0, Android Gradle Plugin 9.4.0, Kotlin/Compose
compiler 2.3.20, Compose BOM 2026.09.00. Use Android Studio with AGP 9.4
support, its bundled JDK (or JDK 21), Android SDK platform **37.0**, Build Tools
**36.0.0**, and Platform Tools. Phone minimum API is 26; watch minimum is 30.
Use SDK Manager to accept licenses and install those packages.

On macOS, from the monorepo root:

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
cd android
./gradlew :app:testDebugUnitTest :wear:testDebugUnitTest
./gradlew :app:lintDebug :wear:lintDebug
./gradlew :app:assembleDebug :wear:assembleDebug
```

On Windows use `gradlew.bat` and your installed SDK/JDK paths. Android Studio
may create an ignored `local.properties` for the SDK. First build needs network
access for dependencies and the bundled YAMNet model. Later offline builds can
use `--offline` with warmed dependencies/model. Reference CSVs are generated
from `../src/data/reference`; no sibling project or manual copy is needed.
Font files/licenses, launcher raster assets and Kotlin Lucide vectors remain
checked-in platform assets. The original wrapper’s provenance is recorded in
[gradle/wrapper/NOTICE.md](gradle/wrapper/NOTICE.md).

## Phone setup and installation

Try tracker/UI changes on an emulator with synthetic cached data first (see
[the native guide](../docs/BABYSTEPS_APP.md#build-and-test)). Choose a device
explicitly when more than one is connected:

```bash
adb devices
adb -s YOUR_PHONE_SERIAL install -r app/build/outputs/apk/debug/app-debug.apk
adb -s YOUR_PHONE_SERIAL shell am start -n com.babysteps.nurserysensor/.MainActivity
```

Use the same signing key for updates to retain local state. Installing restarts
the app. Android 10 recovery resumes previously enabled nursery monitoring;
verify the service after an update. Newer Android versions may require a visible
resume tap. Do not uninstall to resolve a signing mismatch without first
exporting records; uninstalling erases the local database and outbox.

Settings → Babysteps Pi takes your HTTPS Pi URL and `APP_API_TOKEN`. This token
allows full-family read/write access; native Google sign-in and caregiver limits
are future work. Keep it separate from `EVENTS_API_TOKEN` used by voice/watch
logging, and from nursery delivery credentials. Enter secrets on the device,
never in source or fixtures. Nursery monitoring requires microphone permission
and an explicit Start; optional delivery sends numeric/classification metadata,
never audio. It is not a safety alarm or calibrated sound meter.

## Pixel Watch

Enable Developer options → Wireless debugging on the watch and pair/connect
using its displayed addresses:

```bash
adb pair WATCH_IP:PAIR_PORT
adb connect WATCH_IP:DEBUG_PORT
adb -s WATCH_IP:DEBUG_PORT install -r wear/build/outputs/apk/debug/wear-debug.apk
```

In watch Settings enter the Pi URL and `EVENTS_API_TOKEN`; select the child if
the family has more than one. The watch uses its own Wi-Fi/LTE/Bluetooth-proxy
connection: `GET /api/events/status` for status and `POST /api/events` to log.
Entries are queued locally at their original timestamp and retried. A nursing
timer excludes pauses and shows an ongoing activity. Unit tests cover request
bodies, status and timer logic; exercise screen/ongoing activity behavior on a
test watch before shipping watch UI changes.

## Device checks and monitoring operations

Connected tests require a dedicated unlocked test device with a microphone.
They can reinstall/erase app data; export real nights first. They start and stop
monitoring and are not part of CI:

```bash
./gradlew :app:connectedDebugAndroidTest
```

- [Continuous monitoring, recovery and delivery](docs/CONTINUOUS_MONITORING.md)
- [Local YAMNet classification and privacy](docs/CLASSIFICATION.md)
- [Overnight trial plan](docs/OVERNIGHT_PLAN.md)
- [Historical prototype verification and manual device checklists](docs/PROTOTYPE_HISTORY.md)

The optional legacy Apps Script receiver stays in `integration/google-apps-script/`;
run its mocked tests from the root with `npm run test:receiver`. Current phone
tracker traffic goes through the Pi; CI never deploys this receiver or installs
APKs. Pi code deployment and container environment changes are covered in
[the native app guide](../docs/BABYSTEPS_APP.md#deploying-the-pi-side).
