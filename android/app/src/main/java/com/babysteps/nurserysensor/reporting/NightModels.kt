package com.babysteps.nurserysensor.reporting

import com.babysteps.nurserysensor.audio.AudioStatistics
import com.babysteps.nurserysensor.audio.SoundObservation
import com.babysteps.nurserysensor.classification.Prediction
import com.babysteps.nurserysensor.classification.SoundEpisode

/** Persisted numeric metadata only. Offsets/durations are monotonic, timestamps are UTC. */
data class SoundBin(
    val offsetMs: Long,
    val timestampMs: Long,
    val windowCount: Int,
    val capturedMs: Long,
    val validMs: Long,
    val silencedMs: Long,
    val meanSquare: Double?,
    val peakDbfs: Double?,
    val clippedWindows: Int,
)

/** Combines measurements in power space. Silenced input is excluded from sound statistics. */
class NightAccumulator(private val startedAtMs: Long) {
    private var bucket = -1L
    private var windows = 0
    private var valid = 0
    private var silenced = 0
    private var clipped = 0
    private var powerSum = 0.0
    private var peak = AudioStatistics.FLOOR_DBFS

    fun add(observation: SoundObservation, elapsedMs: Long): SoundBin? {
        require(elapsedMs >= 0)
        val nextBucket = (elapsedMs - 1).coerceAtLeast(0) / 1000
        require(bucket < 0 || nextBucket >= bucket) { "Monotonic time must not run backwards" }
        val completed = if (bucket >= 0 && nextBucket != bucket) flush() else null
        bucket = nextBucket
        windows++
        if (observation.microphoneSilenced) silenced++ else {
            valid++
            powerSum += observation.rmsAmplitude * observation.rmsAmplitude
            peak = maxOf(peak, observation.peakLevel)
            if (observation.peakLevel >= -0.1) clipped++
        }
        return completed
    }

    fun flush(): SoundBin? {
        if (windows == 0) return null
        val bin = SoundBin(bucket * 1000, startedAtMs + bucket * 1000, windows,
            windows * 250L, valid * 250L, silenced * 250L,
            if (valid == 0) null else powerSum / valid,
            if (valid == 0) null else peak, clipped)
        windows = 0; valid = 0; silenced = 0; clipped = 0; powerSum = 0.0; peak = AudioStatistics.FLOOR_DBFS
        return bin
    }
}

data class NightSession(
    val id: Long, val startedAtMs: Long, val endedAtMs: Long?, val status: String,
    val elapsedMs: Long, val capturedMs: Long, val validMs: Long, val silencedMs: Long,
    val binCount: Long, val meanSquare: Double?, val peakDbfs: Double?, val clippedWindows: Long,
    val markerCount: Long, val error: String?, val zoneId: String, val device: String,
    val appVersion: String = "0.2.0",
    val modelStatus: String = "disabled", val modelName: String? = null, val modelSha256: String? = null,
    val modelError: String? = null, val inferenceCount: Long = 0, val inferenceTotalMs: Long = 0,
    val inferenceMaxMs: Long = 0, val droppedWindows: Long = 0, val classificationRequested: Boolean = false,
    val detectorVersion: String? = null,
) {
    val coveragePercent: Double get() = if (elapsedMs <= 0) 0.0 else (100.0 * validMs / elapsedMs).coerceIn(0.0, 100.0)
    val unobservedMs: Long get() = (elapsedMs - capturedMs).coerceAtLeast(0)
}
data class NightMarker(val timestampMs: Long, val offsetMs: Long, val label: String, val note: String)
data class NightReport(val session: NightSession, val bins: List<SoundBin>, val markers: List<NightMarker>,
    val predictions: List<Prediction> = emptyList(), val episodes: List<SoundEpisode> = emptyList())
