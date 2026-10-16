plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Standalone Pixel Watch app: logs to the Babysteps Pi's POST /api/events and reads GET /api/events/status.
android {
    namespace = "com.babysteps.watch"
    compileSdk { version = release(37) { minorApiLevel = 0 } }
    defaultConfig {
        applicationId = "com.babysteps.watch"
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.wear.compose:compose-material3:1.7.1")
    implementation("androidx.wear.compose:compose-foundation:1.7.1")
    implementation("androidx.wear.compose:compose-navigation:1.7.1")
    implementation("androidx.wear:wear-ongoing:1.1.0")
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    testImplementation("junit:junit:4.13.2")
    // android.jar's org.json is stubbed off-device; the real one runs the parse tests.
    testImplementation("org.json:json:20250517")
}
