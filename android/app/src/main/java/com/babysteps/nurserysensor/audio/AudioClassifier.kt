package com.babysteps.nurserysensor.audio

import java.time.Instant

/** Borrowed PCM: valid only during classify(). Never keep, log, save, or upload samples.
 * Future classifiers can maintain a bounded RAM-only context and must erase it on close().
 */
class AudioWindow(val samples: ShortArray, val sampleRate: Int, val timestamp: Instant)

enum class AudioLabel(val eventName: String) {
    BABY_CRY("baby_cry"), SPEECH("speech"), SNORING("snoring"), COUGH("cough"),
    AMBIENT_NOISE("ambient_noise"), UNKNOWN("unknown")
}
data class ClassificationResult(val label: AudioLabel, val confidence: Double,
    val scores: Map<AudioLabel, Double> = mapOf(label to confidence),
    val topModelLabel: String? = null, val topModelScore: Double? = null,
) {
    init {
        require(confidence.isFinite() && confidence in 0.0..1.0)
        require(scores.values.all { it.isFinite() && it in 0.0..1.0 })
        require(topModelScore == null || (topModelScore.isFinite() && topModelScore in 0.0..1.0))
    }
}
interface AudioClassifier : AutoCloseable {
    /** Synchronous, on the capture worker. Keep inference bounded and fast. */
    fun classify(audio: AudioWindow): ClassificationResult?
    override fun close() {}
}
