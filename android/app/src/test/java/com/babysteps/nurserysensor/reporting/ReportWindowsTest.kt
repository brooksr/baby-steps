package com.babysteps.nurserysensor.reporting

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

class ReportWindowsTest {
    private val pacific = ZoneId.of("America/Los_Angeles")
    private fun ms(text: String) = Instant.parse(text).toEpochMilli()

    @Test fun intervalsAlignToLocalQuarterHours() {
        assertEquals(ms("2026-10-13T05:00:00Z"), ReportWindows.intervalStart(ms("2026-10-13T05:14:59.999Z")))
        assertEquals(ms("2026-10-13T05:15:00Z"), ReportWindows.intervalStart(ms("2026-10-13T05:15:00Z")))
        assertEquals(-ReportWindows.INTERVAL_MS, ReportWindows.intervalStart(-1))
    }
    @Test fun nightRunsNoonToNoonLocal() {
        // 23:00 and 03:00 Pacific belong to the same night; 13:00 starts the next one.
        assertEquals(LocalDate.of(2026, 10, 12), ReportWindows.nightOf(ms("2026-10-13T06:00:00Z"), pacific))
        assertEquals(LocalDate.of(2026, 10, 12), ReportWindows.nightOf(ms("2026-10-13T10:00:00Z"), pacific))
        assertEquals(LocalDate.of(2026, 10, 12), ReportWindows.nightOf(ms("2026-10-13T18:59:59Z"), pacific))
        assertEquals(LocalDate.of(2026, 10, 13), ReportWindows.nightOf(ms("2026-10-13T19:00:00Z"), pacific))
        val bounds = ReportWindows.nightBounds(LocalDate.of(2026, 10, 12), pacific)
        assertEquals(ms("2026-10-12T19:00:00Z"), bounds.first)
        assertEquals(ms("2026-10-13T19:00:00Z"), bounds.last + 1)
    }
    @Test fun dstNightsAreNotForcedToTwentyFourHours() {
        val fallBack = ReportWindows.nightBounds(LocalDate.of(2026, 10, 31), pacific)
        assertEquals(25 * 3_600_000L, fallBack.last + 1 - fallBack.first)
        val springForward = ReportWindows.nightBounds(LocalDate.of(2026, 3, 7), pacific)
        assertEquals(23 * 3_600_000L, springForward.last + 1 - springForward.first)
    }
}
