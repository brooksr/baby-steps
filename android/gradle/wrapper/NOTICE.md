# Gradle wrapper provenance

`gradle-wrapper.jar` contains Gradle 9.6.0 wrapper, CLI, file-locking and required helper classes extracted from the Gradle 9.6.0 API JAR bundled with Android Studio. This avoids a missing wrapper binary when the project is created without network access. It is not the byte-for-byte upstream standalone wrapper JAR, so upstream wrapper-JAR checksum verification will differ. The wrapper successfully reached distribution download in the creation environment.

Gradle is copyright its contributors and licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0. See `LICENSE.txt` beside this file. Upstream source: https://github.com/gradle/gradle.

After a successful networked sync/build, regenerate official wrapper artifacts with:

```bash
./gradlew wrapper --gradle-version 9.6.0 --distribution-type bin
```

Then commit the regenerated scripts and JAR, and set `distributionSha256Sum` in `gradle-wrapper.properties` to the published Gradle 9.6.0 binary distribution checksum from https://gradle.org/release-checksums/.
