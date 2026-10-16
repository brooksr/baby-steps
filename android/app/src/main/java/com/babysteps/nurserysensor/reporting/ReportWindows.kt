package com.babysteps.nurserysensor.reporting

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Wall-clock windows for the shared sheet. Per-second bins stay local; the sheet gets
 * 15-minute levels (96 rows/day) and one upserted row per night, so a year of
 * continuous monitoring stays far below the family spreadsheet's cell limit.
 */
object ReportWindows {
    const val INTERVAL_MS = 15 * 60_000L
    /** Aligned to :00/:15/:30/:45 in every zone whose UTC offset is a multiple of 15 minutes. */
    fun intervalStart(wallMs: Long): Long = Math.floorDiv(wallMs, INTERVAL_MS) * INTERVAL_MS
    /** The night of D runs from local noon on D to local noon on D+1 (evening, overnight, morning). */
    fun nightOf(wallMs: Long, zone: ZoneId): LocalDate {
        val local = Instant.ofEpochMilli(wallMs).atZone(zone)
        return if (local.hour < 12) local.toLocalDate().minusDays(1) else local.toLocalDate()
    }
    /** [start, end) in epoch ms; 23 or 25 hours across a DST change. */
    fun nightBounds(night: LocalDate, zone: ZoneId): LongRange {
        val start = night.atTime(12, 0).atZone(zone).toInstant().toEpochMilli()
        val end = night.plusDays(1).atTime(12, 0).atZone(zone).toInstant().toEpochMilli()
        return start until end
    }
}
