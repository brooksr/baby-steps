package com.babysteps.nurserysensor.care.domain

import com.babysteps.nurserysensor.care.model.CareEvent
import com.babysteps.nurserysensor.care.model.EventType
import com.babysteps.nurserysensor.care.model.parseInstant
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import kotlin.math.max
import kotlin.math.min

/** The nursery sensor's nights and episodes, as the Pi reads them back (`domain/nurserySensor.ts`). */
data class NurseryData(val nights: List<Night>,val episodes: List<Episode>) {
    data class Night(val nightOf: String,val coveragePercent: Double,val cryEpisodes: Int,val status: String)
    data class Episode(val label: String,val start: Instant,val end: Instant,val maxScore: Double)

    companion object {
        fun parse(json: JSONObject?): NurseryData? {
            json ?: return null
            val nights=json.optJSONArray("nights")?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) }.mapNotNull {
                val night=it.optString("nightOf")
                if(!Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(night)) null else Night(night,it.optDouble("coveragePercent",0.0),it.optInt("cryEpisodes"),it.optString("status")) } }.orEmpty()
            val episodes=json.optJSONArray("episodes")?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) }.mapNotNull {
                val s=parseInstant(it.optString("startedAt")); val e=parseInstant(it.optString("endedAt"))
                if(s==null || e==null) null else Episode(it.optString("label"),s,e,it.optDouble("maxScore",0.0)) } }.orEmpty()
            return NurseryData(nights,episodes)
        }
    }
}

/**
 * `domain/babyNights.ts`: a baby's night read from what was logged. Wakes are night care
 * entries clustered within half an hour; sleep is the stretches between them — as
 * logged where a sleep entry covers it, estimated everywhere else. Heard crying
 * cuts estimated sleep but never adds a wake or touches logged sleep.
 */
object BabyNights {
    const val NIGHT_START_HOUR=19
    const val NIGHT_END_HOUR=7
    const val WAKE_CLUSTER_MINUTES=30
    const val SETTLE_MINUTES=15
    const val MIN_STRETCH_MINUTES=30
    private const val MAX_SLEEP_MINUTES=16*60
    private const val MAX_FEED_MINUTES=4*60
    private const val STRETCH_HOURS=3
    private const val BEDTIME_LATEST_HOURS=4
    private const val EVENING_SETTLE_HOURS=2
    private const val RESETTLE_LOOKAHEAD_MINUTES=60
    private const val CRY_CLUSTER_MINUTES=10
    private const val HEARD_MATCH_MINUTES=15
    private const val LOGGED_SHARE=0.9
    private val WAKE_TYPES=setOf(EventType.DIAPER,EventType.FEED,EventType.MEDICATION,EventType.TEMPERATURE)
    private const val MIN=60_000L
    private const val HOUR=60*MIN

    data class Span(var start: Long,var end: Long)
    data class Unlogged(val start: Instant,val end: Instant?)
    data class Stretch(val start: Instant,val end: Instant,val minutes: Long,val source: String,val unlogged: List<Unlogged>)
    data class Item(val start: Instant,val type: EventType)
    data class Wake(val start: Instant,val end: Instant,val resumed: Instant,val entries: Int,val types: List<EventType>,val items: List<Item>,val heard: Boolean)
    data class Cry(val start: Instant,val end: Instant,val episodes: Int,val withWake: Boolean)
    data class Night(val dateKey: String,val start: Instant,val end: Instant,val inProgress: Boolean,val tracked: Boolean,val bedtime: Instant?,
        val sleeps: List<Stretch>,val wakes: List<Wake>,val edges: List<Wake>,val sleepMinutes: Long,val longestStretchMinutes: Long,val estimated: Boolean,
        val heard: List<Cry>,val sensor: NurseryData.Night?)
    data class Day(val dateKey: String,val start: Instant,val end: Instant,val upcoming: Boolean,val inProgress: Boolean,val naps: List<Stretch>,
        val items: List<Item>,val openings: List<Unlogged>,val napMinutes: Long,val longestNapMinutes: Long,val heard: List<Cry>)
    data class Stat(val average: Double,val max: Double,val min: Double)
    data class Report(val nights: List<Night>,val span: Int,val sleepMinutes: Stat?,val wakes: Stat?,val longestStretchMinutes: Stat?,val napMinutes: Stat?,val estimatedNights: Int)

    private class Cluster(var start: Long,var end: Long,var entries: Int,val items: MutableList<Pair<Long,EventType>>,var resume: Long,val types: MutableSet<EventType>)

    private fun ms(t: Long)=Instant.ofEpochMilli(t)
    private fun minutesOf(s: Span)=Math.round((s.end-s.start).toDouble()/MIN)

    fun shiftNightKey(key: String,days: Long)=Dates.addDays(key,days)
    fun currentNightKey(now: Instant=Dates.now()): String { val today=Dates.key(now); return if(now.atZone(Dates.zone).hour>=NIGHT_START_HOUR) today else shiftNightKey(today,-1) }
    /** The night that opens first: last night all day, until tonight is well under way. */
    fun defaultNightKey(now: Instant=Dates.now()) = currentNightKey(now).let { if(now.atZone(Dates.zone).hour>=NIGHT_START_HOUR) shiftNightKey(it,-1) else it }

    private fun window(key: String): Span {
        val d=LocalDate.parse(key)
        return Span(d.atTime(NIGHT_START_HOUR,0).atZone(Dates.zone).toInstant().toEpochMilli(),d.plusDays(1).atTime(NIGHT_END_HOUR,0).atZone(Dates.zone).toInstant().toEpochMilli())
    }

    private fun sleepSpans(events: List<CareEvent>,now: Long): List<Span> {
        val spans=events.filter { it.type==EventType.SLEEP }.map { Span(it.start.toEpochMilli(),it.end?.toEpochMilli() ?: now) }
            .filter { it.end>it.start && it.end-it.start<=MAX_SLEEP_MINUTES*MIN }.sortedBy { it.start }
        val merged=ArrayList<Span>()
        for(s in spans) { val last=merged.lastOrNull(); if(last!=null && s.start<last.end) last.end=max(last.end,s.end) else merged.add(s.copy()) }
        return merged
    }

    private fun overlap(span: Span,spans: List<Span>)=spans.sumOf { max(0,min(span.end,it.end)-max(span.start,it.start)) }

    private fun subtract(span: Span,cuts: List<Span>): List<Span> {
        var pieces=listOf(span.copy())
        for(cut in cuts) pieces=pieces.flatMap { p -> if(cut.end<=p.start || cut.start>=p.end) listOf(p) else listOf(Span(p.start,cut.start),Span(cut.end,p.end)).filter { it.end>it.start } }
        return pieces
    }

    private fun heardCries(nursery: NurseryData?,span: Span): List<Cry> {
        val eps=nursery?.episodes.orEmpty().filter { it.label=="baby_cry" }.map { Span(it.start.toEpochMilli(),it.end.toEpochMilli()) }
            .filter { it.start>=span.start && it.start<span.end }.sortedBy { it.start }
        val bouts=ArrayList<Pair<Span,Int>>()
        for(e in eps) { val last=bouts.lastOrNull()
            if(last!=null && e.start<=last.first.end+CRY_CLUSTER_MINUTES*MIN) { last.first.end=max(last.first.end,e.end); bouts[bouts.size-1]=last.first to last.second+1 } else bouts.add(e.copy() to 1) }
        return bouts.map { Cry(ms(it.first.start),ms(it.first.end),it.second,false) }
    }

    private fun toWake(c: Cluster,heard: List<Cry>)=Wake(ms(c.start),ms(c.end),ms(c.resume),c.entries,c.types.sortedBy { it.key },c.items.map { Item(ms(it.first),it.second) },
        heard.any { it.end.toEpochMilli()>=c.start-HEARD_MATCH_MINUTES*MIN && it.start.toEpochMilli()<=c.resume+HEARD_MATCH_MINUTES*MIN })

    private fun entryEnd(e: CareEvent)=e.start.toEpochMilli()+min(Summary.durationMinutes(e),MAX_FEED_MINUTES.toLong())*MIN

    fun night(events: List<CareEvent>,key: String,nursery: NurseryData?,now: Instant=Dates.now()): Night {
        val nowMs=now.toEpochMilli(); val w=window(key); val spans=sleepSpans(events,nowMs); val stretch=STRETCH_HOURS*HOUR
        val bed=spans.find { it.end>w.start && it.start>=w.start-stretch && it.start<w.start+BEDTIME_LATEST_HOURS*HOUR }
        val lieIn=spans.find { it.start<w.end && it.end>w.end }
        val span=Span(bed?.start ?: w.start,lieIn?.let { min(it.end,w.end+stretch) } ?: w.end)
        val inProgress=nowMs<span.end; val until=min(span.end,nowMs)
        val heard=heardCries(nursery,Span(span.start,until))
        val sensor=nursery?.nights.orEmpty().filter { it.nightOf==key }.maxByOrNull { it.coveragePercent }
        val margin=2*HOUR
        val tracked=until>span.start && events.any { (it.type==EventType.SLEEP || it.type in WAKE_TYPES) && it.start.toEpochMilli().let { t -> t>=w.start-margin && t<w.end+margin } }
        val empty=Night(key,ms(span.start),ms(span.end),inProgress,tracked,bed?.let { ms(it.start) },emptyList(),emptyList(),emptyList(),0,0,false,heard,sensor)
        if(!tracked) return empty

        val entries=events.filter { it.type in WAKE_TYPES }.map { Triple(it.start.toEpochMilli(),entryEnd(it),it.type!!) }.filter { it.first>=span.start && it.first<until }.sortedBy { it.first }
        val clusters=ArrayList<Cluster>()
        for((s,e,t) in entries) { val last=clusters.lastOrNull()
            if(last!=null && s<=last.end+WAKE_CLUSTER_MINUTES*MIN) { last.end=max(last.end,e); last.entries++; last.items.add(s to t); last.types.add(t) }
            else clusters.add(Cluster(s,e,1,mutableListOf(s to t),e,mutableSetOf(t))) }
        for(c in clusters) {
            val ended=spans.find { it.end<=c.start && it.end>=c.start-WAKE_CLUSTER_MINUTES*MIN && it.end>span.start }
            val resettled=spans.find { it.start>=c.end && it.start<=c.end+RESETTLE_LOOKAHEAD_MINUTES*MIN }
            c.start=ended?.end ?: c.start
            c.resume=min(until,resettled?.start ?: (c.end+SETTLE_MINUTES*MIN))
        }
        val wakes=ArrayList<Cluster>()
        for(c in clusters) { val last=wakes.lastOrNull()
            if(last!=null && c.start-last.resume<MIN_STRETCH_MINUTES*MIN) { last.end=max(last.end,c.end); last.resume=max(last.resume,c.resume); last.entries+=c.entries; last.items.addAll(c.items); last.types.addAll(c.types) }
            else wakes.add(c) }
        val minStretch=MIN_STRETCH_MINUTES*MIN
        var before: Cluster?=if(wakes.isNotEmpty() && wakes[0].start-span.start<minStretch) wakes.removeAt(0) else null
        // No bedtime logged: everything before 9pm is the routine of going down.
        while(bed==null && wakes.isNotEmpty() && wakes[0].start<w.start+EVENING_SETTLE_HOURS*HOUR) {
            val next=wakes.removeAt(0)
            before=before?.let { Cluster(it.start,max(it.end,next.end),it.entries+next.entries,(it.items+next.items).toMutableList(),next.resume,(it.types+next.types).toMutableSet()) } ?: next
        }
        val last=wakes.lastOrNull()
        val after=if(!inProgress && last!=null && until-last.resume<minStretch) wakes.removeAt(wakes.size-1) else null
        val bounds=ArrayList<Span>(); var cursor=before?.resume ?: span.start
        for(wk in wakes) { bounds.add(Span(cursor,wk.start)); cursor=wk.resume }
        bounds.add(Span(cursor,after?.start ?: until))
        val cuts=heard.map { Span(it.start.toEpochMilli(),min(until,it.end.toEpochMilli()+SETTLE_MINUTES*MIN)) }.flatMap { cut -> spans.fold(listOf(cut)) { parts,sleep -> parts.flatMap { subtract(it,listOf(sleep)) } } }
        val sleeps=bounds.flatMap { subtract(it,cuts) }.filter { it.end-it.start>=minStretch }.map { b ->
            val share=overlap(b,spans).toDouble()/(b.end-b.start)
            val unlogged=subtract(b,spans).filter { it.end-it.start>=minStretch }.map { Unlogged(ms(it.start),if(inProgress && it.end>=until) null else ms(it.end)) }
            Stretch(ms(b.start),ms(b.end),minutesOf(b),if(share>=LOGGED_SHARE) "logged" else if(share>0) "mixed" else "estimated",unlogged)
        }
        val wakeList=wakes.map { toWake(it,heard) }; val edges=listOfNotNull(before,after).map { toWake(it,heard) }
        val logged=wakeList+edges
        val cries=heard.map { cry -> cry.copy(withWake=logged.any { cry.end.toEpochMilli()>=it.start.toEpochMilli()-HEARD_MATCH_MINUTES*MIN && cry.start.toEpochMilli()<=it.resumed.toEpochMilli()+HEARD_MATCH_MINUTES*MIN }) }
        return empty.copy(sleeps=sleeps,wakes=wakeList,edges=edges,sleepMinutes=sleeps.sumOf { it.minutes },longestStretchMinutes=sleeps.maxOfOrNull { it.minutes } ?: 0,
            estimated=sleeps.any { it.source!="logged" },heard=cries)
    }

    /** The 12 hours after a night: naps as logged, its entries, and room to log a nap. */
    fun day(events: List<CareEvent>,nightKey: String,nursery: NurseryData?,now: Instant=Dates.now()): Day {
        val nowMs=now.toEpochMilli()
        val span=Span(night(events,nightKey,null,now).end.toEpochMilli(),night(events,shiftNightKey(nightKey,1),null,now).start.toEpochMilli())
        val until=min(span.end,nowMs); val inProgress=nowMs>=span.start && nowMs<span.end; val minStretch=MIN_STRETCH_MINUTES*MIN
        val naps=sleepSpans(events,nowMs).map { Span(max(it.start,span.start),min(it.end,until)) }.filter { it.end>it.start }
        val entries=events.filter { it.type in WAKE_TYPES || it.type==EventType.MOOD || it.type==EventType.TUMMYTIME || it.type==EventType.BATH }
            .map { Triple(it.start.toEpochMilli(),entryEnd(it),it.type!!) }.filter { it.first>=span.start && it.first<until }.sortedBy { it.first }
        val busy=entries.map { Span(it.first,it.second+SETTLE_MINUTES*MIN) }+naps
        val openings=if(until>span.start) subtract(Span(span.start,until),busy) else emptyList()
        val heard=if(until>span.start) heardCries(nursery,Span(span.start,until)) else emptyList()
        val stretches=naps.map { Stretch(ms(it.start),ms(it.end),minutesOf(it),"logged",emptyList()) }
        val match=HEARD_MATCH_MINUTES*MIN
        return Day(shiftNightKey(nightKey,1),ms(span.start),ms(span.end),nowMs<span.start,inProgress,stretches,entries.map { Item(ms(it.first),it.third) },
            openings.filter { it.end-it.start>=minStretch }.map { Unlogged(ms(it.start),if(inProgress && it.end>=until) null else ms(it.end)) },
            stretches.sumOf { it.minutes },stretches.maxOfOrNull { it.minutes } ?: 0,
            heard.map { c -> c.copy(withWake=entries.any { c.end.toEpochMilli()>=it.first-match && c.start.toEpochMilli()<=it.second+match }) })
    }

    private fun stat(values: List<Double>)=if(values.isEmpty()) null else Stat(values.average(),values.max(),values.min())

    fun lastFinishedNightKey(events: List<CareEvent>,now: Instant=Dates.now()): String {
        val current=currentNightKey(now)
        return if(night(events,current,null,now).inProgress) shiftNightKey(current,-1) else current
    }

    fun recentNightsRange(events: List<CareEvent>,count: Int,now: Instant=Dates.now()): DateRange {
        val to=lastFinishedNightKey(events,now)
        return DateRange(shiftNightKey(to,(1-count).toLong()),to)
    }

    fun report(events: List<CareEvent>,nursery: NurseryData?,range: DateRange,now: Instant=Dates.now()): Report {
        val lastFinished=lastFinishedNightKey(events,now)
        val earliest=events.minByOrNull { it.start }?.start
        val n=range.normalized()
        val from=n.from.ifEmpty { earliest?.let { shiftNightKey(Dates.key(it),-1) } ?: lastFinished }
        val to=if(n.to.isNotEmpty() && n.to<lastFinished) n.to else lastFinished
        val keys=ArrayList<String>(); var k=from
        while(k<=to) { keys.add(k); k=shiftNightKey(k,1) }
        val sorted=events.sortedBy { it.start }
        val nights=keys.map { key -> val w=window(key)
            getNearby(sorted,w.start-MAX_SLEEP_MINUTES*MIN,w.end+MAX_SLEEP_MINUTES*MIN).let { night(it,key,nursery,now) } }.filter { it.tracked && !it.inProgress }
        val spans=sleepSpans(events,now.toEpochMilli())
        val naps=keys.map { key -> Math.round(overlap(Span(window(shiftNightKey(key,-1)).end,window(key).start),spans).toDouble()/MIN) }.filter { it>0 }
        return Report(nights,keys.size,stat(nights.map { it.sleepMinutes.toDouble() }),stat(nights.map { it.wakes.size.toDouble() }),
            stat(nights.map { it.longestStretchMinutes.toDouble() }),stat(naps.map { it.toDouble() }),nights.count { it.estimated })
    }

    private fun getNearby(sorted: List<CareEvent>,from: Long,to: Long): List<CareEvent> {
        var lo=0; var hi=sorted.size
        while(lo<hi) { val mid=(lo+hi)/2; if(sorted[mid].start.toEpochMilli()<from) lo=mid+1 else hi=mid }
        val out=ArrayList<CareEvent>()
        var i=lo
        while(i<sorted.size && sorted[i].start.toEpochMilli()<to) { out.add(sorted[i]); i++ }
        return out
    }
}

/** `domain/cryContext.ts`: what the log says around a bout of crying — facts with a nudge, never a cause. */
object CryContext {
    data class Clue(val at: Instant,val minutesBefore: Long,val usualMinutes: Long?,val due: Boolean)
    data class Context(val feed: Clue?,val change: Clue?,val awakeMinutes: Long?,val duringSleep: Boolean,val recentCare: List<Pair<Instant,EventType>>)
    data class Phrase(val text: String,val due: Boolean)
    const val CRYING_MOOD_LEVEL=4
    private const val MIN=60_000L

    private fun median(v: List<Double>): Double { val s=v.sorted(); val m=s.size/2; return if(s.size%2==1) s[m] else (s[m-1]+s[m])/2 }

    private fun clue(events: List<CareEvent>,type: EventType,at: Long): Clue? {
        val times=events.filter { it.type==type }.map { it.start.toEpochMilli() }.filter { it<=at }.sorted()
        val last=times.lastOrNull() ?: return null
        val gaps=times.zipWithNext { a,b -> (b-a).toDouble()/MIN }.filter { it>0 && it<=360 }.takeLast(10)
        val usual=if(gaps.size>=4) Math.round(median(gaps)) else null
        val before=Math.round((at-last).toDouble()/MIN)
        return Clue(Instant.ofEpochMilli(last),before,usual,usual!=null && before>=usual)
    }

    fun context(events: List<CareEvent>,start: Instant): Context {
        val at=start.toEpochMilli()
        val sleeps=events.filter { it.type==EventType.SLEEP && it.start.toEpochMilli()<=at }.map { it.start.toEpochMilli() to (it.end?.toEpochMilli() ?: Long.MAX_VALUE) }
        val during=sleeps.any { it.second>at }
        val lastWoke=sleeps.filter { it.second<=at }.maxOfOrNull { it.second } ?: Long.MIN_VALUE
        val awake=if(!during && lastWoke!=Long.MIN_VALUE && at-lastWoke<=720*MIN) Math.round((at-lastWoke).toDouble()/MIN) else null
        val since=at-6*60*MIN
        return Context(clue(events,EventType.FEED,at),clue(events,EventType.DIAPER,at),awake,during,
            events.filter { (it.type==EventType.MEDICATION || it.type==EventType.TEMPERATURE) && it.start.toEpochMilli() in since..at }.map { it.start to it.type!! }.sortedBy { it.first })
    }

    fun describe(c: Context): List<Phrase> {
        fun clue(verb: String,item: Clue?)=item?.let { Phrase("$verb ${Dates.duration(it.minutesBefore)} before"+(it.usualMinutes?.let { u -> " (usually ${Dates.duration(u)})" } ?: ""),it.due) }
        val out=listOfNotNull(clue("fed",c.feed),clue("changed",c.change)).toMutableList()
        if(c.duringSleep) out.add(Phrase("during a logged sleep",false)) else c.awakeMinutes?.let { out.add(Phrase("awake ${Dates.duration(it)}",false)) }
        for(type in c.recentCare.map { it.second }.distinct()) out.add(Phrase(if(type==EventType.TEMPERATURE) "temperature taken in the 6h before" else "medicine logged in the 6h before",false))
        return out.sortedByDescending { it.due }
    }

    fun isMarked(cry: BabyNights.Cry,events: List<CareEvent>)=events.any { it.type==EventType.MOOD && it.level>=CRYING_MOOD_LEVEL &&
        it.start.toEpochMilli()>=cry.start.toEpochMilli()-5*MIN && it.start.toEpochMilli()<=cry.end.toEpochMilli()+5*MIN }

    /** The mood entry a bout becomes, its note saying where it came from. */
    fun toMoodNote(cry: BabyNights.Cry,events: List<CareEvent>): String {
        val clues=describe(context(events,cry.start)).map { it.text }
        return "Crying heard by the nursery sensor, ${Dates.clock(cry.start)}–${Dates.clock(cry.end)}"+if(clues.isNotEmpty()) " · ${clues.joinToString("; ")}" else ""
    }
}

/** `domain/feedClock.ts`: when feeds happen across the day, and how long they run then. */
object FeedClock {
    data class Band(val startHour: Int,val label: String,val shortLabel: String,val feeds: Int,val timed: Int,val feedsPerDay: Double?,val averageMinutes: Double?,val minMinutes: Double?,val maxMinutes: Double?)
    data class Report(val bandHours: Int,val bands: List<Band>,val busiest: Band?,val longest: Band?,val shortest: Band?,val days: Int,val feeds: Int,val timed: Int,val averageMinutes: Double?)

    private fun meridiem(h: Int)=if(h%24<12) "a" else "p"
    private fun clockHour(h: Int)=(h%12).let { if(it==0) 12 else it }
    private fun hour(h: Int)="${clockHour(h)}${meridiem(h)}"
    private fun label(s: Int,e: Int)=if(meridiem(s)==meridiem(e)) "${clockHour(s)}–${hour(e)}" else "${hour(s)}–${hour(e)}"

    fun report(events: List<CareEvent>,bandHours: Int=3,now: Instant=Dates.now()): Report {
        val feeds=events.filter { it.type==EventType.FEED }
        val keys=feeds.map { Dates.key(it.start) }.toSet()
        val count=24/bandHours
        val lengths=List(count) { ArrayList<Double>() }; val counts=IntArray(count)
        for(f in feeds) {
            val i=f.start.atZone(Dates.zone).hour/bandHours; counts[i]++
            val m=Summary.durationMinutes(f).toDouble(); if(m>0 && m<=240) lengths[i].add(m)
        }
        val today=Dates.key(now); val local=now.atZone(Dates.zone); val elapsed=local.hour+local.minute/60.0
        val bands=(0 until count).map { i -> val start=i*bandHours; val l=lengths[i]
            val observed=keys.sumOf { k -> if(k<today) 1.0 else if(k>today) 0.0 else ((elapsed-start)/bandHours).coerceIn(0.0,1.0) }
            Band(start,label(start,start+bandHours),hour(start),counts[i],l.size,if(observed>=0.25) counts[i]/observed else null,l.takeIf { it.isNotEmpty() }?.average(),l.minOrNull(),l.maxOrNull())
        }
        val rankable=bands.filter { it.timed>=3 }
        val all=lengths.flatten()
        return Report(bandHours,bands,bands.filter { it.feeds>0 }.fold(null as Band?) { b,x -> if(b==null || x.feeds>b.feeds) x else b },
            rankable.fold(null as Band?) { b,x -> if(b==null || x.averageMinutes!!>b.averageMinutes!!) x else b },
            rankable.fold(null as Band?) { b,x -> if(b==null || x.averageMinutes!!<b.averageMinutes!!) x else b },
            keys.size,feeds.size,all.size,all.takeIf { it.isNotEmpty() }?.average())
    }
}

/** `domain/feedOrder.ts`: when the first feed of the day lands, then the second, and so on. */
object FeedOrder {
    const val DAY_START_HOUR=5
    const val MIN_FEEDS=9
    const val MAX_FEEDS=11
    data class Slot(val index: Int,val averageOffset: Double,val earliestOffset: Double,val latestOffset: Double,val averageGapMinutes: Double?,val days: Int,val typical: Boolean)
    data class Report(val days: Int,val feedsPerDay: Double,val loggedDays: Int,val slots: List<Slot>,val typicalCount: Int) { val dayStartMinutes=DAY_START_HOUR*60 }

    fun clockMinutes(offset: Double)=(offset+DAY_START_HOUR*60)%1440

    fun report(events: List<CareEvent>): Report {
        val feeds=events.filter { it.type==EventType.FEED }.sortedBy { it.start }
        val byDay=LinkedHashMap<String,MutableList<CareEvent>>()
        for(f in feeds) { val local=f.start.atZone(Dates.zone); val key=(if(local.hour<DAY_START_HOUR) local.toLocalDate().minusDays(1) else local.toLocalDate()).toString()
            byDay.getOrPut(key) { ArrayList() }.add(f) }
        val counted=byDay.values.filter { it.size in MIN_FEEDS..MAX_FEEDS }
        val offsets=ArrayList<MutableList<Double>>(); val gaps=ArrayList<MutableList<Double>>()
        for(day in counted) day.forEachIndexed { i,f ->
            while(offsets.size<=i) { offsets.add(ArrayList()); gaps.add(ArrayList()) }
            val local=f.start.atZone(Dates.zone)
            offsets[i].add(((local.hour*60+local.minute-DAY_START_HOUR*60+1440)%1440).toDouble())
            if(i>0) gaps[i].add((f.start.toEpochMilli()-day[i-1].start.toEpochMilli())/60_000.0)
        }
        val slots=offsets.mapIndexed { i,o -> Slot(i+1,o.average(),o.min(),o.max(),gaps[i].takeIf { it.isNotEmpty() }?.average(),o.size,o.size>=3) }
        val sparse=slots.indexOfFirst { !it.typical }
        return Report(counted.size,if(counted.isEmpty()) 0.0 else counted.sumOf { it.size }.toDouble()/counted.size,byDay.size,slots,if(sparse==-1) slots.size else sparse)
    }
}
