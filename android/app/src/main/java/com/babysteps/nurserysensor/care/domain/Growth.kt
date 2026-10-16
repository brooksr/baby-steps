package com.babysteps.nurserysensor.care.domain

import com.babysteps.nurserysensor.care.model.CareEvent
import com.babysteps.nurserysensor.care.model.EventType
import com.babysteps.nurserysensor.care.model.Profile
import com.babysteps.nurserysensor.care.model.parseInstant
import java.time.Instant
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** `domain/growth`: WHO standards, gestation and corrected age, and the newborn daily check. */
object Growth {
    const val TERM_DAYS=280
    private const val DAY=86_400_000.0
    private const val DAYS_PER_MONTH=365.25/12
    const val OZ_TO_KG=0.0283495
    const val IN_TO_CM=2.54

    enum class Metric(val key: String) { WEIGHT("weight"), LENGTH("length"), HEAD("head") }
    data class Point(val month: Double,val p2: Double,val median: Double,val p98: Double)
    data class Standard(val metric: Metric,val label: String,val unit: String,val points: List<Point>)

    fun standardSex(gender: String?)=if(gender=="girl") "girls" else "boys"

    /** Boys' tables unless a girl: WHO publishes nothing in between, and the card says so. */
    fun standards(gender: String?): Map<Metric,Standard> {
        val sex=standardSex(gender)
        fun load(metric: Metric,file: String,label: String,unit: String)=Standard(metric,label,unit,Csv.parse(Reference.text("$file-$sex.csv")).second.map {
            Point(it[0].toDouble(),it[1].toDouble(),it[2].toDouble(),it[3].toDouble()) })
        return mapOf(Metric.LENGTH to load(Metric.LENGTH,"length-for-age","Length-for-age","cm"),
            Metric.WEIGHT to load(Metric.WEIGHT,"weight-for-age","Weight-for-age","kg"),
            Metric.HEAD to load(Metric.HEAD,"head-circumference-for-age","Head circumference-for-age","cm"))
    }

    data class Gestation(val gestationalAgeDays: Int,val correctionDays: Int,val label: String,val preterm: Boolean,val latePreterm: Boolean)

    fun gestation(profile: Profile): Gestation? {
        val birth=profile.birthDate ?: return null; val due=profile.dueDate ?: return null
        val early=((Dates.noon(Dates.key(due)).toEpochMilli()-Dates.noon(Dates.key(birth)).toEpochMilli())/DAY).roundToInt()
        val ga=TERM_DAYS-early
        return Gestation(ga,max(0,early),"${Math.floorDiv(ga,7)}w${Math.floorMod(ga,7)}d",ga<37*7,ga>=34*7 && ga<37*7)
    }

    data class Bounds(val p2: Double,val median: Double,val p98: Double)
    data class Assessment(val metric: Metric,val label: String,val unit: String,val ageMonths: Double,val value: Double,val band: String,val percentile: Int,val standard: Bounds,val summary: String)

    fun interpolate(standard: Standard,ageMonths: Double): Bounds {
        val pts=standard.points
        val a=ageMonths.coerceIn(pts.first().month,pts.last().month)
        var lo=pts.first(); var hi=pts.last()
        for(i in 0 until pts.size-1) if(a>=pts[i].month && a<=pts[i+1].month) { lo=pts[i]; hi=pts[i+1]; break }
        if(lo.month==hi.month) return Bounds(lo.p2,lo.median,lo.p98)
        val r=(a-lo.month)/(hi.month-lo.month)
        fun mix(x: Double,y: Double)=x+(y-x)*r
        return Bounds(mix(lo.p2,hi.p2),mix(lo.median,hi.median),mix(lo.p98,hi.p98))
    }

    private fun normalCdf(z: Double): Double {
        val sign=if(z<0) -1 else 1; val x=abs(z)/sqrt(2.0); val t=1/(1+0.3275911*x)
        val erf=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*exp(-x*x)
        return (1+sign*erf)/2
    }

    private fun percentile(value: Double,b: Bounds): Int {
        val half=if(value<b.median) b.median-b.p2 else b.p98-b.median
        val z=if(half==0.0) 0.0 else (value-b.median)/half*2
        return (normalCdf(z)*100).roundToInt().coerceIn(1,99)
    }

    private fun describe(band: String,value: Double,b: Bounds): String = when(band) {
        "below" -> "A bit below the expected range (under the WHO -2 SD line). One reading is just a snapshot — jot it down to review at the next visit."
        "above" -> "A bit above the expected range (over the WHO +2 SD line). One reading is just a snapshot — jot it down to review at the next visit."
        else -> { val span=(b.p98-b.median).takeIf { it!=0.0 } ?: 1.0; val delta=(value-b.median)/span
            if(abs(delta)<=0.2) "On track — right around the median." else if(delta<0) "On track — below the median but within the normal range." else "On track — above the median but within the normal range." }
    }

    fun classify(metric: Metric,ageMonths: Double,value: Double,standards: Map<Metric,Standard>): Assessment {
        val s=standards.getValue(metric); val b=interpolate(s,ageMonths)
        val band=if(value<b.p2) "below" else if(value>b.p98) "above" else "within"
        return Assessment(metric,s.label,s.unit,ageMonths,value,band,percentile(value,b),b,describe(band,value,b))
    }

    data class Measurement(val dateKey: String,val ageDays: Int,val ageMonths: Double,val correctedAgeMonths: Double,val lengthCm: Double?,val weightKg: Double?,val headCm: Double?)

    fun measurements(profile: Profile,events: List<CareEvent>): List<Measurement> {
        val birthDate=profile.birthDate ?: return emptyList()
        val correction=gestation(profile)?.correctionDays ?: 0
        val birth=Dates.noon(Dates.key(birthDate)).toEpochMilli()
        return events.filter { (it.type==EventType.GROWTH || it.type==EventType.BIRTH) && (it.weightOz!=null || it.lengthIn!=null || it.headCircumferenceIn!=null) }
            .map { e ->
                val ageDays=max(0,floor((e.start.toEpochMilli()-birth)/DAY).toInt())
                Measurement(Dates.key(e.start),ageDays,ageDays/DAYS_PER_MONTH,max(0.0,(ageDays-correction)/DAYS_PER_MONTH),
                    e.lengthIn?.let { it*IN_TO_CM },e.weightOz?.let { it*OZ_TO_KG },e.headCircumferenceIn?.let { it*IN_TO_CM })
            }.sortedBy { it.ageDays }
    }

    data class Plot(val ageMonths: Double,val correctedAgeMonths: Double,val value: Double)
    fun plots(measurements: List<Measurement>,metric: Metric)=measurements.mapNotNull { m ->
        when(metric) { Metric.LENGTH -> m.lengthCm; Metric.WEIGHT -> m.weightKg; Metric.HEAD -> m.headCm }?.let { Plot(m.ageMonths,m.correctedAgeMonths,it) }
    }

    fun assessLatest(profile: Profile,events: List<CareEvent>,corrected: Boolean): List<Assessment> {
        val ms=measurements(profile,events); val st=standards(profile.gender)
        return listOf(Metric.WEIGHT,Metric.LENGTH,Metric.HEAD).mapNotNull { metric ->
            plots(ms,metric).lastOrNull()?.let { classify(metric,if(corrected) it.correctedAgeMonths else it.ageMonths,it.value,st) }
        }
    }

    // ── Newborn daily check ─────────────────────────────────────────────────────

    data class Expectation(val dayOfLife: Int,val wetMin: Int,val stoolMin: Int,val feedMin: Int,val feedMax: Int,val note: String)
    private val EXPECTATIONS=listOf(
        Expectation(1,1,1,3,12,"First day: ≥1 wet, ≥1 meconium (black, tarry) stool. Feeds may be sleepy."),
        Expectation(2,2,1,8,12,"Aim for 8–12 feeds/24h; still passing meconium."),
        Expectation(3,3,2,8,12,"Milk coming in; stools turning green/brown (transitional)."),
        Expectation(4,4,3,8,12,"Stools becoming yellow; output increasing."),
        Expectation(5,5,3,8,12,"Expect yellow, seedy stools and heavier wet diapers."),
        Expectation(6,6,3,8,12,"6+ wet and 3+ yellow stools per day is reassuring."))
    const val NEWBORN_WINDOW_DAYS=28

    fun expectation(dayOfLife: Int): Expectation? {
        if(dayOfLife<1 || dayOfLife>NEWBORN_WINDOW_DAYS) return null
        val base=EXPECTATIONS[min(dayOfLife,EXPECTATIONS.size)-1]
        return if(dayOfLife>EXPECTATIONS.size) base.copy(dayOfLife=dayOfLife,note="Steady state: expect 6+ wet and 3+ stools per day, 8–12 feeds.") else base.copy(dayOfLife=dayOfLife)
    }

    data class Check(val label: String,val count: Int,val expectedMin: Int,val expectedByNow: Int,val status: String)
    data class NewbornDay(val dayOfLife: Int,val expectation: Expectation,val checks: List<Check>,val onTrack: Boolean,val dayComplete: Boolean,val dayProgress: Double,val stillCounting: Boolean)

    fun dayOfLife(birthDate: String,dateKey: String)=floor((Dates.midnight(dateKey).toEpochMilli()-Dates.midnight(Dates.key(birthDate)).toEpochMilli())/DAY).toInt()+1

    /** The birth day starts at the birth itself, so a baby born at 6pm is not measured against a whole day. */
    fun dayProgress(birthDate: String,dateKey: String,now: Instant): Double {
        val start=Dates.midnight(dateKey).toEpochMilli(); val end=Dates.midnight(Dates.addDays(dateKey,1)).toEpochMilli(); val cur=now.toEpochMilli()
        if(cur>=end) return 1.0
        val birth=if(birthDate.length>10) parseInstant(birthDate)?.toEpochMilli() else null
        val from=if(birth!=null) max(start,birth) else start
        if(cur<=from) return 0.0
        return min(1.0,(cur-from).toDouble()/(end-from))
    }

    fun assessNewbornDay(profile: Profile,events: List<CareEvent>,dateKey: String,now: Instant=Dates.now()): NewbornDay? {
        val birth=profile.birthDate ?: return null
        val day=dayOfLife(birth,dateKey); val exp=expectation(day) ?: return null
        val onDay=events.filter { Dates.key(it.start)==dateKey }
        val feeds=onDay.count { it.type==EventType.FEED }; val wet=onDay.count { it.coversWet }; val stool=onDay.count { it.coversDirty }
        val progress=dayProgress(birth,dateKey,now)
        fun check(label: String,count: Int,min: Int): Check {
            val byNow=if(progress>=1) min else floor(min*progress).toInt()
            return Check(label,count,min,byNow,if(count>=min) "within" else if(count>=byNow) "pending" else "below")
        }
        val checks=listOf(check("Wet diapers",wet,exp.wetMin),check("Stools",stool,exp.stoolMin),check("Feeds",feeds,exp.feedMin))
        return NewbornDay(day,exp,checks,checks.none { it.status=="below" },progress>=1,progress,checks.any { it.status=="pending" })
    }
}

/** `domain/firstYear.ts`. */
object FirstYear {
    data class Point(val dateKey: String,var dayNumber: Int,var feeds: Int=0,var diapers: Int=0,var wetDiapers: Int=0,var dirtyDiapers: Int=0,var dirtyLarge: Int=0,
        var dirtyMedium: Int=0,var dirtySmall: Int=0,var poopLoad: Double=0.0,var sleepMinutes: Long=0,var bottleOunces: Double=0.0,var pumpOunces: Double=0.0,var weightOz: Double?=null)
    data class Stats(val average: Double,val max: Double,val min: Double) { companion object { val ZERO=Stats(0.0,0.0,0.0) } }
    data class Analytics(val anchorDate: String,val daysElapsed: Int,val progressPercent: Int,val points: List<Point>,val feeds: Stats,val diapers: Stats,
        val wetDiapers: Stats,val dirtyDiapers: Stats,val sleepHours: Stats,val milkOunces: Stats,val weightOz: Stats,val totalLogs: Int)

    fun anchor(profile: Profile)=Dates.key(profile.birthDate ?: profile.dueDate ?: profile.createdAt)

    fun events(profile: Profile,events: List<CareEvent>): List<CareEvent> {
        val start=Dates.midnight(anchor(profile)).toEpochMilli(); val end=start+365*86_400_000L
        return events.filter { it.start.toEpochMilli() in start until end }
    }

    /** Per-day stats where today counts only as the part of it that has happened. */
    fun dayStats(entries: List<Pair<String,Double>>,now: Instant=Dates.now()): Stats {
        if(entries.isEmpty()) return Stats.ZERO
        val weights=entries.map { Dates.dayFraction(it.first,now) }
        val total=weights.sum()
        val complete=entries.filterIndexed { i,_ -> weights[i]>=1 }.map { it.second }
        val extremes=complete.ifEmpty { entries.map { it.second } }
        return Stats(if(total>0) entries.sumOf { it.second }/total else 0.0,extremes.max(),extremes.min())
    }

    fun analytics(profile: Profile,all: List<CareEvent>,now: Instant=Dates.now()): Analytics {
        val anchor=anchor(profile); val anchorMs=Dates.midnight(anchor).toEpochMilli()
        val map=LinkedHashMap<String,Point>()
        val evs=events(profile,all)
        for(e in evs) {
            val key=Dates.key(e.start)
            val p=map.getOrPut(key) { Point(key,floor((Dates.midnight(key).toEpochMilli()-anchorMs)/86_400_000.0).toInt()+1) }
            when(e.type) {
                EventType.FEED -> { p.feeds++; if(e.method=="bottle") p.bottleOunces+=e.amountOz ?: 0.0 }
                EventType.DIAPER -> {
                    if(e.coversWet) { p.wetDiapers++; p.diapers++ }
                    if(e.coversDirty) { p.dirtyDiapers++; p.diapers++; val size=DiaperDetails.size(e); p.poopLoad+=DiaperDetails.weight(size)
                        when(size) { "large" -> p.dirtyLarge++; "medium" -> p.dirtyMedium++; "small" -> p.dirtySmall++ } }
                }
                EventType.SLEEP -> p.sleepMinutes+=Dates.minutesBetween(e.start,e.end)
                EventType.PUMP -> p.pumpOunces+=e.amountOz ?: 0.0
                EventType.BIRTH, EventType.GROWTH -> e.weightOz?.takeIf { it!=0.0 }?.let { p.weightOz=it }
                else -> {}
            }
        }
        val points=map.values.sortedBy { it.dayNumber }
        val elapsed=if(profile.birthDate!=null) min(365,Dates.ageDays(profile,now)+1) else 0
        fun stat(sel: (Point) -> Double?)=dayStats(points.mapNotNull { p -> sel(p)?.let { p.dateKey to it } },now)
        val weights=points.mapNotNull { it.weightOz }
        return Analytics(anchor,elapsed,(elapsed*100.0/365).roundToInt(),points,
            feeds=stat { if(it.feeds>0) it.feeds.toDouble() else null },
            diapers=stat { if(it.diapers>0) it.diapers.toDouble() else null },
            wetDiapers=stat { if(it.diapers>0) it.wetDiapers.toDouble() else null },
            dirtyDiapers=stat { if(it.diapers>0) it.dirtyDiapers.toDouble() else null },
            sleepHours=stat { if(it.sleepMinutes>0) it.sleepMinutes/60.0 else null },
            milkOunces=stat { (it.bottleOunces+it.pumpOunces).takeIf { v -> v>0 } },
            weightOz=if(weights.isEmpty()) Stats.ZERO else Stats(weights.average(),weights.max(),weights.min()),
            totalLogs=evs.size)
    }
}

/** `domain/dateRange.ts`: an inclusive span of local days; an empty end is open. */
data class DateRange(val from: String="",val to: String="") {
    val active get()=from.isNotEmpty() || to.isNotEmpty()
    fun normalized()=if(from.isNotEmpty() && to.isNotEmpty() && from>to) DateRange(to,from) else this
    fun contains(key: String): Boolean { val n=normalized(); return (n.from.isEmpty() || key>=n.from) && (n.to.isEmpty() || key<=n.to) }
    fun contains(instant: Instant)=contains(Dates.key(instant))
    fun days(): Int? { val n=normalized(); if(n.from.isEmpty() || n.to.isEmpty()) return null
        return java.time.temporal.ChronoUnit.DAYS.between(Dates.date(n.from),Dates.date(n.to)).toInt()+1 }
    fun label(): String {
        val n=normalized()
        return when {
            n.from.isEmpty() && n.to.isEmpty() -> "All time"
            n.from.isEmpty() -> "Through ${Dates.shortDate(n.to)}"
            n.to.isEmpty() -> "${Dates.shortDate(n.from)} onward"
            n.from==n.to -> Dates.shortDate(n.from)
            else -> "${Dates.shortDate(n.from)} – ${Dates.shortDate(n.to)}"
        }
    }

    companion object {
        val ALL=DateRange()
        val PRESETS=listOf("7d" to 7,"30d" to 30,"90d" to 90,"all" to null)
        fun preset(id: String,now: Instant=Dates.now()): DateRange {
            val days=PRESETS.find { it.first==id }?.second ?: return ALL
            return DateRange(Dates.key(now.minusSeconds((days-1)*86_400L)),Dates.key(now))
        }
        fun matchPreset(range: DateRange,now: Instant=Dates.now())=PRESETS.map { it.first }.find { preset(it,now)==range }
    }
}

fun List<CareEvent>.inRange(range: DateRange)=if(!range.active) this else filter { range.contains(it.start) }

/** `domain/checkup.ts`: everything since the last measurement, through today. */
object Checkup {
    data class Anchor(val dateKey: String,val type: EventType,val weightOz: Double?,val lengthIn: Double?,val headIn: Double?)
    data class Span(val anchor: Anchor,val days: Int,val range: DateRange)

    fun span(events: List<CareEvent>,now: Instant=Dates.now()): Span? {
        val today=Dates.key(now)
        val anchor=events.filter { (it.type==EventType.BIRTH || it.type==EventType.GROWTH) && (it.weightOz!=null || it.lengthIn!=null || it.headCircumferenceIn!=null) }
            .map { Anchor(Dates.key(it.start),it.type!!,it.weightOz,it.lengthIn,it.headCircumferenceIn) }
            .filter { it.dateKey<=today }.maxByOrNull { it.dateKey } ?: return null
        val range=DateRange(anchor.dateKey,today)
        return Span(anchor,range.days() ?: 1,range)
    }
}
