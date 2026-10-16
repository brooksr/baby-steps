package com.babysteps.watch

import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

/** GET /api/events/status, as the watch shows it. Each time is null when nothing is on file. */
data class CareStatus(
    val child: String?,
    val feedAt: Instant?, val feedMethod: String?, val feedSide: String?, val feedOz: Double?, val feedMinutes: Int?,
    val diaperAt: Instant?, val diaperKind: String?,
    val sleepAt: Instant?, val sleepEndedAt: Instant?,
    val fetchedAt: Instant,
) {
    val asleep get()=sleepAt!=null && sleepEndedAt==null

    companion object {
        fun parse(reply: JSONObject,now: Instant): CareStatus {
            check(reply.optBoolean("ok",false)) { reply.optJSONArray("errors")?.optString(0) ?: "The Pi refused the status read" }
            fun JSONObject?.text(name: String)=this?.takeUnless { it.isNull(name) }?.optString(name)?.takeIf { it.isNotEmpty() }
            fun JSONObject?.instant(name: String)=text(name)?.let { runCatching { Instant.parse(it) }.getOrNull() }
            fun JSONObject?.number(name: String)=this?.takeUnless { it.isNull(name) }?.optDouble(name)?.takeUnless { it.isNaN() }
            val feed=reply.optJSONObject("lastFeed"); val diaper=reply.optJSONObject("lastDiaper"); val sleep=reply.optJSONObject("lastSleep")
            return CareStatus(reply.text("child"),
                feed.instant("at"),feed.text("method"),feed.text("side"),feed.number("amountOz"),feed.number("durationMinutes")?.toInt(),
                diaper.instant("at"),diaper.text("kind"),
                sleep.instant("at"),sleep.instant("endedAt"),now)
        }

        /**
         * An account bootstrap's `data`, read the way the Pi's status route reads the log: the latest
         * feed, diaper and sleep of one child. Null when that child is not the one asked for (or, with
         * none asked for, when there is not exactly one).
         */
        fun fromBootstrap(data: JSONObject,childId: String,now: Instant): CareStatus? {
            val people=data.getJSONArray("profiles")
            val children=(0 until people.length()).map { people.getJSONObject(it) }.filter { it.optString("kind","child")=="child" }
            val child=(if(childId.isNotEmpty()) children.find { it.optString("id")==childId } else children.singleOrNull()) ?: return null
            val events=data.getJSONArray("events")
            val mine=(0 until events.length()).map { events.getJSONObject(it) }.filter { it.optString("babyId")==child.getString("id") }
                .sortedByDescending { runCatching { Instant.parse(it.optString("startedAt")) }.getOrDefault(Instant.EPOCH) }
            // parse() is shared with the Pi's reply, which says ok itself; this one is built here.
            val status=JSONObject().put("ok",true).put("child",child.optString("name"))
            for((type,key) in listOf("feed" to "lastFeed","diaper" to "lastDiaper","sleep" to "lastSleep")) mine.firstOrNull { it.optString("type")==type }?.let { event ->
                status.put(key,JSONObject(event.toString()).put("at",event.getString("startedAt")))
            }
            return parse(status,now)
        }
    }
}

/**
 * A feed being timed on the watch. The Pi cannot run a timer, so it lives here and becomes one
 * finished feed on stop: `timestamp` is its first start, `durationMinutes` the time actually
 * nursing (pauses left out). Time is kept per side so the watch can show it and name the side.
 */
data class FeedTimer(
    val startedAt: Instant,
    val side: String,
    val leftMs: Long,
    val rightMs: Long,
    /** When the current side's stretch began; null while paused. */
    val runningSince: Instant?,
) {
    val paused get()=runningSince==null

    private fun open(now: Instant)=runningSince?.let { Duration.between(it,now).toMillis().coerceAtLeast(0) } ?: 0
    fun onSide(which: String,now: Instant)=(if(which=="left") leftMs else rightMs)+(if(which==side) open(now) else 0)
    fun totalMs(now: Instant)=leftMs+rightMs+open(now)

    private fun closed(now: Instant)=if(side=="left") copy(leftMs=leftMs+open(now)) else copy(rightMs=rightMs+open(now))
    fun pause(now: Instant)=if(paused) this else closed(now).copy(runningSince=null)
    fun resume(now: Instant)=if(paused) copy(runningSince=now) else this
    /** Moving to a side also resumes: that is what latching on again means. */
    fun switchTo(which: String,now: Instant)=if(which==side) resume(now) else closed(now).copy(side=which,runningSince=now)

    fun minutes(now: Instant)=Math.round(totalMs(now)/60_000.0).coerceAtLeast(1).toInt()

    /** Both sides only when each had a real stretch; a stray tap on the other side is not a switch. */
    fun loggedSide(now: Instant): String {
        val left=onSide("left",now); val right=onSide("right",now)
        return when { left>=MIN_SIDE_MS && right>=MIN_SIDE_MS -> "both"; left>=right -> "left"; else -> "right" }
    }

    fun request(now: Instant,zone: ZoneId)=JSONObject()
        .put("type","feed").put("method","nursing")
        .put("side",loggedSide(now))
        .put("durationMinutes",minutes(now))
        .put("timestamp",Requests.timestamp(startedAt,zone))
        .put("source","watch")

    fun toJson()=JSONObject().put("startedAt",startedAt.toEpochMilli()).put("side",side).put("leftMs",leftMs).put("rightMs",rightMs)
        .put("runningSince",runningSince?.toEpochMilli() ?: JSONObject.NULL)

    companion object {
        const val MIN_SIDE_MS=60_000L
        fun start(side: String,now: Instant)=now.truncatedTo(ChronoUnit.SECONDS).let { FeedTimer(it,side,0,0,it) }
        fun fromJson(o: JSONObject)=FeedTimer(Instant.ofEpochMilli(o.getLong("startedAt")),o.getString("side"),o.optLong("leftMs"),o.optLong("rightMs"),
            if(o.isNull("runningSince")) null else Instant.ofEpochMilli(o.getLong("runningSince")))
    }
}

/** Request bodies for POST /api/events. Every entry carries the moment it was tapped, so a queued retry keeps its time. */
object Requests {
    fun timestamp(at: Instant,zone: ZoneId): String=OffsetDateTime.ofInstant(at.truncatedTo(ChronoUnit.SECONDS),zone).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

    fun diaper(kind: String,now: Instant,zone: ZoneId)=JSONObject()
        .put("type","diaper").put("diaperType",kind).put("timestamp",timestamp(now,zone)).put("source","watch")

    fun bottle(oz: Double,now: Instant,zone: ZoneId)=JSONObject()
        .put("type","feed").put("method","bottle").put("amount",oz).put("unit","oz").put("timestamp",timestamp(now,zone)).put("source","watch")
}

/** The lines the watch shows. Pure, so it is unit tested. */
object CareText {
    /** Older than this and the status is marked stale: the Pi or the watch's connection is down. */
    val STALE_AFTER: Duration=Duration.ofMinutes(10)

    fun since(at: Instant,now: Instant): String {
        val minutes=Duration.between(at,now).toMinutes().coerceAtLeast(0)
        return when {
            minutes<1 -> "just now"
            minutes<60 -> "${minutes}m ago"
            minutes<24*60 -> "${minutes/60}h ${minutes%60}m ago"
            else -> "${minutes/(24*60)}d ${(minutes/60)%24}h ago"
        }
    }

    /** "47m", "1h 52m": the hero number, with no "ago". */
    fun compact(at: Instant,now: Instant)=since(at,now).removeSuffix(" ago").let { if(it=="just now") "Now" else it }

    fun elapsed(from: Instant,now: Instant)=clock(Duration.between(from,now).toMillis())

    fun clock(ms: Long): String {
        val seconds=(ms/1000).coerceAtLeast(0)
        val h=seconds/3600; val m=(seconds/60)%60; val s=seconds%60
        return if(h>0) "%d:%02d:%02d".format(h,m,s) else "%d:%02d".format(m,s)
    }

    fun oz(value: Double)=ozNumber(value)+" oz"

    /** Halves as a fraction, the way a bottle's marks read: 2½. */
    fun ozNumber(value: Double): String {
        val whole=value.toInt(); val half=(value-whole)>=0.25
        return when { whole==0 && half -> "½"; half -> "$whole½"; else -> "$whole" }
    }

    fun sideLetter(side: String?)=when(side) { "left" -> "L"; "right" -> "R"; "both" -> "L+R"; else -> null }

    fun feed(status: CareStatus,now: Instant): String {
        val at=status.feedAt ?: return "No feed logged"
        return "${feedDetail(status)} · ${since(at,now)}"
    }

    /** "Nursed L · 18 min", "Bottle · 2 oz": what the last feed was, under the hero number. */
    fun feedDetail(status: CareStatus)=when(status.feedMethod) {
        "nursing" -> listOfNotNull("Nursed "+(sideLetter(status.feedSide) ?: "").trim(),status.feedMinutes?.let { "$it min" }).joinToString(" · ").trim()
        "bottle" -> listOfNotNull("Bottle",status.feedOz?.let(::oz)).joinToString(" · ")
        else -> "Fed"
    }

    fun diaper(status: CareStatus,now: Instant)=status.diaperAt?.let { "Diaper${status.diaperKind?.let { k -> " ($k)" } ?: ""} · ${since(it,now)}" } ?: "No diaper logged"

    fun sleep(status: CareStatus,now: Instant): String? {
        val at=status.sleepAt ?: return null
        return if(status.asleep) "Asleep ${since(at,now).removeSuffix(" ago")}" else "Woke ${since(status.sleepEndedAt!!,now)}"
    }

    /** After one side alone, the other one is next. */
    fun nextSide(status: CareStatus?)=when { status?.feedMethod!="nursing" -> null; status.feedSide=="left" -> "right"; status.feedSide=="right" -> "left"; else -> null }

    fun stale(status: CareStatus,now: Instant)=Duration.between(status.fetchedAt,now)>STALE_AFTER
}
