package com.babysteps.nurserysensor.care.domain

import com.babysteps.nurserysensor.care.model.CareEvent
import com.babysteps.nurserysensor.care.model.EventType
import com.babysteps.nurserysensor.care.model.Profile
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** `domain/whatToExpect.ts`: the Home card's pregnancy week, or the day / week / month of life. */
object Expect {
    const val COVERAGE_END_DAYS=730
    private const val NEWBORN_STAGE_DAYS=28
    private const val MAX_NOTES=3
    private val AUDIENCE_ORDER=listOf("early-preterm","late-preterm","preterm","boy","girl")
    private const val WAKE_TO_FEED_NOTE="Preterm babies often need waking to feed"
    private const val DAY=86_400_000.0

    fun firstName(profile: Profile)=profile.name.trim().split(Regex("\\s+")).firstOrNull()?.takeIf { it.isNotEmpty() } ?: "your baby"

    fun personalize(text: String,profile: Profile): String {
        val (their,them)=when(profile.gender) { "boy" -> "his" to "him"; "girl" -> "her" to "her"; else -> "their" to "them" }
        val values=mapOf("name" to firstName(profile),"their" to their,"them" to them)
        return Regex("\\{(\\w+)\\}").replace(text) { values[it.groupValues[1]] ?: it.value }
    }

    fun stageAgeDays(ageDays: Int,correctionDays: Int)=max(min(ageDays,NEWBORN_STAGE_DAYS),ageDays-correctionDays)

    sealed interface Outlook
    data class Pregnancy(val daysUntilDue: Int,val gestationDays: Int,val gestationWeeks: Int,val week: Reference.FetalWeek): Outlook
    data class Child(val ageDays: Int,val correctedAgeDays: Int,val beyondCoverage: Boolean,val gestation: Growth.Gestation?,val corrected: Boolean,
        val notes: List<String>,val stage: Reference.AgeStage?,val stageAgeDays: Int): Outlook

    private fun audiences(profile: Profile,g: Growth.Gestation?): List<String> {
        val a=ArrayList<String>()
        if(g?.preterm==true) { a.add("preterm"); a.add(if(g.latePreterm) "late-preterm" else "early-preterm") }
        if(profile.gender=="boy" || profile.gender=="girl") a.add(profile.gender!!)
        return AUDIENCE_ORDER.filter { it in a }
    }

    private fun passedBirthWeight(events: List<CareEvent>,now: Instant): Boolean {
        val birth=events.filter { it.type==EventType.BIRTH && it.weightOz!=null }.minByOrNull { it.start } ?: return false
        return events.any { it.type==EventType.GROWTH && (it.weightOz ?: 0.0)>birth.weightOz!! && it.start.isAfter(birth.start) && !it.start.isAfter(now) }
    }

    private fun stage(profile: Profile,age: Int)=Reference.ageStages.find { age>=it.fromDays && age<=it.toDays }?.let {
        it.copy(development=personalize(it.development,profile),feeding=personalize(it.feeding,profile),headsUp=personalize(it.headsUp,profile),
            sleep=personalize(it.sleep,profile),summary=personalize(it.summary,profile),facts=it.facts)
    }

    fun outlook(profile: Profile,now: Instant=Dates.now(),events: List<CareEvent> = emptyList()): Outlook? {
        val birthDate=profile.birthDate
        if(birthDate==null) {
            val due=profile.dueDate ?: return null
            val days=ceil((Dates.noon(Dates.key(due)).toEpochMilli()-now.toEpochMilli())/DAY).toInt()
            val gd=Growth.TERM_DAYS-days; val gw=Math.floorDiv(gd,7)
            val weeks=Reference.fetalWeeks
            if(weeks.isEmpty() || gw<weeks.first().week) return null
            return Pregnancy(days,gd,gw,weeks.lastOrNull { it.week<=gw } ?: weeks.last())
        }
        val ageDays=max(0,floor((now.toEpochMilli()-Dates.noon(Dates.key(birthDate)).toEpochMilli())/DAY).toInt())
        val g=Growth.gestation(profile)
        val stageAge=stageAgeDays(ageDays,g?.correctionDays ?: 0)
        val aud=audiences(profile,g); val passed=passedBirthWeight(events,now)
        val notes=Reference.expectationNotes.filter { it.audience in aud && ageDays>=it.fromDays && ageDays<=it.toDays }
            .filter { !passed || !it.note.startsWith(WAKE_TO_FEED_NOTE) }.sortedBy { aud.indexOf(it.audience) }.take(MAX_NOTES).map { personalize(it.note,profile) }
        return Child(ageDays,ageDays-(g?.correctionDays ?: 0),stageAge>COVERAGE_END_DAYS,g,stageAge!=ageDays,notes,stage(profile,stageAge),stageAge)
    }

    /** Lands on the adjacent written band rather than stepping day by day. */
    fun adjacent(profile: Profile,events: List<CareEvent>,outlook: Outlook,at: Instant,direction: Int): Instant? {
        fun plus(days: Int)=at.plus(days.toLong(),ChronoUnit.DAYS)
        when(outlook) {
            is Pregnancy -> { val weeks=Reference.fetalWeeks
                val boundary=(if(direction<0) weeks.firstOrNull() else weeks.lastOrNull())?.week ?: return null
                return if(if(direction<0) outlook.week.week<=boundary else outlook.week.week>=boundary) null else plus(direction*7) }
            is Child -> {
                val stage=outlook.stage ?: return if(direction<0) plus(COVERAGE_END_DAYS-outlook.stageAgeDays) else null
                val target=if(direction<0) stage.fromDays-1 else stage.toDays+1
                if(target<0) return null
                var candidate=plus(target-outlook.stageAgeDays)
                repeat(COVERAGE_END_DAYS+1) {
                    val next=outlook(profile,candidate,events)
                    if(next is Child && next.stage?.label!=stage.label) return candidate
                    candidate=candidate.plus(direction.toLong(),ChronoUnit.DAYS)
                }
                return null
            }
        }
    }
}

/** `domain/cycle.ts`: periods regrouped from logged days, and an estimate of the next one. */
object Cycle {
    data class Period(val startKey: String,var endKey: String,var days: Int,val flows: MutableList<String>,var cycleLengthDays: Int?=null,var counted: Boolean=false)
    data class Stats(val periods: List<Period>,val averageCycleDays: Int?,val shortest: Int?,val longest: Int?,val spread: Int?,val averagePeriodDays: Double?,val counted: Int,val dropped: Int)
    data class Prediction(val nextPeriodKey: String,val windowStartKey: String,val windowEndKey: String,val ovulationKey: String,val fertileStartKey: String,val fertileEndKey: String,val confidence: String,val basis: String)
    data class Today(val status: String,val dayOfCycle: Int?,val phase: String?,val daysUntilNextPeriod: Int?,val prediction: Prediction?,val stats: Stats,val daysSinceBirth: Int?,val daysUntilDue: Int?)
    data class Context(val lastBirthKey: String?,val expectingDueKey: String?)

    val PHASE_LABELS=mapOf("fertile" to "Fertile window","follicular" to "Follicular","luteal" to "Luteal","ovulation" to "Ovulation day","period" to "Period")
    private val RANK=mapOf("spotting" to 0,"light" to 1,"medium" to 2,"heavy" to 3)

    private fun between(a: String,b: String)=ChronoUnit.DAYS.between(Dates.date(a),Dates.date(b)).toInt()

    fun context(profiles: List<Profile>): Context {
        val children=profiles.filter { it.isChild }
        val births=children.mapNotNull { it.birthDate?.let(Dates::key) }.sorted()
        val expecting=children.filter { it.birthDate==null && it.dueDate!=null }.map { Dates.key(it.dueDate!!) }.sorted()
        return Context(births.lastOrNull(),expecting.firstOrNull())
    }

    fun periods(events: List<CareEvent>,sinceKey: String?=null): List<Period> {
        val byDay=sortedMapOf<String,String>()
        for(e in events) if(e.type==EventType.MENSES) { val k=Dates.key(e.start); val cur=byDay[k]
            if(cur==null || (RANK[e.flow] ?: 2)>(RANK[cur] ?: 2)) byDay[k]=e.flow }
        val out=ArrayList<Period>()
        for((k,flow) in byDay) {
            if(sinceKey!=null && k<sinceKey) continue
            val cur=out.lastOrNull()
            if(cur!=null && between(cur.endKey,k)<=2) { cur.endKey=k; cur.days=between(cur.startKey,k)+1; cur.flows.add(flow) }
            else out.add(Period(k,k,1,mutableListOf(flow)))
        }
        out.forEachIndexed { i,p -> out.getOrNull(i+1)?.let { next -> val len=between(p.startKey,next.startKey); p.cycleLengthDays=len; p.counted=len in 21..60 } }
        return out
    }

    fun stats(events: List<CareEvent>,sinceKey: String?=null): Stats {
        val ps=periods(events,sinceKey)
        val recent=ps.filter { it.counted }.map { it.cycleLengthDays!! }.takeLast(6)
        val finished=ps.dropLast(1)
        return Stats(ps,if(recent.isEmpty()) null else Math.round(recent.average()).toInt(),recent.minOrNull(),recent.maxOrNull(),
            if(recent.isEmpty()) null else recent.max()-recent.min(),if(finished.isEmpty()) null else Math.round(finished.map { it.days }.average()*10)/10.0,
            recent.size,ps.count { it.cycleLengthDays!=null && !it.counted })
    }

    fun predict(stats: Stats): Prediction? {
        val last=stats.periods.lastOrNull() ?: return null
        val avg=stats.averageCycleDays ?: return null
        if(stats.counted<2) return null
        val next=Dates.addDays(last.startKey,avg.toLong()); val ov=Dates.addDays(next,-14)
        val spread=stats.spread ?: 0
        val confidence=if(stats.counted<3 || spread>7) "low" else if(spread<=3) "high" else "medium"
        return Prediction(next,Dates.addDays(last.startKey,min(stats.shortest ?: avg,avg-1).toLong()),Dates.addDays(last.startKey,max(stats.longest ?: avg,avg+1).toLong()),
            ov,Dates.addDays(ov,-5),Dates.addDays(ov,1),confidence,"${stats.counted} cycle${if(stats.counted==1) "" else "s"}, averaging $avg days")
    }

    fun today(events: List<CareEvent>,now: Instant=Dates.now(),ctx: Context=Context(null,null)): Today? {
        val today=Dates.key(now)
        val st=stats(events,ctx.lastBirthKey)
        val sinceBirth=ctx.lastBirthKey?.let { between(it,today) }; val untilDue=ctx.expectingDueKey?.let { between(today,it) }
        if(ctx.expectingDueKey!=null) return Today("pregnant",null,null,null,null,st,sinceBirth,untilDue)
        val last=st.periods.lastOrNull() ?: return if(ctx.lastBirthKey!=null) Today("postpartum",null,null,null,null,st,sinceBirth,untilDue) else null
        val p=predict(st)
        val bleeding=today>=last.startKey && today<=last.endKey
        val phase=when {
            bleeding -> "period"
            p==null -> "follicular"
            today==p.ovulationKey -> "ovulation"
            today>=p.fertileStartKey && today<=p.fertileEndKey -> "fertile"
            today<p.fertileStartKey -> "follicular"
            else -> "luteal"
        }
        return Today("cycling",max(1,between(last.startKey,today)+1),phase,p?.let { between(today,it.nextPeriodKey) },p,st,sinceBirth,untilDue)
    }

    /** The tile's headline and detail. */
    fun describe(c: Today): Pair<String,String> = when(c.status) {
        "pregnant" -> "Expecting" to (c.daysUntilDue?.let { if(it>=0) "${ceil(it/7.0).toInt()} weeks to go" else "${-it} days past the due date" } ?: "Cycle paused")
        "postpartum" -> { val d=c.daysSinceBirth ?: 0; "No period yet" to (if(d<14) "$d day${if(d==1) "" else "s"} since the birth" else "${d/7} weeks since the birth") }
        else -> (c.dayOfCycle?.toString() ?: "—") to (c.phase?.let { PHASE_LABELS[it] } ?: "")
    }
}

/** `domain/intakeOutput.ts`: a parent's inputs and outputs, and how comparable the rows are. */
object IntakeOutput {
    val OUTPUT_KINDS=listOf("pee","poo","fart","burp","vomit","reflux","bloating","cramp")
    const val CAFFEINE_TAG="caffeine"
    const val LINK_WINDOW_HOURS=24

    data class Summary(val intakes: Int,val foods: Int,val drinks: Int,val fluidOz: Double,val outputs: Int,val byKind: Map<String,Int>,val daysLogged: Int,val tagged: Int,val rated: Int,val linked: Int)

    fun summary(events: List<CareEvent>): Summary {
        val intakes=events.filter { it.type==EventType.INTAKE }; val outputs=events.filter { it.type==EventType.OUTPUT }
        val times=intakes.map { it.start.toEpochMilli() }.sorted(); val window=LINK_WINDOW_HOURS*3_600_000L
        return Summary(intakes.size,intakes.count { it.kind!="drink" },intakes.count { it.kind=="drink" },
            Math.round(intakes.filter { it.kind=="drink" }.sumOf { it.amountOz ?: 0.0 }*10)/10.0,outputs.size,
            OUTPUT_KINDS.associateWith { k -> outputs.count { it.kind==k } },(intakes+outputs).map { Dates.key(it.start) }.toSet().size,
            intakes.count { it.tags.isNotEmpty() },outputs.count { it.severity!=null },
            outputs.count { o -> val at=o.start.toEpochMilli(); times.any { it<=at && at-it<=window } })
    }

    fun topTags(events: List<CareEvent>,limit: Int=6)=events.filter { it.type==EventType.INTAKE }.flatMap { it.tags }.groupingBy { it }.eachCount()
        .entries.sortedWith(compareByDescending<Map.Entry<String,Int>> { it.value }.thenBy { it.key }).take(limit).map { it.key to it.value }
}

/** `domain/parentReport.ts`: a parent's nights, net of the wake-ups recorded against them. */
object ParentReport {
    data class Night(val dateKey: String,var sleepMinutes: Long=0,var inBedMinutes: Long=0,var longestStretchMinutes: Long=0,var sessions: Int=0,var interruptions: Int=0)
    data class Counts(var total: Int=0,var feeds: Int=0,var nursingFeeds: Int=0,var diapers: Int=0,var pumps: Int=0,var nightEvents: Int=0)
    data class Report(val nights: List<Night>,val averageSleep: Long?,val averageInBed: Long?,val averageLongest: Long?,val bestStretch: Long?,
        val averageInterruptions: Double?,val totalSleep: Long,val care: Counts,val mine: Counts,val unattributed: Int)
    data class Rest(val inBed: Long,val rest: Long,val longest: Long,val wakeups: Int)

    private val CARE_TYPES=setOf(EventType.FEED,EventType.DIAPER,EventType.PUMP,EventType.BATH)
    private const val MIN=60_000L

    fun nightKey(at: Instant): String { val local=at.atZone(Dates.zone); return if(local.hour<10) Dates.key(at.minus(1,ChronoUnit.DAYS)) else Dates.key(at) }
    private fun nightDuty(at: Instant)=at.atZone(Dates.zone).hour.let { it>=22 || it<6 }

    fun rest(start: Instant,end: Instant,baby: List<CareEvent>,settle: Int=15,cluster: Int=30,minRest: Int=30): Rest {
        val s=start.toEpochMilli(); val e=end.toEpochMilli()
        val times=baby.map { it.start.toEpochMilli() }.filter { it>s && it<e }.sorted()
        val wakeups=ArrayList<LongArray>()
        for(t in times) { val cur=wakeups.lastOrNull(); if(cur!=null && t-cur[1]<=cluster*MIN) cur[1]=t else wakeups.add(longArrayOf(t,t)) }
        val rests=ArrayList<Long>(); var cursor=s
        for(w in wakeups) { rests.add(Math.round((w[0]-cursor).toDouble()/MIN)); cursor=min(e,w[1]+settle*MIN) }
        rests.add(Math.round((e-cursor).toDouble()/MIN))
        val counted=rests.filter { it>=minRest }
        return Rest(max(0,Math.round((e-s).toDouble()/MIN)),counted.sum(),counted.maxOrNull() ?: 0,wakeups.size)
    }

    fun report(parent: List<CareEvent>,children: List<CareEvent>,caregiverId: String?,settle: Int=15): Report {
        // Nobody is in bed twice at once: overlapping spans merge into the stretch they cover.
        val sessions=ArrayList<Pair<Instant,Instant>>()
        parent.filter { it.type==EventType.SLEEP && it.end!=null }.map { it.start to it.end!! }
            .filter { val m=Dates.minutesBetween(it.first,it.second); m in 1..16*60 }.sortedBy { it.first }
            .forEach { s -> val cur=sessions.lastOrNull()
                if(cur!=null && s.first.isBefore(cur.second)) { if(s.second.isAfter(cur.second)) sessions[sessions.size-1]=cur.first to s.second } else sessions.add(s) }
        val care=Counts(); val mine=Counts(); var unattributed=0
        val careEvents=children.filter { it.type in CARE_TYPES }
        fun count(c: Counts,e: CareEvent) { c.total++; when(e.type) { EventType.FEED -> { c.feeds++; if(e.isNursing) c.nursingFeeds++ }; EventType.DIAPER -> c.diapers++; EventType.PUMP -> c.pumps++; else -> {} }
            if(nightDuty(e.start)) c.nightEvents++ }
        for(e in careEvents) { count(care,e); if(e.caregiverId==null) unattributed++ else if(caregiverId!=null && e.caregiverId==caregiverId) count(mine,e) }
        // Only an entry recorded against this parent broke their night.
        val wakers=careEvents.filter { caregiverId==null || it.caregiverId==caregiverId }
        val nights=LinkedHashMap<String,Night>()
        for((s,e) in sessions) {
            val r=rest(s,e,wakers,settle)
            val n=nights.getOrPut(nightKey(s)) { Night(nightKey(s)) }
            n.sleepMinutes+=r.rest; n.inBedMinutes+=r.inBed; n.longestStretchMinutes=max(n.longestStretchMinutes,r.longest); n.interruptions+=r.wakeups; n.sessions++
        }
        val ordered=nights.values.sortedBy { it.dateKey }
        fun avg(v: List<Long>)=if(v.isEmpty()) null else Math.round(v.average())
        return Report(ordered,avg(ordered.map { it.sleepMinutes }),avg(ordered.map { it.inBedMinutes }),avg(ordered.map { it.longestStretchMinutes }),
            ordered.maxOfOrNull { it.longestStretchMinutes },if(ordered.isEmpty()) null else Math.round(ordered.map { it.interruptions }.average()*10)/10.0,
            ordered.sumOf { it.sleepMinutes },care,mine,unattributed)
    }
}
