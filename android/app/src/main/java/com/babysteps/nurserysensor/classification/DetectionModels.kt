package com.babysteps.nurserysensor.classification

import com.babysteps.nurserysensor.audio.AudioLabel
import com.babysteps.nurserysensor.audio.ClassificationResult

data class Prediction(val endOffsetMs: Long, val timestampMs: Long, val result: ClassificationResult, val inferenceMs: Long)
data class SoundEpisode(val label: AudioLabel, val startOffsetMs: Long, val endOffsetMs: Long, val maxScore: Double) {
    val durationMs: Long get() = (endOffsetMs - startOffsetMs).coerceAtLeast(0)
}
data class DetectionPolicy(val label: AudioLabel, val startThreshold: Double, val endThreshold: Double,
    val confirmationFrames: Int, val releaseFrames: Int = 2)
object DetectionDefaults {
    const val VERSION = "experimental-v1"
    const val INPUT_SAMPLES = 15_600
    const val HOP_SAMPLES = 16_000
    const val WINDOW_MS = 975L
    val policies = listOf(
        DetectionPolicy(AudioLabel.BABY_CRY, .35, .20, 2),
        DetectionPolicy(AudioLabel.SPEECH, .45, .25, 2),
        DetectionPolicy(AudioLabel.SNORING, .40, .25, 3),
        DetectionPolicy(AudioLabel.COUGH, .45, .25, 1, 1),
        DetectionPolicy(AudioLabel.AMBIENT_NOISE, .50, .30, 2),
    )
}

/** Per-category hysteresis. Gaps > 2.5 s close episodes rather than inventing coverage.
 * Overlapping labels are allowed; no sleep-state or speaker identity inference.
 */
class EpisodeDetector(private val policies: List<DetectionPolicy> = DetectionDefaults.policies) {
    private data class State(var streak: Int = 0, var quiet: Int = 0, var start: Long = 0,
        var supportedEnd: Long = 0, var max: Double = 0.0, var active: Boolean = false)
    private val states = policies.associate { it.label to State() }
    private var lastOffset = -1L
    fun accept(prediction: Prediction): List<SoundEpisode> {
        require(prediction.endOffsetMs > lastOffset)
        val finished = mutableListOf<SoundEpisode>()
        if (lastOffset >= 0 && prediction.endOffsetMs - lastOffset > 2500) finished += flush()
        lastOffset = prediction.endOffsetMs
        policies.forEach { p ->
            val s = states.getValue(p.label)
            val score = prediction.result.scores[p.label] ?: 0.0
            if (!s.active) {
                if (score >= p.startThreshold) {
                    if (s.streak == 0) { s.start = (prediction.endOffsetMs - DetectionDefaults.WINDOW_MS).coerceAtLeast(0); s.max = 0.0 }
                    s.streak++; s.max = maxOf(s.max, score); s.supportedEnd = prediction.endOffsetMs
                    if (s.streak >= p.confirmationFrames) { s.active = true; s.quiet = 0 }
                } else s.streak = 0
            } else if (score >= p.endThreshold) {
                s.quiet = 0; s.supportedEnd = prediction.endOffsetMs; s.max = maxOf(s.max, score)
            } else if (++s.quiet >= p.releaseFrames) {
                finished += SoundEpisode(p.label, s.start, s.supportedEnd, s.max)
                states[p.label]?.apply { active = false; streak = 0; quiet = 0; max = 0.0 }
            }
        }
        return finished
    }
    fun flush(): List<SoundEpisode> = policies.mapNotNull { p ->
        val s = states.getValue(p.label)
        val episode = if (s.active) SoundEpisode(p.label,s.start,s.supportedEnd,s.max) else null
        s.active = false; s.streak = 0; s.quiet = 0; s.max = 0.0
        episode
    }
}

/** Capture-thread ring. Emits independent windows; erased on silence/reset/Stop. */
class PcmWindowAssembler(private val size: Int = DetectionDefaults.INPUT_SAMPLES,
    private val hop: Int = DetectionDefaults.HOP_SAMPLES) {
    init { require(size > 0 && hop > 0) }
    private val ring = ShortArray(size)
    private var position = 0
    private var seen = 0L
    private var nextEmission = size.toLong()
    fun append(samples: ShortArray, emit: (ShortArray, Int) -> Unit) {
        samples.forEachIndexed { index, value ->
            ring[position] = value; position = (position + 1) % size; seen++
            if (seen == nextEmission) {
                val window = ShortArray(size) { ring[(position + it) % size] }
                emit(window, samples.size - index - 1)
                nextEmission += hop
            }
        }
    }
    fun reset() { ring.fill(0); position = 0; seen = 0; nextEmission = size.toLong() }
}
