package com.babysteps.nurserysensor.reporting

import com.babysteps.nurserysensor.audio.AudioStatistics
import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class NightAccumulatorTest {
    private fun sample(amplitude: Short, silenced: Boolean = false) = AudioStatistics().observe(shortArrayOf(amplitude), Instant.EPOCH, silenced)
    @Test fun oneSecondCombinesFourWindowsAndStopFlushesTail() {
        val a = NightAccumulator(10000)
        for (ms in listOf(250L,500L,750L,1000L)) assertNull(a.add(sample(16384),ms))
        val b = a.add(sample(8192),1250)!!
        assertEquals(4,b.windowCount); assertEquals(1000,b.validMs); assertEquals(10000,b.timestampMs)
        assertEquals(0.25,b.meanSquare!!,1e-12)
        assertEquals(250,a.flush()!!.capturedMs); assertNull(a.flush())
    }
    @Test fun silencedWindowsDoNotMakeNightLookQuiet() {
        val a = NightAccumulator(0)
        a.add(sample(16384),250); a.add(sample(0,true),500)
        val b = a.flush()!!
        assertEquals(250,b.validMs); assertEquals(250,b.silencedMs)
        assertEquals(0.25,b.meanSquare!!,0.0)
        val onlySilenced = NightAccumulator(0)
        onlySilenced.add(sample(0,true),250)
        assertNull(onlySilenced.flush()!!.meanSquare)
    }
    @Test fun gapsAreNotFilledWithFakeSilentBuckets() {
        val a = NightAccumulator(0)
        a.add(sample(1),250)
        assertEquals(0,a.add(sample(1),5250)!!.offsetMs)
        assertEquals(5000,a.flush()!!.offsetMs)
    }
    @Test fun averageUsesPowerAndClippingCounts() {
        val a = NightAccumulator(0)
        a.add(sample(Short.MIN_VALUE),250); a.add(sample(0),500)
        val b = a.flush()!!
        assertEquals(0.5,b.meanSquare!!,0.0); assertEquals(1,b.clippedWindows)
    }
    @Test(expected = IllegalArgumentException::class) fun backwardsMonotonicClockIsRejected() {
        val a = NightAccumulator(0); a.add(sample(1),2000); a.add(sample(1),250)
    }
    @Test fun reportCoverageSeparatesSilencingFromUnobservedTime() {
        val s = NightSession(1,0,10000,"completed",10000,8000,6000,2000,8,0.25,-6.0,0,0,null,"UTC","test")
        assertEquals(60.0,s.coveragePercent,0.0); assertEquals(2000,s.unobservedMs)
    }
    @Test fun csvIsVersionedAndLocaleIndependent() {
        val s = NightSession(1,0,1000,"completed",1000,1000,1000,0,1,0.25,-6.0,0,0,null,"UTC","test")
        val report = NightReport(s,listOf(SoundBin(0,0,4,1000,1000,0,0.25,-6.0,0)),emptyList())
        val prior = java.util.Locale.getDefault()
        try {
            java.util.Locale.setDefault(java.util.Locale.GERMANY)
            val csv = NightExport.csv(report)
            assertTrue(csv.contains("1970-01-01T00:00:00Z")); assertTrue(csv.contains(",0.25,"))
            assertEquals(13,csv.lines()[1].split(',').size)
            assertTrue(csv.endsWith("\r\n"))
        } finally { java.util.Locale.setDefault(prior) }
    }
}
