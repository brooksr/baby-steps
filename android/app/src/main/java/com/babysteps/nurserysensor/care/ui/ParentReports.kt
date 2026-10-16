package com.babysteps.nurserysensor.care.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.babysteps.nurserysensor.care.domain.Cycle
import com.babysteps.nurserysensor.care.domain.DateRange
import com.babysteps.nurserysensor.care.domain.Dates
import com.babysteps.nurserysensor.care.domain.FirstYear
import com.babysteps.nurserysensor.care.domain.IntakeOutput
import com.babysteps.nurserysensor.care.domain.ParentReport
import com.babysteps.nurserysensor.care.domain.Reference
import com.babysteps.nurserysensor.care.domain.Units
import com.babysteps.nurserysensor.care.domain.inRange
import com.babysteps.nurserysensor.care.model.EventType
import com.babysteps.nurserysensor.care.model.MENSES_FLOW_LABELS
import com.babysteps.nurserysensor.care.model.OUTPUT_KIND_LABELS

private fun hours(minutes: Long)=Math.round(minutes/60.0*10)/10.0
private fun rangeCaption(from: String,to: String): String {
    if(from.isEmpty() && to.isEmpty()) return "All time"
    val a=if(from.isNotEmpty()) Dates.shortDate(from) else "start"; val b=if(to.isNotEmpty()) Dates.shortDate(to) else "today"
    return if(a==b) a else "$a – $b"
}

/** `components/ParentReports.tsx`: a parent's own nights and cycle, plus the care the babies needed across the same span. */
@Composable
fun ParentReports(ui: Ui) {
    val p=LocalPalette.current
    val profile=ui.profile
    var period by rememberSaveable { mutableStateOf("30d") }
    var settle by rememberSaveable { mutableIntStateOf(15) }
    var custom by remember { mutableStateOf(DateRange.preset("30d")) }
    val range=if(period=="custom") custom else DateRange.preset(period)
    val events=remember(ui.events,range) { ui.events.inRange(range) }
    val childEvents=remember(ui.childEvents,range) { ui.childEvents.inRange(range) }
    val report=remember(events,childEvents,settle) { ParentReport.report(events,childEvents,profile.id,settle) }
    // The cycle reads the whole log: a 7-day window holds no cycles at all.
    val cycle=if(profile.tracksCycle) Cycle.today(ui.events,java.time.Instant.now(),Cycle.context(ui.profiles)) else null
    val tile=cycle?.let(Cycle::describe)
    val io=remember(events) { IntakeOutput.summary(events) }
    val tags=remember(events) { IntakeOutput.topTags(events) }

    Panel {
        Heading(profile.firstName,"${events.size} entr${if(events.size==1) "y" else "ies"} in this period",level=1)
        Segmented(listOf("7d" to "7 days","30d" to "30 days","90d" to "90 days","custom" to "Custom"),period,Modifier.fillMaxWidth()) { period=it }
        if(period=="custom") DateRangeFilter(custom,"${events.size} entr${if(events.size==1) "y" else "ies"}") { custom=it }
    }

    val sleepHours=report.nights.map { hours(it.sleepMinutes) }
    MiniChart("Sleep/night",EventType.SLEEP,FirstYear.Stats(report.averageSleep?.let { hours(it) } ?: 0.0,sleepHours.maxOrNull() ?: 0.0,sleepHours.minOrNull() ?: 0.0),
        hours(report.totalSleep),report.nights.map { Bar(it.dateKey,hours(it.sleepMinutes)) },"h",onOpen=ui.openDetail)
    val wakes=report.nights.map { it.interruptions.toDouble() }
    MiniChart("Wake-ups/night",EventType.NOTE,FirstYear.Stats(report.averageInterruptions ?: 0.0,wakes.maxOrNull() ?: 0.0,wakes.minOrNull() ?: 0.0),wakes.sum(),
        report.nights.map { Bar(it.dateKey,it.interruptions.toDouble()) },onOpen=ui.openDetail)

    Panel {
        Heading("Rest") { Segmented(listOf(0 to "0m",10 to "10m",15 to "15m",30 to "30m"),settle,Modifier.width(200.dp)) { settle=it } }
        MetricGrid(listOf(
            Metric("In bed",report.averageInBed?.let(Dates::duration) ?: "—",listOf(if(report.averageSleep!=null && report.averageInBed!=null) "${Dates.duration(report.averageInBed-report.averageSleep)} of it awake" else "Nothing logged yet")),
            Metric("Longest stretch",report.averageLongest?.let(Dates::duration) ?: "—",listOf("avg unbroken run"+(report.bestStretch?.let { " · best ${Dates.duration(it)}" } ?: ""))),
            Metric("Nights logged","${report.nights.size}",listOf(if(report.nights.isEmpty()) "Log a sleep to start" else rangeCaption(report.nights.first().dateKey,report.nights.last().dateKey)))),ui.openDetail)
        FieldNote("Rest is the time in bed less every wake-up and the $settle minutes it takes to settle after one. Entries within half an hour of each other count as a single wake-up, and a stretch under half an hour between them is not counted as sleep at all. A broken night adds up to more than any one run of it, which is why the longest stretch sits below the nightly total — and because that figure is a nightly average, a longer period can lower it by taking in worse nights. The best single night beside it only ever goes up.")
    }

    Panel {
        Heading("Baby care this period","${report.mine.total} of ${report.care.total} entr${if(report.care.total==1) "y" else "ies"}")
        MetricGrid(listOf(
            Metric("Night duty","${report.mine.nightEvents}",listOf("of ${report.care.nightEvents} · 10pm–6am")),
            Metric("Feeds","${report.mine.feeds}",listOf("of ${report.care.feeds} · ${report.mine.nursingFeeds} nursing")),
            Metric("Diapers","${report.mine.diapers}",listOf("of ${report.care.diapers} · ${report.mine.pumps} of ${report.care.pumps} pumps"))),ui.openDetail)
        FieldNote("The big number is what ${profile.firstName} is recorded as having done; the smaller one is everything the household logged. "+
            (if(report.unattributed>0) "${report.unattributed} of those name nobody — \"Logged by\" is optional, so a low share can mean a quiet week or an unfilled field." else "Every entry this period names who did it.")+
            " The wake-ups above are a different question: those are the ones that broke into ${profile.firstName}'s own logged sleep.")
    }

    if(io.intakes>0 || io.outputs>0) Panel {
        Heading("Inputs & outputs","over ${io.daysLogged} day${if(io.daysLogged==1) "" else "s"}")
        MetricGrid(listOf(
            Metric("Inputs","${io.intakes}",listOf("${io.foods} food · ${io.drinks} drink"+if(io.fluidOz>0) " · ${Units.volume(io.fluidOz,profile.metric)}" else ""),EventType.INTAKE),
            Metric("Outputs","${io.outputs}",listOf(IntakeOutput.OUTPUT_KINDS.filter { (io.byKind[it] ?: 0)>0 }.joinToString(" · ") { "${io.byKind[it]} ${OUTPUT_KIND_LABELS[it]?.lowercase()}" }.ifEmpty { "Nothing logged yet" }),EventType.OUTPUT),
            Metric("Ready to compare",if(io.outputs>0) "${Math.round(io.linked*100.0/io.outputs)}%" else "—",listOf("of outputs have an input in the ${IntakeOutput.LINK_WINDOW_HOURS}h before"))),ui.openDetail)
        tags.forEach { (tag,count) -> val t=Reference.foodTrigger(tag)
            Row(Modifier.fillMaxWidth().clip(Radius).background(p.panelBlue).padding(10.dp),verticalAlignment=Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { Ink(t?.label ?: tag,size=14); Muted(t?.group ?: "Tag",size=12) }
                Ink("$count input${if(count==1) "" else "s"}",size=13)
            }
        }
        FieldNote("${io.tagged} of ${io.intakes} input${if(io.intakes==1) " carries" else "s carry"} a food group and ${io.rated} of ${io.outputs} output${if(io.outputs==1) "" else "s"} a severity. Those two fields are what a pattern could later be read from — a free-text meal is a sentence nothing can group, and an unrated output has no size to compare. Nothing here says one caused the other; it is a count of what was logged, over a span short enough that coincidence is the likeliest explanation for anything that looks like a pattern. A symptom that keeps coming back is a question for a doctor, not for arithmetic.")
    }

    if(profile.tracksCycle) Panel {
        Heading("Cycle",if(cycle?.status=="cycling" && cycle.phase!=null) Cycle.PHASE_LABELS[cycle.phase] else tile?.first ?: "Nothing logged yet")
        when(cycle?.status) {
            "pregnant" -> EmptyState("Cycle tracking is paused while a baby is on the way${cycle.daysUntilDue?.takeIf { it>=0 }?.let { ", about ${Math.ceil(it/7.0).toInt()} weeks to go" } ?: ""}. It picks up from the first period after the birth.")
            "postpartum" -> { EmptyState("No period logged yet${tile?.let { " — ${it.second.lowercase()}" } ?: ""}. Log the days when it returns and the cycle starts again from there.")
                FieldNote("Cycles often take months to return, longer while breastfeeding. Ovulation comes first, so it can happen before any period.") }
            "cycling" -> {
                val st=cycle.stats
                MetricGrid(listOf(
                    Metric("Cycle day","${cycle.dayOfCycle}",listOf("since ${Dates.shortDate(st.periods.last().startKey)}")),
                    Metric("Cycle length",st.averageCycleDays?.let { "${it}d" } ?: "—",listOf(if(st.shortest!=null && st.longest!=null) "${st.shortest}–${st.longest}d range" else "Needs two cycles")),
                    Metric("Period length",st.averagePeriodDays?.let { "${Units.number(it,1)}d" } ?: "—",listOf("average"))),ui.openDetail)
                val pr=cycle.prediction
                if(pr!=null) Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
                    listOf(Triple("Next period",Dates.shortDate(pr.nextPeriodKey),"${Dates.shortDate(pr.windowStartKey)} – ${Dates.shortDate(pr.windowEndKey)}"),
                        Triple("Fertile window","${Dates.shortDate(pr.fertileStartKey)} – ${Dates.shortDate(pr.fertileEndKey)}","ovulation around ${Dates.shortDate(pr.ovulationKey)}"),
                        Triple("Based on","${pr.confidence} confidence",pr.basis+if(st.dropped>0) " · ${st.dropped} gap${if(st.dropped==1) "" else "s"} not counted" else "")).forEach { (a,b,c) ->
                        Column(Modifier.fillMaxWidth().clip(Radius).background(p.panelBlue).border(1.dp,p.line,Radius).padding(12.dp)) { Muted(a,size=12); Text(b,style=display(18),color=p.ink); Muted(c,size=12) }
                    }
                } else EmptyState("Two cycles are needed before a date can be estimated. Keep logging the days of each period.")
                st.periods.reversed().take(6).forEach { rec ->
                    val heaviest=rec.flows.maxByOrNull { listOf("spotting","light","medium","heavy").indexOf(it) } ?: "medium"
                    Row(Modifier.fillMaxWidth().clip(Radius).background(p.panelBlue).padding(10.dp),verticalAlignment=Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Ink(Dates.shortDate(rec.startKey),size=14); Muted("${rec.days} day${if(rec.days==1) "" else "s"} · ${MENSES_FLOW_LABELS[heaviest]?.lowercase()} at its heaviest",size=12) }
                        Text(rec.cycleLengthDays?.let { "${it}d cycle" } ?: "current",style=body(13,700),color=if(rec.cycleLengthDays!=null && !rec.counted) p.muted else p.ink)
                    }
                }
                FieldNote("Estimates from the dates logged here — not contraception, not a fertility test, and not a pregnancy test. Cycles are often irregular after a birth and while breastfeeding, which makes any prediction a rough one. Anything that worries you is a question for your doctor or midwife.",flagged=true)
            }
            else -> EmptyState("Log the days of a period and the cycle, the next date, and the fertile window follow from it.")
        }
    }

    Panel {
        Heading("Entries",rangeCaption(range.from,range.to))
        Timeline(events,profile,ui.profiles,"Nothing logged for ${profile.firstName} in this period.")
    }
}
