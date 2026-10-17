package com.babysteps.nurserysensor.care

import com.babysteps.nurserysensor.care.data.CareRepository
import com.babysteps.nurserysensor.care.domain.*
import com.babysteps.nurserysensor.care.model.CareEvent
import com.babysteps.nurserysensor.care.model.EventType
import com.babysteps.nurserysensor.care.model.Profile
import com.babysteps.nurserysensor.care.model.Tracker
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.File
import java.time.Instant
import java.util.Locale
import java.util.TimeZone

/** The ported Babysteps logic, held to what the web app's own tests expect of it. */
class CareDomainTest {
    @Before fun setUp() {
        TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles")); Locale.setDefault(Locale.US)
        Reference.initFromDirectory(File(requireNotNull(System.getProperty("babysteps.referenceDir"))))
    }

    private var n=0
    private fun event(type: String,at: String,vararg fields: Pair<String,Any>)=CareEvent(JSONObject().put("id","e${n++}").put("babyId","baby").put("type",type).put("startedAt",at).apply { fields.forEach { (k,v) -> put(k,v) } })
    private fun profile(vararg fields: Pair<String,Any>)=Profile(JSONObject().put("id","baby").put("name","Theo Example").put("createdAt","2026-08-01T00:00:00.000Z").apply { fields.forEach { (k,v) -> put(k,v) } })
    private fun at(local: String)=Instant.parse(java.time.LocalDateTime.parse(local).atZone(Dates.zone).toInstant().toString())

    @Test fun agesReadTheWayPeopleSayThem() {
        val p=profile("birthDate" to "2026-08-07")
        assertEquals("Newborn",Dates.ageSummary(p,at("2026-08-07T18:00")))
        assertEquals("9 days",Dates.ageSummary(p,at("2026-08-16T13:00")))
        assertEquals("3 weeks",Dates.ageSummary(p,at("2026-08-30T13:00")))
        assertEquals("2 months",Dates.ageSummary(p,at("2026-10-16T09:00")))
        assertEquals("Due in 4 days",Dates.dueStatus(profile("dueDate" to "2026-10-19"),at("2026-10-16T09:00")))
    }

    @Test fun durationsAndRanges() {
        assertEquals("45m",Dates.duration(45L)); assertEquals("2h",Dates.duration(120L)); assertEquals("1h 5m",Dates.duration(65L))
        assertEquals("6:30–7:30 AM",Dates.clockRange(at("2026-10-16T06:31"),at("2026-10-16T07:29")))
        assertEquals("6–7 AM",Dates.clockRange(at("2026-10-16T06:00"),at("2026-10-16T07:00")))
        assertEquals("11 AM–1 PM",Dates.clockRange(at("2026-10-16T11:00"),at("2026-10-16T13:00")))
    }

    @Test fun summaryCountsBothAsWetAndDirtyAndWeighsPoops() {
        val s=Summary.daily(listOf(event("diaper","2026-10-16T16:00:00.000Z","kind" to "both","poopSize" to "large"),
            event("diaper","2026-10-16T17:00:00.000Z","kind" to "dirty","notes" to "tiny smear"),
            event("feed","2026-10-16T15:00:00.000Z","method" to "bottle","amountOz" to 3),
            event("breastfeed","2026-10-16T14:00:00.000Z","durationMinutes" to 20)))
        assertEquals(1,s.wetDiapers); assertEquals(2,s.dirtyDiapers); assertEquals(1,s.dirtyLarge); assertEquals(1,s.dirtySmall)
        assertEquals(1.0+1.0/3,s.poopLoad,1e-9); assertEquals(2,s.feedCount); assertEquals(3.0,s.bottleOunces,0.0); assertEquals(20.0,s.nursingMinutes,0.0)
    }

    @Test fun diaperPredictionStaysQuietUnderFourGaps() {
        val base=at("2026-10-16T06:00")
        val three=(0..3).map { event("diaper",base.plusSeconds(it*3L*3600).toString(),"kind" to "wet") }
        assertNull(Diapers.predict(three,base.plusSeconds(10*3600)))
        val five=(0..5).map { event("diaper",base.plusSeconds(it*3L*3600).toString(),"kind" to "wet") }
        val prediction=Diapers.predict(five,base.plusSeconds(16*3600))!!
        assertEquals(180.0,prediction.typicalGapMinutes,0.5)
        assertEquals(base.plusSeconds(18*3600),prediction.expectedAt)
    }

    @Test fun feedReminderOnlyAfterThreeHoursAndNeverDuringATimer() {
        val events=listOf(event("feed","2026-10-16T13:00:00.000Z","method" to "nursing"))
        assertTrue(Cadence.reminders(events,false,Instant.parse("2026-10-16T15:30:00Z")).isEmpty())
        assertEquals("Last feed was 3h 10m ago",Cadence.reminders(events,false,Instant.parse("2026-10-16T16:10:00Z")).single().title)
        assertTrue(Cadence.reminders(events,true,Instant.parse("2026-10-16T16:10:00Z")).isEmpty())
    }

    @Test fun bathWindowWaitsForTheOriginalTimeAndKeepsLocalTimeAcrossDst() {
        val events=listOf(event("bath",at("2026-09-08T19:00").toString()))
        for(time in listOf("2026-09-11T09:00","2026-09-11T18:59:59","2026-09-11T19:00")) {
            val now=at(time); val prediction=Cadence.nextBath(events,now)!!
            assertFalse(prediction.due)
            assertTrue(Cadence.inWindow(prediction.windowStart,prediction.windowEnd,now))
            assertTrue(Cadence.reminders(events,false,now).isEmpty())
        }
        val after=at("2026-09-11T19:00").plusMillis(1)
        assertTrue(Cadence.nextBath(events,after)!!.due)
        assertEquals("bath",Cadence.reminders(events,false,after).single().kind)
        val dst=Cadence.nextBath(listOf(event("bath",at("2026-10-31T19:00").toString())),at("2026-11-03T18:00"))!!
        assertEquals(19,dst.windowEnd.atZone(Dates.zone).hour)
        assertFalse(dst.due)
    }

    private fun diaperWindow(last: String,now: String): Diapers.Prediction {
        val end=at(last)
        val events=(0..7).map { event("diaper",end.minusSeconds((7-it)*3L*3600).toString(),"kind" to "wet") }
        return Diapers.predict(events,at(now))!!
    }

    @Test fun overnightDiaperAllowanceUsesEightElapsedHoursAndSevenAmBoundary() {
        val p=diaperWindow("2026-10-01T19:00","2026-10-02T01:00")
        assertEquals(at("2026-10-02T03:00"),p.windowEnd)
        assertEquals(at("2026-10-01T21:45"),p.windowStart)
        assertTrue(Cadence.inWindow(p.windowStart,p.windowEnd,at("2026-10-02T03:00")))
        assertFalse(Cadence.inWindow(p.windowStart,p.windowEnd,at("2026-10-02T03:00").plusMillis(1)))
        assertEquals(at("2026-10-02T07:00"),diaperWindow("2026-10-01T23:00","2026-10-02T06:59:59").windowEnd)
        assertEquals(at("2026-10-02T02:15"),diaperWindow("2026-10-01T23:00","2026-10-02T07:00").windowEnd)
        assertEquals(at("2026-10-01T19:15"),diaperWindow("2026-10-01T16:00","2026-10-01T18:59:59").windowEnd)
        assertEquals(at("2026-10-02T00:00"),diaperWindow("2026-10-01T16:00","2026-10-01T19:00").windowEnd)
        val late=diaperWindow("2026-10-02T06:00","2026-10-02T06:30")
        assertEquals(at("2026-10-02T07:00"),late.windowEnd)
        assertFalse(late.windowStart.isAfter(late.windowEnd))
        assertEquals(at("2026-10-31T23:00").plusSeconds(8*3600),diaperWindow("2026-10-31T23:00","2026-11-01T01:30").windowEnd)
    }

    @Test fun feedWindowIncludesItsEndAndTimerSuppressesReminder() {
        val events=listOf(event("feed",at("2026-10-01T09:00").toString(),"method" to "bottle"))
        val end=at("2026-10-01T12:00"); val prediction=Cadence.nextFeed(events,end)!!
        assertTrue(Cadence.inWindow(prediction.windowStart,prediction.windowEnd,end))
        assertTrue(Cadence.reminders(events,false,end).isEmpty())
        assertEquals("feed",Cadence.reminders(events,false,end.plusMillis(1)).single().kind)
        assertTrue(Cadence.reminders(events,true,end.plusMillis(1)).isEmpty())
    }

    @Test fun growthBandsAndCorrectedAge() {
        val st=Growth.standards("boy")
        assertEquals("within",Growth.classify(Growth.Metric.WEIGHT,0.0,3.3,st).band)
        assertEquals("below",Growth.classify(Growth.Metric.WEIGHT,0.0,2.0,st).band)
        assertEquals(50,Growth.classify(Growth.Metric.WEIGHT,0.0,3.3,st).percentile)
        val g=Growth.gestation(profile("birthDate" to "2026-08-01","dueDate" to "2026-08-29"))!!
        assertEquals("36w0d",g.label); assertEquals(28,g.correctionDays); assertTrue(g.latePreterm)
    }

    @Test fun newbornDayIsJudgedOnPace() {
        val p=profile("birthDate" to "2026-10-10")
        // Day 7 wants 6 wet by bedtime: at 9am that is 2 by now, so 2 is on pace and 1 is behind.
        val wet={ hour: Int -> event("diaper",at("2026-10-16T0$hour:00").toString(),"kind" to "wet") }
        assertEquals("below",Growth.assessNewbornDay(p,listOf(wet(7)),"2026-10-16",at("2026-10-16T09:00"))!!.checks.first().status)
        val day=Growth.assessNewbornDay(p,listOf(wet(7),wet(8)),"2026-10-16",at("2026-10-16T09:00"))!!
        assertEquals(7,day.dayOfLife)
        assertEquals("pending",day.checks.first().status)
        assertFalse(day.dayComplete)
    }

    @Test fun cyclesNeedTwoBeforeTheyPredict() {
        fun period(start: String)=(0..3).map { event("menses",at("${Dates.addDays(start,it.toLong())}T09:00").toString(),"flow" to "medium") }
        val one=period("2026-08-01")+period("2026-08-29")
        assertNull(Cycle.predict(Cycle.stats(one)))
        val two=one+period("2026-09-26")
        val pr=Cycle.predict(Cycle.stats(two))!!
        assertEquals("2026-10-24",pr.nextPeriodKey); assertEquals("2026-10-10",pr.ovulationKey); assertEquals("low",pr.confidence)
    }

    @Test fun restSubtractsWakeupsAndSettling() {
        val start=at("2026-10-15T22:00"); val end=at("2026-10-16T06:00")
        val rest=ParentReport.rest(start,end,listOf(event("feed",at("2026-10-16T02:00").toString(),"method" to "nursing")))
        assertEquals(480,rest.inBed); assertEquals(1,rest.wakeups); assertEquals(465,rest.rest); assertEquals(240,rest.longest)
    }

    @Test fun nightCountsAWakeBetweenTwoStretches() {
        val events=listOf(event("feed",at("2026-10-15T19:30").toString(),"method" to "nursing","durationMinutes" to 20),
            event("feed",at("2026-10-16T01:00").toString(),"method" to "nursing","durationMinutes" to 20),
            event("diaper",at("2026-10-16T01:25").toString(),"kind" to "wet"))
        val night=BabyNights.night(events,"2026-10-15",null,at("2026-10-16T12:00"))
        assertTrue(night.tracked); assertEquals(1,night.wakes.size); assertTrue(night.estimated)
        assertEquals(2,night.sleeps.size)
    }

    @Test fun shoppingMatchesNamesLooselyAndKeepsTheCatalogue() {
        assertEquals("oat milk",Shopping.normalize("  Oat-Milk! "))
        val items=listOf(com.babysteps.nurserysensor.care.model.ShoppingItem(JSONObject().put("id","s1").put("name","Oat milk").put("status","done").put("category","dairy")))
        assertEquals("s1",Shopping.find(items,"oat MILK")?.id)
        assertEquals(listOf("s1"),Shopping.suggest(items,"oat").map { it.id })
    }

    @Test fun outboxLandsTheWayTheStoreWould() {
        val base=Tracker(listOf(profile()),listOf(event("feed","2026-10-16T13:00:00.000Z","method" to "nursing")),emptyList(),emptyList())
        val ops=JSONArray()
            .put(JSONObject().put("op","addEvent").put("input",JSONObject().put("id","new").put("babyId","baby").put("type","diaper").put("kind","wet").put("startedAt","2026-10-16T14:00:00.000Z")))
            .put(JSONObject().put("op","deleteEvent").put("id","e0"))
            .put(JSONObject().put("op","saveShoppingItem").put("input",JSONObject().put("id","shop_x").put("name","Wipes")))
            .put(JSONObject().put("op","saveProfile").put("profile",JSONObject().put("id","baby").put("gender","boy")))
        val out=CareRepository.applyOutbox(base,ops)
        assertEquals(listOf("new"),out.events.map { it.id })
        assertEquals("need",out.shopping.single().status)
        assertEquals("boy",out.profiles.single().gender); assertEquals("Theo Example",out.profiles.single().name)
    }

    @Test fun expectReadsTheStageAndPersonalizes() {
        val outlook=Expect.outlook(profile("birthDate" to "2026-10-10","gender" to "boy"),at("2026-10-16T12:00")) as Expect.Child
        assertNotNull(outlook.stage); assertFalse(outlook.stage!!.summary.contains("{"))
        assertEquals("his",Expect.personalize("{their}",profile("gender" to "boy")))
    }

    @Test fun feedOrderOnlyCountsOrdinaryDays() {
        val feeds=(0..2).flatMap { d -> (0 until 9).map { i -> event("feed",at("${Dates.addDays("2026-10-10",d.toLong())}T06:00").plusSeconds(i*7200L).toString(),"method" to "nursing") } }
        val report=FeedOrder.report(feeds+event("feed",at("2026-10-14T08:00").toString(),"method" to "nursing"))
        assertEquals(3,report.days); assertEquals(4,report.loggedDays); assertEquals(9,report.typicalCount)
        assertEquals(60.0,report.slots.first().averageOffset,0.0)
    }

    @Test fun emergencyPutsYoungInfantFeverNearTheTop() {
        assertEquals("fever",Emergency.guides("infant",30)[3].id)
        assertEquals("fever",Emergency.guides("child",400).last().id)
        assertEquals("infant",Emergency.group(null))
    }

    @Test fun eventTextReadsLikeTheTimeline() {
        assertEquals("bottle · formula · 3 oz",EventText.detail(event("feed","2026-10-16T13:00:00.000Z","method" to "bottle","contents" to "formula","amountOz" to 3),profile()))
        assertEquals("7 lb 8 oz",EventText.detail(event("growth","2026-10-16T13:00:00.000Z","weightOz" to 120),profile()))
        assertTrue(EventText.detail(event("temperature","2026-10-16T13:00:00.000Z","celsius" to 38.3),profile()).endsWith("Fever"))
    }
}
