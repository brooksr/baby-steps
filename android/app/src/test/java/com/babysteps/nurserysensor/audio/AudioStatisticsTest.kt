package com.babysteps.nurserysensor.audio

import java.time.Instant
import kotlin.math.PI
import kotlin.math.sin
import org.junit.Assert.*
import org.junit.Test

class AudioStatisticsTest {
    private val now = Instant.parse("2026-10-12T12:00:00Z")

    @Test fun silenceHasFiniteFloor() {
        val value = AudioStatistics().observe(ShortArray(4000), now)
        assertEquals(-120.0, value.soundLevel, 0.0)
        assertEquals(-120.0, value.peakLevel, 0.0)
        assertEquals(-120.0, value.rollingAverage, 0.0)
        assertEquals(0.0, value.rmsAmplitude, 0.0)
        assertEquals(now, value.timestamp)
    }
    @Test fun halfScaleHasExpectedRmsAndDecibels() {
        val value = AudioStatistics().observe(shortArrayOf(16384, -16384), now)
        assertEquals(0.5, value.rmsAmplitude, 1e-9)
        assertEquals(-6.0206, value.soundLevel, 1e-4)
        assertEquals(value.soundLevel, value.peakLevel, 1e-9)
    }
    @Test fun negativeFullScaleDoesNotOverflow() {
        val value = AudioStatistics().observe(shortArrayOf(Short.MIN_VALUE), now)
        assertEquals(1.0, value.rmsAmplitude, 0.0)
        assertEquals(0.0, value.peakLevel, 0.0)
    }
    @Test fun sineRmsIsPeakDividedBySqrtTwo() {
        val samples = ShortArray(4000) { (16384 * sin(2 * PI * 1000 * it / 16000)).toInt().toShort() }
        val value = AudioStatistics().observe(samples, now)
        assertEquals(-9.0309, value.soundLevel, 0.002)
        assertEquals(-6.0206, value.peakLevel, 0.001)
    }
    @Test fun averageUsesEnergyAndEvictsOldestWindow() {
        val stats = AudioStatistics(2)
        stats.observe(shortArrayOf(Short.MIN_VALUE), now)
        val mixed = stats.observe(shortArrayOf(0), now)
        assertEquals(-3.0103, mixed.rollingAverage, 1e-4)
        val quiet = stats.observe(shortArrayOf(0), now)
        assertEquals(-120.0, quiet.rollingAverage, 0.0)
        assertEquals(0.0, quiet.sessionPeak, 0.0)
    }
    @Test fun sessionPeakSurvivesQuieterWindowsButNewSessionResets() {
        val stats = AudioStatistics()
        stats.observe(shortArrayOf(16384), now)
        assertEquals(-6.0206, stats.observe(shortArrayOf(1), now).sessionPeak, 1e-4)
        assertEquals(-120.0, AudioStatistics().observe(shortArrayOf(0), now).sessionPeak, 0.0)
    }
    @Test fun historyIsBoundedAndSnapshotDoesNotChange() {
        val history = ObservationHistory(2)
        val stats = AudioStatistics()
        history.add(stats.observe(shortArrayOf(1), now))
        val snapshot = history.snapshot()
        history.add(stats.observe(shortArrayOf(2), now.plusSeconds(1)))
        history.add(stats.observe(shortArrayOf(3), now.plusSeconds(2)))
        assertEquals(1, snapshot.size)
        assertEquals(2, history.snapshot().size)
        assertEquals(now.plusSeconds(1), history.snapshot().first().timestamp)
        history.clear()
        assertTrue(history.snapshot().isEmpty())
    }
    @Test fun privacySilencingIsExplicitMetadata() {
        assertTrue(AudioStatistics().observe(shortArrayOf(0), now, true).microphoneSilenced)
    }
    @Test fun numericObservationDoesNotRetainPcm() {
        val samples = shortArrayOf(16384)
        val value = AudioStatistics().observe(samples, now)
        samples.fill(0)
        assertEquals(0.5, value.rmsAmplitude, 0.0)
        assertFalse(SoundObservation::class.java.declaredFields.any { it.type == ShortArray::class.java })
    }
    @Test(expected = IllegalArgumentException::class) fun emptyWindowIsRejected() {
        AudioStatistics().observe(shortArrayOf(), now)
    }
    @Test(expected = IllegalArgumentException::class) fun zeroRollingCapacityIsRejected() { AudioStatistics(0) }
    @Test(expected = IllegalArgumentException::class) fun zeroHistoryCapacityIsRejected() { ObservationHistory(0) }
    @Test(expected = IllegalArgumentException::class) fun invalidClassificationConfidenceIsRejected() {
        ClassificationResult(AudioLabel.BABY_CRY, Double.NaN)
    }
}
