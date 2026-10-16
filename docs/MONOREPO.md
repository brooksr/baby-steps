# BabySteps monorepo and development path

## Integration plan and decisions

1. Import the tracked Android project at `oneplus` commit
   `c60348b95f1b1b3e3c22da04c3ca48f8d2f4b538` into `android/`.
   Bring the phone, Wear OS app, wrapper, tests, nursery receiver and operational
   notes together. Exclude local settings, caches, exports, credentials and APKs.
2. Keep the working web/Pi layout and all deployment commands in place. One
   nested Gradle build is enough; npm workspaces, submodules and a build
   orchestrator add no value for these two toolchains.
3. Read reference CSVs from their existing canonical directory during Android
   builds and JVM tests. Preserve installed app ids, versions and storage keys.
4. Add Android CI, root command shortcuts, and human/agent documentation.
5. Run web lint, tests, production build, server build, receiver tests and both
   Android modules’ unit tests, lint and APK builds. Device installation and
   connected tests are separate, explicit operations on test devices.

## Repository map

```text
src/components/           React PWA screens
src/domain/               TypeScript domain rules and tests
src/data/reference/       canonical reference CSVs for both clients
src/storage/              browser/local/Google Sheets stores
src/server/               Pi events, app and nursery APIs
server/                   stateless sign-in token broker
public/                   PWA assets and legal pages
android/                  open this directory in Android Studio
  app/                    phone tracker and Nursery monitoring
  wear/                   standalone Pixel Watch client
  integration/            optional legacy Apps Script nursery receiver
  docs/                   monitoring and device operations
  gradle/, gradlew         pinned Gradle build
.github/workflows/        web/Pi deployment and Android verification
```

This is a source import with its originating commit recorded, not a Git history
rewrite. Earlier Android history remains in the original `oneplus` repository
(`git -C ../oneplus log c60348b -- app/`, when available). This checkout builds
without that sibling repository. Develop new phone/watch changes here; keep
`oneplus` as historical reference rather than maintaining two active copies.

## Daily workflow

From the root: `npm ci`, then `npm run dev` for the PWA. For Android, install
the SDK/JDK described in [the Android guide](../android/README.md), open
`android/` in Android Studio, or use the root npm shortcuts:

```bash
npm run android:test
npm run android:lint
npm run android:build
npm run test:receiver
```

These invoke the checked-in Gradle wrapper from `android/`; they require no
JavaScript dependencies. Direct commands work too:

```bash
cd android
./gradlew :app:testDebugUnitTest :wear:testDebugUnitTest
./gradlew :app:lintDebug :wear:lintDebug
./gradlew :app:assembleDebug :wear:assembleDebug
```

All changes must pass `npm run lint`, `npm test`, and `npm run build`.
For API changes also run `npm run build:server`. Android changes must pass the
three Android checks above; receiver changes must pass `npm run test:receiver`.
CI verifies Android on pull requests and pushes to main, including changes to
canonical reference data. Web/Pi release paths remain unchanged. CI produces
unsigned-for-release debug APK artifacts, never installs on a household device,
and does not publish a signed mobile release.

## Cross-platform changes

Use one PR for an API/data change and every affected client. The field contract
starts in `src/domain/types.ts` and the Sheets mapping; the phone counterpart is
`android/app/src/main/java/com/babysteps/nurserysensor/care/model/Model.kt`.
The detailed [port map](BABYSTEPS_APP.md#code-map-appsrcmainjavacombabystepsnurserysensorcare)
identifies the Kotlin counterpart for domain rules. Update tests in both
languages with the same inputs, dates, units and expected results. If parity is
intentionally deferred, record the gap in the PR and the native guide.

For an event field/type, update the union, legacy readers, RAW Sheets mapping,
Pi validation/operation handling, Kotlin model/domain/form, watch payload if
relevant, and regression tests. Keep old cached JSON and queued operations
readable. Preserve client-generated ids and idempotent retries. Never merge
family caches or turn profile archiving into deletion.

`src/server/appApi.ts` and `CareRepository.kt` own the phone operation contract;
`src/server/eventsApi.ts` and `android/wear/src/main/java/com/babysteps/watch/WatchRepository.kt` cover watch
logging.
Keep existing API operations backward compatible: installed phones and watches
can remain offline across a server release. Deploy additive server support
before clients that depend on it; document a minimum server version if needed.

Reference CSVs are packaged directly from `src/data/reference/` by Gradle;
edit them once. Fonts, licenses, raster launcher assets and Kotlin Lucide paths
remain platform assets; see the native guide for their sources. Do not claim
that all artwork is generated. Do not copy production caches, tokens or family
exports into fixtures. Use neutral synthetic data.

## Development sequence

1. **Authentication before family parity.** Follow the newer
   [internal backend plan](INTERNAL_BACKEND.md): BabySteps passkeys/accounts and
   SQLite first, with optional linked Google sign-in. The Google-only approach
   below remains a legacy-path option, not the preferred internal design. Add Google sign-in on the phone,
   verify ID token signatures/audience/issuer/expiry on the Pi, then resolve
   membership for the requested family. Test parent/caregiver/refused access
   server-side, including archived members and cross-family requests. Never
   trust a client email or family id alone. Limit caregiver operations on the
   Pi and stamp attribution from verified identity. Keep separately scoped,
   rotatable credentials for unattended nursery devices and Keystore-backed
   storage. This is future work; today the app bearer token grants the full
   family view. The PWA caregiver view remains a view, not an access boundary.
2. **Finish parity.** Family setup/invites/sharing after authentication, full
   import merge, queued-change UI, then incremental sync and conflict handling.
   Do not re-enable night-shift backfill incidentally. Add domain cases and
   emulator UI tests as features arrive.
3. **Native polish.** Widgets, ongoing timers and reminder notifications;
   compare watch/phone queues before extracting shared Kotlin code. Establish
   protected release signing and versioned releases separately from debug CI.
4. **Reduce duplicated logic deliberately.** Use the Kotlin path below only
   after the phone’s parity and offline behavior are demonstrated.

## Can Kotlin also build the web app?

Yes. Kotlin/JS can share logic with a JavaScript frontend; Compose Multiplatform
can build a browser UI using Kotlin/Wasm. JetBrains documents both approaches
([web strategy](https://blog.jetbrains.com/kotlin/2025/05/present-and-future-kotlin-for-web/),
[Wasm build tutorial](https://kotlinlang.org/docs/wasm-get-started.html)).
This does not mean this Android Gradle module can be compiled for the web as-is.

The current code imports Android Context/assets, SharedPreferences, SQLite,
`org.json`, Java date/file APIs, Android lifecycle/services and MediaPipe.
Those need platform adapters or replacements. A feature-complete Android UI
still leaves browser persistence, Google OAuth/Sheets, PWA caching, URLs,
accessibility, file/share flows and deployment to implement and verify.

Recommended next steps:

1. Extract a small pure domain feature and its test vectors into a future
   `shared/care-core/` Kotlin Multiplatform module (JVM + JS first). Use portable
   models/serialization, date handling and injected clocks; leave microphone,
   notifications, storage and networking behind platform interfaces. Have both
   Android apps consume it where relevant. Do not create an empty module now.
2. Trial consuming a JS export from React for that feature. Validate matching
   results, bundle cost, debugging and the additional Gradle requirement in web
   CI. Continue moving rules only if maintenance gets simpler. The Node/Pi API
   can remain TypeScript; a shared UI does not eliminate its contract work.
3. Separately trial one Compose Multiplatform browser screen and offline edit
   flow. Compare accessibility/keyboard behavior, small-screen performance,
   download/startup cost, Safari/Firefox/Chrome support, fonts and PWA updates.
4. Choose between React plus shared Kotlin domain logic and a shared Compose
   UI based on that trial. Replace the production PWA only after parity tests,
   existing IndexedDB migration, family isolation, offline outbox, Google
   sign-in, browser navigation and deployment/rollback all pass. Preserve the
   existing PWA until this gate is met.

The likely early saving is one set of domain rules and reference tables.
A single UI is a later option, not a prerequisite for integrating the apps.

## Integration verification (2026-10-16)

- Web: ESLint, all 573 Vitest tests, production PWA build and Pi events bundle
  passed. Token-broker tests needed local socket access outside the agent sandbox.
- Android: all 57 phone and 8 watch JVM tests passed; both debug APKs assembled;
  both lint checks passed with zero errors (35 phone and 10 watch warnings from
  the imported code). Existing Kotlin warnings and the web bundle-size advisory
  remain follow-up work.
- All 19 reference CSVs inside the phone APK matched the canonical source bytes;
  the build did not package the TypeScript reference loader.
- Legacy receiver mocked tests passed; documentation’s local link targets checked.
- Device/connected tests and GitHub-hosted CI were not run during integration.
  No phone/watch install, Pi deployment, signing changes or Git history rewrite
  was performed. Existing `tsconfig.tsbuildinfo` worktree changes were left alone.
