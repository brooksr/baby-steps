package com.babysteps.nurserysensor.audio

import java.time.Instant
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sqrt

data class SoundObservation(
    val timestamp: Instant,
    val soundLevel: Double, // RMS dBFS, NOT calibrated acoustic dB SPL
    val peakLevel: Double, // Maximum absolute sample amplitude, in dBFS
    val rmsAmplitude: Double, // 0..1, relative to PCM full scale
    val rollingAverage: Double, // Energy average of last 120 equal-duration windows
    val sessionPeak: Double,
    val microphoneSilenced: Boolean = false,
)

/** Pure Kotlin. Equal-duration windows; rolling average is in power space, not mean(dB). */
class AudioStatistics(private val rollingWindows: Int = 120) {
    init { require(rollingWindows > 0) }
    private val powers = ArrayDeque<Double>()
    private var powerSum = 0.0
    private var peak = FLOOR_DBFS

    fun observe(samples: ShortArray, timestamp: Instant, microphoneSilenced: Boolean = false): SoundObservation {
        require(samples.isNotEmpty())
        var sumSquares = 0.0
        var maxAmplitude = 0.0
        for (sample in samples) {
            // Convert before abs: abs(Short.MIN_VALUE) must not overflow.
            val amplitude = sample.toDouble() / 32768.0
            sumSquares += amplitude * amplitude
            maxAmplitude = max(maxAmplitude, abs(amplitude))
        }
        val power = sumSquares / samples.size
        powers.addLast(power)
        powerSum += power
        if (powers.size > rollingWindows) powerSum -= powers.removeFirst()
        val windowPeak = amplitudeDbfs(maxAmplitude)
        peak = max(peak, windowPeak)
        return SoundObservation(timestamp, powerDbfs(power), windowPeak, sqrt(power),
            powerDbfs(max(0.0, powerSum) / powers.size), peak, microphoneSilenced)
    }

    companion object {
        const val FLOOR_DBFS = -120.0
        fun powerDbfs(power: Double): Double = if (power <= 0) FLOOR_DBFS
            else max(FLOOR_DBFS, 10 * log10(power))
        fun amplitudeDbfs(amplitude: Double): Double = powerDbfs(amplitude * amplitude)
    }
}

/** Bounded numeric-only storage, used by the process-local dashboard repository. */
class ObservationHistory(private val capacity: Int = 240) {
    init { require(capacity > 0) }
    private val observations = ArrayDeque<SoundObservation>()
    fun add(observation: SoundObservation) {
        if (observations.size == capacity) observations.removeFirst()
        observations.addLast(observation)
    }
    fun snapshot(): List<SoundObservation> = observations.toList()
    fun clear() = observations.clear()
}
