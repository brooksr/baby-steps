import java.net.URI
import java.security.MessageDigest
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import org.gradle.api.tasks.Sync
import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.TaskAction

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.babysteps.nurserysensor"
    compileSdk { version = release(37) { minorApiLevel = 0 } }
    defaultConfig {
        applicationId = "com.babysteps.nurserysensor"
        minSdk = 26
        targetSdk = 37
        versionCode = 7
        versionName = "0.6.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    // Package canonical monorepo data offline, under assets/reference/*.csv.
    testOptions.unitTests.all {
        it.systemProperty("babysteps.referenceDir", rootProject.file("../src/data/reference").absolutePath)
    }
    buildFeatures { compose = true; buildConfig = true }
    androidResources { noCompress += "tflite" }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    implementation(project(":internal-client"))
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.google.mediapipe:tasks-audio:1.0.0")
    testImplementation("junit:junit:4.13.2")
    // android.jar's org.json is a stub on the JVM; tests need the real thing.
    testImplementation("org.json:json:20250517")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}

// Bundled asset, downloaded only at BUILD time. Runtime networking is metadata delivery only.
// Versioned Google model URL; record its SHA-256 in every monitoring session/export.
abstract class DownloadYamnet : DefaultTask() {
    @get:Input abstract val modelUrl: Property<String>
    @get:Input abstract val offline: Property<Boolean>
    @get:OutputDirectory abstract val outputDirectory: DirectoryProperty

    @TaskAction
    fun download() {
        val dir = outputDirectory.get().asFile.apply { mkdirs() }
        val model = dir.resolve("yamnet.tflite")
        if (!model.exists()) {
            check(!offline.get()) { "YAMNet is not cached. Run a networked build once to bundle the local model." }
            val temp = dir.resolve("yamnet.download")
            try {
                val connection = URI(modelUrl.get()).toURL().openConnection().apply {
                    connectTimeout = 30_000; readTimeout = 120_000
                }
                connection.getInputStream().use { input -> temp.outputStream().use { input.copyTo(it) } }
                val bytes = temp.readBytes()
                check(bytes.size > 1_000_000 && bytes.copyOfRange(4, 8).toString(Charsets.US_ASCII) == "TFL3") { "Downloaded file is not a YAMNet TFLite model" }
                Files.move(temp.toPath(), model.toPath(), StandardCopyOption.REPLACE_EXISTING)
            } finally { temp.delete() }
        }
        val bytes = model.readBytes()
        check(bytes.size > 1_000_000 && bytes.copyOfRange(4,8).toString(Charsets.US_ASCII)=="TFL3") { "Cached model is invalid; remove app/build/generated/yamnetAssets and rebuild." }
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        dir.resolve("yamnet.sha256").writeText(digest + "\n")
        logger.lifecycle("Bundled YAMNet v1 SHA-256: $digest")
    }
}
val downloadYamnet = tasks.register<DownloadYamnet>("downloadYamnet") {
    modelUrl.set("https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite")
    offline.set(gradle.startParameter.isOffline)
    outputDirectory.set(layout.buildDirectory.dir("generated/yamnetAssets"))
}
// Only CSV files are packaged, retaining the reference/ path used by AssetManager.
abstract class SyncReferenceAssets : Sync() {
    @get:OutputDirectory abstract val outputDirectory: DirectoryProperty
    init { into(outputDirectory) }
}
val syncReferenceAssets = tasks.register<SyncReferenceAssets>("syncReferenceAssets") {
    from(rootProject.file("../src/data/reference")) {
        include("*.csv")
        into("reference")
    }
    outputDirectory.set(layout.buildDirectory.dir("generated/referenceAssets"))
}
// The Variant API identifies these as generated assets and wires the task dependency.
// A Provider passed to android.sourceSets is rejected by modern AGP.
androidComponents.onVariants { variant ->
    variant.sources.assets?.addGeneratedSourceDirectory(downloadYamnet, DownloadYamnet::outputDirectory)
    variant.sources.assets?.addGeneratedSourceDirectory(syncReferenceAssets, SyncReferenceAssets::outputDirectory)
}
