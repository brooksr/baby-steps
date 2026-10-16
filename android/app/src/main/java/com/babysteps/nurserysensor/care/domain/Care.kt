package com.babysteps.nurserysensor.care.domain

import com.babysteps.nurserysensor.care.model.CareEvent
import com.babysteps.nurserysensor.care.model.EventType
import com.babysteps.nurserysensor.care.model.Profile
import com.babysteps.nurserysensor.care.model.ProfileKind
import java.time.Instant
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.roundToLong
import kotlin.math.sqrt

/** `domain/family.ts`. */
object Family {
    private fun order(p: Profile)=when(p.kind) { ProfileKind.CHILD -> 0; ProfileKind.PARENT -> 1; ProfileKind.CAREGIVER -> 2 }
    /** Children first, then parents, then caregiver sign-ins, each oldest first. */
    fun sort(profiles: List<Profile>)=profiles.sortedWith(compareBy<Profile>({ order(it) },{ it.createdAt },{ it.name }))
    /** Who the switcher shows: archived people are set aside, caregivers are not tracked. */
    fun active(profiles: List<Profile>)=sort(profiles.filter { !it.archived && !it.isCaregiver })
    fun caregiverAccounts(profiles: List<Profile>)=sort(profiles.filter { !it.archived && it.isCaregiver })
    fun archived(profiles: List<Profile>)=sort(profiles.filter { it.archived })
    /** Who an entry can be attributed to: the tracked parents. */
    fun parents(profiles: List<Profile>)=active(profiles).filter { it.isParent }
    fun nameOf(profiles: List<Profile>,id: String?)=id?.let { key -> profiles.find { it.id==key }?.firstName }

    private fun slugify(name: String)=java.text.Normalizer.normalize(name.lowercase(),java.text.Normalizer.Form.NFD)
        .replace(Regex("[\\u0300-\\u036f]"),"").replace(Regex("[^a-z0-9]+"),"-").trim('-').take(32)
    /** A readable id, suffixed only on a collision — what the store makes too. */
    fun profileId(name: String,existing: Collection<String>): String {
        val base=slugify(name).ifEmpty { "child" }
        if(base !in existing) return base
        for(n in 2 until 100) if("$base-$n" !in existing) return "$base-$n"
        return "$base-${System.currentTimeMillis().toString(36)}"
    }
}

/** `domain/diaperDetails.ts`: stool color and size as fields, recovered from notes on older rows. */
object DiaperDetails {
    const val DEFAULT_COLOR="normal"
    private val colorWords=mapOf("black" to listOf("black","meconium","tarry"),"gray" to listOf("gray","grey","clay","chalky"),"green" to listOf("green"),
        "normal" to listOf("normal","yellow","mustard","seedy","brown","tan"),"red" to listOf("red","blood","bloody"),"white" to listOf("white"))
    private val sizeWords=mapOf("large" to listOf("large","big","huge","massive","blowout","blow-out"),"medium" to listOf("medium","moderate","regular","average"),
        "small" to listOf("small","little","tiny","smear","skid"))

    /** The keyword appearing first in the text wins: a note reads left to right. */
    private fun match(text: String,words: Map<String,List<String>>): String? {
        var best: Pair<Int,String>?=null
        for((key,list) in words) for(word in list) {
            val index=Regex("\\b${Regex.escape(word)}\\b",RegexOption.IGNORE_CASE).find(text)?.range?.first ?: continue
            if(best==null || index<best.first) best=index to key
        }
        return best?.second
    }

    fun color(event: CareEvent): String? {
        val stored=event.color?.trim()?.takeIf { it.isNotEmpty() }
        if(stored!=null) return if(Reference.stoolColor(stored.lowercase())!=null) stored.lowercase() else match(stored,colorWords) ?: stored
        if(event.kind=="wet") return null
        return event.notes?.let { match(it,colorWords) }
    }

    fun size(event: CareEvent): String? = event.poopSize ?: if(event.kind=="wet") null else event.notes?.let { match(it,sizeWords) }

    /** A smear and a blowout are both one change; weighting them makes a day's figure comparable. */
    fun weight(size: String?)=when(size) { "large" -> 1.0; "small" -> 1.0/3; else -> 2.0/3 }
}

/** `domain/summary.ts`. */
data class DailySummary(
    var feedCount: Int=0, var nursingMinutes: Double=0.0, var bottleOunces: Double=0.0, var pumpOunces: Double=0.0,
    var wetDiapers: Int=0, var dirtyDiapers: Int=0, var dirtyLarge: Int=0, var dirtyMedium: Int=0, var dirtySmall: Int=0,
    var poopLoad: Double=0.0, var sleepMinutes: Long=0, var medicationsGiven: Int=0, var appointments: Int=0, var growthMeasurements: Int=0, var notes: Int=0,
)

object Summary {
    fun durationMinutes(e: CareEvent): Long = if(e.type==EventType.FEED && e.durationMinutes!=null) e.durationMinutes!!.roundToLong() else Dates.minutesBetween(e.start,e.end)

    fun daily(events: List<CareEvent>): DailySummary {
        val s=DailySummary()
        for(e in events) when(e.type) {
            EventType.FEED -> { s.feedCount++; if(e.method=="nursing") s.nursingMinutes+=e.durationMinutes ?: 0.0 else s.bottleOunces+=e.amountOz ?: 0.0 }
            EventType.BIRTH, EventType.GROWTH -> s.growthMeasurements++
            EventType.PUMP -> s.pumpOunces+=e.amountOz ?: 0.0
            EventType.DIAPER -> {
                if(e.coversWet) s.wetDiapers++
                if(e.coversDirty) {
                    s.dirtyDiapers++
                    val size=DiaperDetails.size(e)
                    s.poopLoad+=DiaperDetails.weight(size)
                    when(size) { "large" -> s.dirtyLarge++; "medium" -> s.dirtyMedium++; "small" -> s.dirtySmall++ }
                }
            }
            EventType.SLEEP -> s.sleepMinutes+=durationMinutes(e)
            EventType.MEDICATION -> if(e.status=="given") s.medicationsGiven++
            EventType.APPOINTMENT -> s.appointments++
            EventType.NOTE -> s.notes++
            else -> {}
        }
        return s
    }

    /** `events` newest first, as `Tracker.eventsFor` hands them over. */
    fun last(events: List<CareEvent>,predicate: (CareEvent) -> Boolean)=events.firstOrNull(predicate)
    fun activeSleep(events: List<CareEvent>)=events.firstOrNull { it.type==EventType.SLEEP && it.end==null }

    fun upcomingMedications(events: List<CareEvent>,now: Instant=Dates.now(),windowMinutes: Long=180): List<CareEvent> {
        val end=now.plusSeconds(windowMinutes*60)
        fun due(e: CareEvent)=com.babysteps.nurserysensor.care.model.parseInstant(e.scheduledAt) ?: e.start
        return events.filter { it.type==EventType.MEDICATION && it.status=="scheduled" && !due(it).isAfter(end) }
            .sortedWith { a,b -> val ad=due(a); val bd=due(b)
                when { ad.isBefore(now) && !bd.isBefore(now) -> -1; bd.isBefore(now) && !ad.isBefore(now) -> 1; else -> ad.compareTo(bd) } }
    }

    fun upcomingAppointments(events: List<CareEvent>,now: Instant=Dates.now(),windowDays: Long=14)=events
        .filter { it.type==EventType.APPOINTMENT && !it.start.isBefore(now) && !it.start.isAfter(now.plusSeconds(windowDays*86400)) }.sortedBy { it.start }
}

/** `domain/diapers.ts`: when the next change is due, from the recent gaps between changes. */
object Diapers {
    private const val MINUTE=60_000.0
    private const val MAX_GAP=12*60.0
    private const val MAX_DIRTY_GAP=3*24*60.0
    private const val MAX_FEED_LAG=6*60.0
    private const val HALF_LIFE_DAYS=3.0
    private const val MIN_GAPS=4
    private const val MIN_DIRTY_GAPS=3
    private const val FEED_WEIGHT=0.4

    data class Lag(val averageMinutes: Double?,val minMinutes: Double?,val maxMinutes: Double?,val samples: Int)
    data class Lags(val wet: Lag,val dirty: Lag)
    data class Prediction(val expectedAt: Instant,val windowStart: Instant,val windowEnd: Instant,val minutesAway: Long,val likelyKind: String,
        val confidence: String,val samples: Int,val typicalGapMinutes: Double,val basis: String)
    private data class Sample(val minutes: Double,val weight: Double)

    private fun t(e: CareEvent)=e.start.toEpochMilli()
    private fun diapers(events: List<CareEvent>)=events.filter { it.type==EventType.DIAPER }.sortedBy { it.start }
    private fun feeds(events: List<CareEvent>)=events.filter { it.type==EventType.FEED }.sortedBy { it.start }
    private fun recency(e: CareEvent,now: Instant)=0.5.pow(max(0.0,(now.toEpochMilli()-t(e))/(24*60*MINUTE))/HALF_LIFE_DAYS)
    private fun weightedMean(s: List<Sample>): Double { val w=s.sumOf { it.weight }; return if(w<=0) s.map { it.minutes }.average() else s.sumOf { it.minutes*it.weight }/w }
    private fun spread(s: List<Sample>,mean: Double): Double { val w=s.sumOf { it.weight }; return if(w<=0) 0.0 else sqrt(s.sumOf { it.weight*(it.minutes-mean).pow(2) }/w) }
    private fun effective(s: List<Sample>): Double { val w=s.sumOf { it.weight }; val w2=s.sumOf { it.weight*it.weight }; return if(w2>0) w*w/w2 else s.size.toDouble() }

    private fun gaps(list: List<CareEvent>,now: Instant,maxGap: Double)=(1 until list.size).mapNotNull { i ->
        val minutes=(t(list[i])-t(list[i-1]))/MINUTE
        if(minutes<=0 || minutes>maxGap) null else Sample(minutes,recency(list[i],now))
    }

    private fun lag(feeds: List<CareEvent>,times: List<Long>): Lag {
        val lags=ArrayList<Double>(); var cursor=0
        for(feed in feeds) {
            while(cursor<times.size && times[cursor]<=t(feed)) cursor++
            if(cursor>=times.size) break
            val minutes=(times[cursor]-t(feed))/MINUTE
            if(minutes<=MAX_FEED_LAG) lags.add(minutes)
        }
        return if(lags.isEmpty()) Lag(null,null,null,0) else Lag(lags.average(),lags.min(),lags.max(),lags.size)
    }

    /** How long after a feed the next wet and next dirty diaper tend to arrive. */
    fun feedToDiaperLags(events: List<CareEvent>): Lags {
        val f=feeds(events); val d=diapers(events)
        return Lags(lag(f,d.filter { it.coversWet }.map(::t)),lag(f,d.filter { it.coversDirty }.map(::t)))
    }

    fun predict(events: List<CareEvent>,now: Instant=Dates.now()): Prediction? {
        val list=diapers(events)
        val last=list.lastOrNull() ?: return null
        val g=gaps(list,now,MAX_GAP)
        if(g.size<MIN_GAPS) return null
        val typical=weightedMean(g); val sd=spread(g,typical)
        var expected=t(last)+typical*MINUTE
        val wetLag=feedToDiaperLags(events).wet
        val lastFeed=feeds(events).filter { t(it)>t(last) && !it.start.isAfter(now) && (now.toEpochMilli()-t(it))/MINUTE<=MAX_FEED_LAG }.lastOrNull()
        val useFeed=lastFeed!=null && wetLag.averageMinutes!=null && wetLag.samples>=MIN_GAPS
        if(useFeed) expected=expected*(1-FEED_WEIGHT)+(t(lastFeed!!)+wetLag.averageMinutes!!*MINUTE)*FEED_WEIGHT
        val half=min(90.0,max(15.0,sd.roundToInt().toDouble()))
        val away=Math.round((expected-now.toEpochMilli())/MINUTE)
        val variation=if(typical>0) sd/typical else 1.0
        val samples=effective(g).roundToInt()
        val confidence=if(away< -typical) "low" else if(samples>=12 && variation<=0.35) "high" else if(samples>=6 && variation<=0.6) "medium" else "low"
        val basis=listOfNotNull("Typical ${Dates.duration(typical.roundToLong())} between changes",
            if(useFeed) "adjusted for the feed ${Dates.duration(max(0,((now.toEpochMilli()-t(lastFeed!!))/MINUTE).roundToLong()))} ago" else null).joinToString(", ")
        val expectedAt=Instant.ofEpochMilli(expected.roundToLong())
        // Dirty if the usual dirty stretch will have run out by the predicted time.
        val dirty=list.filter { it.coversDirty }; val dirtyGaps=gaps(dirty,now,MAX_DIRTY_GAP)
        val kind=if(dirty.isEmpty() || dirtyGaps.size<MIN_DIRTY_GAPS) "wet" else if((expected-t(dirty.last()))/MINUTE>=weightedMean(dirtyGaps)) "dirty" else "wet"
        return Prediction(expectedAt,expectedAt.minusMillis((half*MINUTE).roundToLong()),expectedAt.plusMillis((half*MINUTE).roundToLong()),away,kind,
            confidence,samples,typical,"$basis · $samples recent gaps")
    }
}

/** `domain/cadence.ts`: gentle nudges about the log, never medical guidance. */
object Cadence {
    data class Reminder(val kind: String,val title: String,val message: String)
    data class FeedPrediction(val expectedAt: Instant,val minutesAway: Long,val windowStart: Instant,val windowEnd: Instant)
    data class BathPrediction(val due: Boolean,val windowStartKey: String,val windowEndKey: String)

    fun nextFeed(events: List<CareEvent>,now: Instant=Dates.now()): FeedPrediction? {
        val last=Summary.last(events) { it.type==EventType.FEED } ?: return null
        val expected=last.start.plusSeconds((2.5*3600).toLong())
        return FeedPrediction(expected,Math.round((expected.toEpochMilli()-now.toEpochMilli())/60_000.0),last.start.plusSeconds(2*3600),last.start.plusSeconds(3*3600))
    }

    fun nextBath(events: List<CareEvent>,now: Instant=Dates.now()): BathPrediction? {
        val last=Summary.last(events) { it.type==EventType.BATH } ?: return null
        val key=Dates.key(last.start)
        return BathPrediction(due=Dates.daysAgo(last.start,now)>=3,windowStartKey=Dates.addDays(key,2),windowEndKey=Dates.addDays(key,3))
    }

    fun reminders(events: List<CareEvent>,feedInProgress: Boolean,now: Instant=Dates.now()): List<Reminder> {
        val out=ArrayList<Reminder>()
        if(!feedInProgress) Summary.last(events) { it.type==EventType.FEED }?.let { feed ->
            val since=Math.round((now.toEpochMilli()-feed.start.toEpochMilli())/60_000.0)
            if(since>=180) out.add(Reminder("feed","Last feed was ${Dates.duration(since)} ago",
                "Feeds usually land every 2–3 hours, day and night. Offer one when you can — if feeds keep slipping or something seems off, check in with your pediatrician."))
        }
        Summary.last(events) { it.type==EventType.BATH }?.let { bath ->
            if(Dates.daysAgo(bath.start,now)>=3) out.add(Reminder("bath","Last bath was ${Dates.daysAgoText(bath.start,now)}",
                "Every 2–3 days is the usual rhythm for a bath. No rush if today is busy — a quick top-and-tail counts."))
        }
        return out
    }
}
