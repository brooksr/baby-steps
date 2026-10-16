package com.babysteps.watch

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class CareModelsTest {
    private val zone=ZoneId.of("America/Los_Angeles")
    private val now=Instant.parse("2026-10-12T21:40:00Z")

    private val reply="""{"ok":true,"child":"Ada",
        "lastFeed":{"at":"2026-10-12T20:10:00.000Z","endedAt":null,"method":"nursing","amountOz":null,"durationMinutes":18,"side":"left"},
        "lastDiaper":{"at":"2026-10-12T21:00:00.000Z","kind":"dirty"},
        "lastSleep":{"at":"2026-10-12T21:15:00.000Z","endedAt":null}}"""

    @Test fun readsTheStatusAndSaysItShort() {
        val status=CareStatus.parse(JSONObject(reply),now)
        assertEquals("Ada",status.child)
        assertNull(status.feedOz)
        assertEquals("Nursed L · 18 min · 1h 30m ago",CareText.feed(status,now))
        assertEquals("1h 30m",CareText.compact(status.feedAt!!,now))
        assertEquals("Diaper (dirty) · 40m ago",CareText.diaper(status,now))
        assertEquals("Asleep 25m",CareText.sleep(status,now))
        assertEquals("right",CareText.nextSide(status))
        assertFalse(CareText.stale(status,now.plusSeconds(9*60)))
        assertTrue(CareText.stale(status,now.plusSeconds(11*60)))
    }

    @Test fun emptyLogAndBottles() {
        val empty=CareStatus.parse(JSONObject("""{"ok":true,"child":"Ada","lastFeed":null,"lastDiaper":null,"lastSleep":null}"""),now)
        assertEquals("No feed logged",CareText.feed(empty,now))
        assertEquals("No diaper logged",CareText.diaper(empty,now))
        assertNull(CareText.sleep(empty,now))
        assertNull(CareText.nextSide(empty))
        val bottle=empty.copy(feedAt=now.minusSeconds(300),feedMethod="bottle",feedOz=3.5)
        assertEquals("Bottle · 3½ oz · 5m ago",CareText.feed(bottle,now))
    }

    @Test(expected=IllegalStateException::class) fun refusesARefusal() {
        CareStatus.parse(JSONObject("""{"error":"unknown_child","errors":["Name the child: Ada, Ben."]}"""),now)
    }

    @Test fun aTimedFeedIsSentAsOneFinishedFeedFromItsStart() {
        val start=Instant.parse("2026-10-12T21:20:30.400Z")
        val timer=FeedTimer.start("left",start)
        assertEquals("""{"type":"feed","method":"nursing","side":"left","durationMinutes":20,"timestamp":"2026-10-12T14:20:30-07:00","source":"watch"}""".let(::JSONObject).fields(),
            timer.request(now,zone).fields())
        assertEquals(1,FeedTimer.start("right",now).minutes(now))
    }

    @Test fun pausesAreLeftOutAndEachSideKeepsItsTime() {
        val t0=Instant.parse("2026-10-12T21:00:00Z")
        var timer=FeedTimer.start("left",t0)
        timer=timer.pause(t0.plusSeconds(8*60))
        assertTrue(timer.paused)
        assertEquals(8*60_000L,timer.totalMs(t0.plusSeconds(20*60)))
        // Switching sides resumes.
        timer=timer.switchTo("right",t0.plusSeconds(12*60))
        assertFalse(timer.paused)
        val end=t0.plusSeconds(17*60)
        assertEquals(8*60_000L,timer.onSide("left",end))
        assertEquals(5*60_000L,timer.onSide("right",end))
        assertEquals(13,timer.minutes(end))
        assertEquals("both",timer.loggedSide(end))
        assertEquals(timer,FeedTimer.fromJson(JSONObject(timer.toJson().toString())))
    }

    @Test fun aStrayTapOnTheOtherSideIsNotBoth() {
        val t0=Instant.parse("2026-10-12T21:00:00Z")
        val timer=FeedTimer.start("left",t0).switchTo("right",t0.plusSeconds(10*60)).switchTo("left",t0.plusSeconds(10*60+20))
        assertEquals("left",timer.loggedSide(t0.plusSeconds(15*60)))
        val paused=FeedTimer.start("right",t0).pause(t0.plusSeconds(60))
        assertEquals(paused,FeedTimer.fromJson(JSONObject(paused.toJson().toString())))
    }

    @Test fun diaperAndBottleCarryTheirOwnTime() {
        assertEquals(mapOf("type" to "diaper","diaperType" to "wet","timestamp" to "2026-10-12T14:40:00-07:00","source" to "watch"),Requests.diaper("wet",now,zone).fields())
        val bottle=Requests.bottle(4.5,now,zone)
        assertEquals(4.5,bottle.getDouble("amount"),0.0)
        assertEquals("oz",bottle.getString("unit"))
        assertEquals("bottle",bottle.getString("method"))
    }

    @Test fun clocks() {
        assertEquals("just now",CareText.since(now,now))
        assertEquals("2d 3h ago",CareText.since(now.minusSeconds(51*3600),now))
        assertEquals("4:05",CareText.elapsed(now.minusSeconds(245),now))
        assertEquals("1:00:07",CareText.elapsed(now.minusSeconds(3607),now))
        assertEquals("3 oz",CareText.oz(3.0))
        assertEquals("½",CareText.ozNumber(0.5))
        assertEquals("2½",CareText.ozNumber(2.5))
        assertEquals("Now",CareText.compact(now,now))
    }
}

private fun JSONObject.fields()=keys().asSequence().associateWith { get(it) }
