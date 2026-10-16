package com.babysteps.nurserysensor.reporting

import org.junit.Assert.*
import org.junit.Test

class TimelinePlotTest {
    private fun bin(ms: Long,power: Double?,valid: Long=1000)=SoundBin(ms,ms,4,1000,valid,1000-valid,power,power?.let { -6.0 },0)
    @Test fun missingAndSilencedInputStayUnknown() {
        val p=TimelinePlot.build(listOf(bin(0,.01),bin(2000,null,0)),3000,3000)
        assertEquals(-20.0,p.points[0].levelDbfs!!,1e-8)
        assertNull(p.points[1].levelDbfs); assertNull(p.points[2].levelDbfs)
    }
    @Test fun longSessionsHaveBoundedPointsAndSelectedRange() {
        val p=TimelinePlot.build(emptyList(),7*86400000L,43200000)
        assertTrue(p.points.size<=360); assertEquals(7*86400000L-43200000,p.startMs)
    }
    @Test fun averagingUsesEnergyAndValidDuration() {
        val p=TimelinePlot.build(listOf(bin(0,.01,1000),bin(1000,.09,500)),4000,4000,2)
        assertEquals(10*kotlin.math.log10((.01*1000+.09*500)/1500),p.points[0].levelDbfs!!,1e-8)
    }
}
