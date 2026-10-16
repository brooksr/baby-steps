package com.babysteps.nurserysensor.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class CareStatusTextTest {
    private val now=Instant.parse("2026-10-14T13:45:00Z")
    private val zone=ZoneId.of("America/Los_Angeles")

    @Test fun formatsElapsedTime() {
        assertEquals("just now",CareStatusText.since(now.minusSeconds(30),now))
        assertEquals("35m ago",CareStatusText.since(now.minusSeconds(35*60),now))
        assertEquals("1h 20m ago",CareStatusText.since(now.minusSeconds(80*60),now))
        assertEquals("1d 3h ago",CareStatusText.since(now.minusSeconds(27*3600),now))
        assertEquals("just now",CareStatusText.since(now.plusSeconds(120),now)) // phone clock behind the sheet
    }

    @Test fun collapsedAndExpandedLines() {
        val status=CareStatus(now.minusSeconds(80*60),"bottle 4 oz",now.minusSeconds(35*60),"wet",null,now.minusSeconds(60))
        val lines=CareStatusText.lines(status,now,zone)
        assertEquals("Fed 1h 20m ago · Diaper 35m ago",lines.title)
        assertEquals("Cry — · sound monitoring on",lines.text)
        assertEquals("Last feed 5:25 AM (1h 20m ago) · bottle 4 oz\nLast diaper 6:10 AM (35m ago) · wet\nLast cry heard: none logged\nUpdated 6:44 AM",lines.expanded)
    }

    @Test fun marksAnOldReadStale() {
        val status=CareStatus(null,null,null,null,now.minusSeconds(3600),now.minusSeconds(30*60))
        val lines=CareStatusText.lines(status,now,zone)
        assertEquals("Cry 1h 0m ago · stale since 6:15 AM",lines.text)
        assertTrue(lines.expanded.endsWith("Not updated since 6:15 AM"))
    }
}
