package com.babysteps.nurserysensor.care.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import com.babysteps.nurserysensor.care.domain.BabyNights
import com.babysteps.nurserysensor.care.domain.Checkup
import com.babysteps.nurserysensor.care.domain.DateRange
import com.babysteps.nurserysensor.care.domain.Dates
import com.babysteps.nurserysensor.care.domain.Diapers
import com.babysteps.nurserysensor.care.domain.FeedClock
import com.babysteps.nurserysensor.care.domain.FeedOrder
import com.babysteps.nurserysensor.care.domain.FirstYear
import com.babysteps.nurserysensor.care.domain.Growth
import com.babysteps.nurserysensor.care.domain.Summary
import com.babysteps.nurserysensor.care.domain.Units
import com.babysteps.nurserysensor.care.domain.inRange
import com.babysteps.nurserysensor.care.model.CareEvent
import com.babysteps.nurserysensor.care.model.EventType
import com.babysteps.nurserysensor.care.model.Profile
import kotlin.math.max

private val PERIODS=listOf("day" to "Day","week" to "Week","month" to "Month","year" to "Year","checkup" to "Check-Up","custom" to "Custom")
private fun calendarPeriod(p: String)=p=="checkup" || p=="custom"
private fun scopeLabel(p: String)=when(p) { "day" -> "today"; "checkup" -> "since last check-up"; "custom" -> "selected range"; else -> "this $p" }

private fun stat(points: List<FirstYear.Point>,sel: (FirstYear.Point) -> Double?)=FirstYear.dayStats(points.mapNotNull { p -> sel(p)?.let { p.dateKey to it } })

/** Averages groups of days down to at most `maxBars`, so a year still fits a card. */
private fun sample(values: List<Bar>,maxBars: Int): List<Bar> {
    if(values.size<=maxBars) return values
    val step=values.size.toDouble()/maxBars
    return (0 until maxBars).map { i ->
        val bucket=values.subList((i*step).toInt(),((i+1)*step).toInt())
        fun avg(sel: (Bar) -> Double)=Math.round(bucket.sumOf(sel)/bucket.size*10)/10.0
        Bar(bucket.first().label,avg { it.value },bucket.first().parts?.indices?.map { pi -> avg { it.parts?.getOrNull(pi) ?: 0.0 } })
    }
}

private fun range(stats: FirstYear.Stats,suffix: String="")=Units.stat(stats.min,suffix).let { min -> val max=Units.stat(stats.max,suffix); if(min==max) min else "$min–$max" }
private fun durationRange(min: Double,max: Double)=Dates.duration(min).let { a -> val b=Dates.duration(max); if(a==b) a else "$a–$b" }
private fun sizes(large: Int,medium: Int,small: Int,unsized: Int)=listOfNotNull(if(large>0) "$large lg" else null,if(medium>0) "$medium md" else null,
    if(small>0) "$small sm" else null,if(unsized>0) "$unsized unsized" else null).joinToString(" · ")
private fun weightRate(oz: Double,metric: Boolean)=(if(oz>=0) "+" else "")+if(metric) "${Math.round(oz*Units.KG_PER_OZ*1000)} g" else "${Units.number(oz,1)} oz"

@Composable
fun ChildReports(ui: Ui) {
    val p=LocalPalette.current
    val profile=ui.profile; val events=ui.events; val metric=profile.metric
    var period by rememberSaveable { mutableStateOf("day") }
    var dateKey by rememberSaveable { mutableStateOf(Dates.today()) }
    var custom by remember { mutableStateOf(DateRange.preset("30d")) }
    val milkSuffix=if(metric) " mL" else " oz"
    fun vol(oz: Double)=Units.toVolume(oz,metric)

    val analytics=remember(profile,events) { FirstYear.analytics(profile,events) }
    val selected=events.filter { Dates.key(it.start)==dateKey }
    val summary=Summary.daily(selected)
    val recent=analytics.points.takeLast(14)
    val checkup=remember(events) { Checkup.span(events) }

    Panel {
        Column(Modifier.fillMaxWidth().clip(Radius).background(androidx.compose.ui.graphics.Brush.linearGradient(listOf(p.bandStart,p.bandEnd))).padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment=Alignment.Bottom) {
                Column(Modifier.weight(1f)) { Text("First Year",style=display(24),color=Color.White); Text("${analytics.totalLogs} logs since ${analytics.anchorDate}",style=body(13,600),color=Color.White.copy(alpha=0.85f)) }
                Text("${analytics.progressPercent}%",style=display(24),color=Color.White)
            }
            Box(Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(999.dp)).background(Color.White.copy(alpha=0.24f))) {
                Box(Modifier.fillMaxWidth(analytics.progressPercent/100f).fillMaxHeight().clip(RoundedCornerShape(999.dp)).background(p.accent))
            }
            Text(if(profile.birthDate!=null) "${analytics.daysElapsed} of 365 days" else "Birth not logged",style=body(14,800),color=Color.White)
        }
    }

    MiniChart("Feeds/day",EventType.FEED,analytics.feeds,recent.sumOf { it.feeds }.toDouble(),recent.map { Bar(it.dateKey,it.feeds.toDouble()) },onOpen=ui.openDetail)
    MiniChart("Sleep/day",EventType.SLEEP,analytics.sleepHours,recent.sumOf { it.sleepMinutes }/60.0,recent.map { Bar(it.dateKey,it.sleepMinutes/60.0) },"h",onOpen=ui.openDetail)
    MiniChart("Diapers/day",EventType.DIAPER,analytics.diapers,recent.sumOf { it.diapers }.toDouble(),recent.map { Bar(it.dateKey,it.diapers.toDouble(),listOf(it.wetDiapers.toDouble(),it.dirtyDiapers.toDouble())) },
        partLabels=listOf("wet","dirty"),partAverages=listOf(analytics.wetDiapers.average,analytics.dirtyDiapers.average),
        partTotals=listOf(recent.sumOf { it.wetDiapers }.toDouble(),recent.sumOf { it.dirtyDiapers }.toDouble()),onOpen=ui.openDetail)
    val milk=analytics.milkOunces
    MiniChart("Milk/day",EventType.PUMP,FirstYear.Stats(vol(milk.average),vol(milk.max),vol(milk.min)),recent.sumOf { vol(it.bottleOunces+it.pumpOunces) },
        recent.map { Bar(it.dateKey,vol(it.bottleOunces+it.pumpOunces)) },milkSuffix,onOpen=ui.openDetail)

    GrowthStandards(profile,events)

    // The fixed periods count back over days that logged something; the calendar ones are calendar-true.
    val count=if(period=="week") 7 else if(period=="month") 30 else analytics.points.size
    val calRange=if(period=="custom") custom else if(period=="checkup") checkup?.range else null
    val points=if(calendarPeriod(period)) calRange?.let { r -> analytics.points.filter { r.contains(it.dateKey) } }.orEmpty() else analytics.points.takeLast(count)
    val maxBars=if(period=="week") 7 else if(period=="month") 30 else if(calendarPeriod(period)) 31 else 52
    val sampled=points.size>maxBars
    val raw=when { period=="day" -> selected; calendarPeriod(period) -> calRange?.let { events.inRange(it) }.orEmpty()
        else -> points.firstOrNull()?.let { first -> val last=points.last().dateKey; events.filter { Dates.key(it.start) in first.dateKey..last } }.orEmpty() }

    Panel {
        Heading("Report")
        Segmented(PERIODS,period,scroll=true) { period=it }
        if(period=="custom") DateRangeFilter(custom,"${raw.size} entr${if(raw.size==1) "y" else "ies"}") { custom=it }
        if(period=="checkup") {
            if(checkup!=null) Column(Modifier.fillMaxWidth().clip(Radius).background(p.panelBlue).padding(12.dp)) {
                Ink("Since ${if(checkup.anchor.type==EventType.BIRTH) "birth" else "the measurement"} on ${Dates.shortDate(checkup.anchor.dateKey)}")
                Muted("${checkup.days} day${if(checkup.days!=1) "s" else ""} · ${raw.size} entr${if(raw.size==1) "y" else "ies"}")
                val measured=listOfNotNull(checkup.anchor.weightOz?.let { Units.weight(it,profile) },checkup.anchor.lengthIn?.let { Units.length(it,metric) },checkup.anchor.headIn?.let { "${Units.length(it,metric)} head" })
                if(measured.isNotEmpty()) Muted("Measured then: ${measured.joinToString(" · ")}")
            } else EmptyState("No growth measurement logged yet, so there is no check-up span to report.")
        }
        if(period!="day") {
            if(points.isNotEmpty()) Muted("${Dates.shortDate(points.first().dateKey).let { a -> val b=Dates.shortDate(points.last().dateKey); if(a==b) a else "$a – $b" }} · ${points.size} day${if(points.size!=1) "s" else ""} with entries")
            else if(period=="custom") EmptyState("Nothing logged in ${custom.label()}.") else if(period!="checkup" || checkup!=null) EmptyState(if(period=="checkup") "Nothing logged since the last measurement." else "Nothing logged yet.")
        }
    }

    val nightRange=when(period) { "day" -> null; "custom" -> custom; "checkup" -> checkup?.range; else -> BabyNights.recentNightsRange(events,if(period=="week") 7 else if(period=="month") 30 else 365) }
    NightReport(ui,nightRange,scopeLabel(period))

    // Insights over the period's raw entries.
    val feeds=raw.filter { it.type==EventType.FEED }.sortedBy { it.start }
    val gaps=feeds.zipWithNext { a,b -> (b.start.toEpochMilli()-a.start.toEpochMilli())/60_000.0 }.filter { it>0 && it<8*60 }
    val lags=Diapers.feedToDiaperLags(raw)
    val nursing=raw.filter { it.isNursing }; val left=nursing.count { it.side=="left" }; val right=nursing.count { it.side=="right" }
    val weights=events.filter { (it.type==EventType.GROWTH || it.type==EventType.BIRTH) && it.weightOz!=null }.sortedBy { it.start }
    val rates=weights.zipWithNext { a,b -> val days=(b.start.toEpochMilli()-a.start.toEpochMilli())/86_400_000.0; if(days>0) (b.weightOz!!-a.weightOz!!)/days*7 else null }.filterNotNull()
    MetricGrid(listOf(
        Metric("Avg feed gap",if(gaps.isNotEmpty()) Dates.duration(gaps.average()) else "—",listOfNotNull(if(gaps.isNotEmpty()) "${durationRange(gaps.min(),gaps.max())} range" else null,scopeLabel(period)),EventType.FEED),
        lags.wet.let { Metric("Feed → wet",it.averageMinutes?.let(Dates::duration) ?: "—",listOfNotNull(if(it.minMinutes!=null) "${durationRange(it.minMinutes,it.maxMinutes!!)} range" else null,if(it.samples>0) "${it.samples} feeds" else "no pairs yet"),EventType.DIAPER) },
        lags.dirty.let { Metric("Feed → dirty",it.averageMinutes?.let(Dates::duration) ?: "—",listOfNotNull(if(it.minMinutes!=null) "${durationRange(it.minMinutes,it.maxMinutes!!)} range" else null,if(it.samples>0) "${it.samples} feeds" else "no pairs yet"),EventType.DIAPER) },
        Metric("Nursing L/R",if(left+right>0) "${Math.round(left*100.0/(left+right))}% · ${Math.round(right*100.0/(left+right))}%" else "—",listOf(scopeLabel(period)),EventType.FEED),
        Metric("Weight gain",rates.lastOrNull()?.let { weightRate(it,metric) } ?: "—",listOfNotNull(if(rates.isNotEmpty() && rates.min()!=rates.max()) "${weightRate(rates.min(),metric)}–${weightRate(rates.max(),metric)} range" else null,"per week"),EventType.GROWTH),
    ),ui.openDetail)

    FeedClockSection(raw,scopeLabel(period))
    FeedOrderSection(raw,scopeLabel(period))

    if(period=="day") {
        Panel { Heading("Daily Report"); DateKeyInput("Report date",dateKey,{ if(it.isNotEmpty()) dateKey=it }) }
        NewbornStatus(ui,dateKey,"Newborn check (selected day)")
        val unsized=summary.dirtyDiapers-summary.dirtyLarge-summary.dirtyMedium-summary.dirtySmall
        val sized=summary.dirtyLarge+summary.dirtyMedium+summary.dirtySmall
        MetricGrid(listOf(
            Metric("Feeds","${summary.feedCount}",event=EventType.FEED),Metric("Nursing",Dates.duration(summary.nursingMinutes),event=EventType.FEED),
            Metric("Bottle",Units.volume(summary.bottleOunces,metric),event=EventType.FEED),Metric("Pumped",Units.volume(summary.pumpOunces,metric),event=EventType.PUMP),
            Metric("Wet","${summary.wetDiapers}",event=EventType.DIAPER),
            Metric("Dirty","${summary.dirtyDiapers}",if(sized>0) listOf(sizes(summary.dirtyLarge,summary.dirtyMedium,summary.dirtySmall,unsized),"${Units.stat(summary.poopLoad)} poops by size") else emptyList(),EventType.DIAPER),
            Metric("Sleep",Dates.duration(summary.sleepMinutes),event=EventType.SLEEP),Metric("Meds","${summary.medicationsGiven}",event=EventType.MEDICATION)),ui.openDetail)
        Panel { Heading("Entries","${selected.size}"); Timeline(selected,profile,ui.profiles,"No entries on this date.") }
    } else {
        val st=object { val feeds=stat(points) { if(it.feeds>0) it.feeds.toDouble() else null }; val diapers=stat(points) { if(it.diapers>0) it.diapers.toDouble() else null }
            val poops=stat(points) { if(it.diapers>0) it.poopLoad else null }; val sleep=stat(points) { if(it.sleepMinutes>0) it.sleepMinutes/60.0 else null }
            val milk=stat(points) { vol(it.bottleOunces+it.pumpOunces).takeIf { v -> v>0 } }
            val wet=stat(points) { if(it.diapers>0) it.wetDiapers.toDouble() else null }.average; val dirty=stat(points) { if(it.diapers>0) it.dirtyDiapers.toDouble() else null }.average }
        val tDirty=points.sumOf { it.dirtyDiapers }; val tL=points.sumOf { it.dirtyLarge }; val tM=points.sumOf { it.dirtyMedium }; val tS=points.sumOf { it.dirtySmall }
        val tMilk=vol(points.sumOf { it.bottleOunces+it.pumpOunces })
        MetricGrid(listOf(
            Metric("Feeds/day",Units.stat(st.feeds.average),listOf("${range(st.feeds)} range","${points.sumOf { it.feeds }} total"),EventType.FEED),
            Metric("Diapers/day",Units.stat(st.diapers.average),listOf("${range(st.diapers)} range","${Units.stat(st.wet)} wet · ${Units.stat(st.dirty)} dirty","${points.sumOf { it.diapers }} total"),EventType.DIAPER),
            Metric("Poops/day",Units.stat(st.poops.average),listOf("${range(st.poops)} range",if(tDirty>0) sizes(tL,tM,tS,tDirty-tL-tM-tS) else "none logged",
                "${Units.stat(points.sumOf { it.poopLoad })} total · $tDirty change${if(tDirty!=1) "s" else ""}"),EventType.DIAPER),
            Metric("Sleep/day",Units.stat(st.sleep.average,"h"),listOf("${range(st.sleep,"h")} range","${Units.stat(points.sumOf { it.sleepMinutes }/60.0,"h")} total"),EventType.SLEEP),
            Metric("Milk/day",Units.stat(st.milk.average,milkSuffix),listOf("${range(st.milk,milkSuffix)} range","${Units.stat(tMilk,milkSuffix)} total"),EventType.PUMP)),ui.openDetail)
        MiniChart("Feeds/day",EventType.FEED,st.feeds,points.sumOf { it.feeds }.toDouble(),sample(points.map { Bar(it.dateKey,it.feeds.toDouble()) },maxBars),sampled=sampled,onOpen=ui.openDetail)
        MiniChart("Sleep/day",EventType.SLEEP,st.sleep,points.sumOf { it.sleepMinutes }/60.0,sample(points.map { Bar(it.dateKey,it.sleepMinutes/60.0) },maxBars),"h",sampled=sampled,onOpen=ui.openDetail)
        MiniChart("Diapers/day",EventType.DIAPER,st.diapers,points.sumOf { it.diapers }.toDouble(),sample(points.map { Bar(it.dateKey,it.diapers.toDouble(),listOf(it.wetDiapers.toDouble(),it.dirtyDiapers.toDouble())) },maxBars),
            partLabels=listOf("wet","dirty"),partAverages=listOf(st.wet,st.dirty),partTotals=listOf(points.sumOf { it.wetDiapers }.toDouble(),tDirty.toDouble()),sampled=sampled,onOpen=ui.openDetail)
        MiniChart("Milk/day",EventType.PUMP,st.milk,tMilk,sample(points.map { Bar(it.dateKey,vol(it.bottleOunces+it.pumpOunces)) },maxBars),milkSuffix,sampled=sampled,onOpen=ui.openDetail)
    }
}

// ── Growth standards ────────────────────────────────────────────────────────────

@Composable
fun GrowthStandards(profile: Profile,events: List<CareEvent>) {
    val p=LocalPalette.current
    var corrected by rememberSaveable { mutableStateOf(true) }
    val sex=Growth.standardSex(profile.gender)
    if(profile.birthDate==null) { Panel { Heading("Growth standards"); EmptyState("Log ${profile.firstName}'s birth to compare measurements against WHO ${if(sex=="girls") "girl" else "boy"} growth standards.") }; return }
    val measurements=remember(profile,events) { Growth.measurements(profile,events) }
    val g=Growth.gestation(profile)
    val showCorrected=g!=null && g.preterm && g.correctionDays>0
    val useCorrected=showCorrected && corrected
    val assessments=remember(profile,events,useCorrected) { Growth.assessLatest(profile,events,useCorrected) }
    val actual=remember(profile,events) { Growth.assessLatest(profile,events,false).associateBy { it.metric } }
    val correctedMap=remember(profile,events) { Growth.assessLatest(profile,events,true).associateBy { it.metric } }
    val standards=remember(profile.gender) { Growth.standards(profile.gender) }
    val maxAge=maxOf(1.0,Dates.ageDays(profile)/(365.25/12),measurements.lastOrNull()?.ageMonths ?: 0.0)
    fun show(metric: Growth.Metric,value: Double)=if(metric==Growth.Metric.WEIGHT) Units.weight(value/Units.KG_PER_OZ,profile) else Units.length(value/Units.CM_PER_IN,profile.metric)
    fun convert(metric: Growth.Metric,value: Double)=if(profile.metric) value else if(metric!=Growth.Metric.WEIGHT) value/Units.CM_PER_IN else (value/Units.KG_PER_OZ).let { if(profile.ouncesOnly) it else it/16 }
    fun unit(metric: Growth.Metric)=if(profile.metric) (if(metric==Growth.Metric.WEIGHT) "kg" else "cm") else if(metric!=Growth.Metric.WEIGHT) "in" else if(profile.ouncesOnly) "oz" else "lb"

    Panel {
        Heading("Growth standards","WHO $sex · ${measurements.size} measurement${if(measurements.size==1) "" else "s"}")
        Disclosure("Age comparison & reference notes") {
            if(showCorrected) Segmented(listOf(false to "Actual age",true to "Corrected"),corrected,Modifier.fillMaxWidth()) { corrected=it }
            if(profile.gender!="boy" && profile.gender!="girl") Muted("Using the boys’ WHO reference. Set sex in Settings to choose the matching curves.")
            if(showCorrected && g!=null) Muted("Born at ${g.label}. Corrected age subtracts ${g.correctionDays} days.")
            Muted("WHO reference bands are informational. Discuss concerns with your pediatrician.")
        }
        if(assessments.isEmpty()) EmptyState("Add a growth entry (weight, length, or head) to see how ${profile.firstName} compares.")
        assessments.forEach { a ->
            val color=when(a.band) { "below", "above" -> p.danger; else -> if(p.dark) Color(0xFF86C98D) else Color(0xFF3D8046) }
            Column(Modifier.fillMaxWidth().clip(Radius).background(p.panelBlue).border(1.dp,p.line,Radius).padding(12.dp),verticalArrangement=Arrangement.spacedBy(3.dp)) {
                Row(verticalAlignment=Alignment.CenterVertically) {
                    Ink(a.label,Modifier.weight(1f))
                    Text(when(a.band) { "below" -> "Below range"; "above" -> "Above range"; else -> "On track" },Modifier.clip(RoundedCornerShape(999.dp)).background(color.copy(alpha=0.14f)).padding(horizontal=10.dp,vertical=3.dp),style=body(12,800),color=color)
                }
                Ink("${show(a.metric,a.value)} · P${a.percentile}",size=17,weight=800)
                Muted("Median ${show(a.metric,a.standard.median)} · range ${show(a.metric,a.standard.p2)}–${show(a.metric,a.standard.p98)}",size=12)

            }
        }
    }
    listOf(Growth.Metric.WEIGHT,Growth.Metric.LENGTH,Growth.Metric.HEAD).forEach { metric ->
        val standard=standards.getValue(metric)
        val plots=Growth.plots(measurements,metric)
        Panel {
            Row { Text(standard.label,Modifier.weight(1f),style=display(17),color=p.ink); Text(unit(metric),style=display(17),color=p.ink) }
            GrowthChart(standard,plots,maxAge,useCorrected) { convert(metric,it) }
            if(useCorrected) Disclosure("Chart age comparison") { Row(horizontalArrangement=Arrangement.spacedBy(12.dp)) { Dot(p.blue700); Muted("Actual age",size=12); Dot(p.accentStrong); Muted("Corrected age",size=12) } }
            Row { Muted("WHO -2 SD…+2 SD band",Modifier.weight(1f),12); Muted("${plots.size} plotted",size=12) }
        }
    }
}

/** `components/GrowthChart.tsx`: the WHO band and median, with each measurement plotted on it. */
@Composable
private fun GrowthChart(standard: Growth.Standard,plots: List<Growth.Plot>,maxAgeMonths: Double,showCorrected: Boolean,convert: (Double) -> Double) {
    val p=LocalPalette.current
    val text=rememberTextMeasurer()
    val label=body(10,600).copy(color=p.muted)
    Canvas(Modifier.fillMaxWidth().aspectRatio(1.6f)) {
        val last=standard.points.last().month
        val chartMax=minOf(maxAgeMonths,last)
        val pts=standard.points.filter { it.month<=chartMax }.toMutableList()
        if(pts.last().month<chartMax) { val lo=pts.last(); val hi=standard.points.firstOrNull { it.month>chartMax } ?: lo
            val r=(chartMax-lo.month)/(hi.month-lo.month).let { if(it==0.0) 1.0 else it }
            fun mix(a: Double,b: Double)=a+(b-a)*r
            pts.add(Growth.Point(chartMax,mix(lo.p2,hi.p2),mix(lo.median,hi.median),mix(lo.p98,hi.p98))) }
        val minMonth=pts.first().month; val maxMonth=pts.last().month
        val values=plots.map { convert(it.value) }
        var lo=minOf(pts.minOf { convert(it.p2) },values.minOrNull() ?: Double.MAX_VALUE)
        var hi=maxOf(pts.maxOf { convert(it.p98) },values.maxOrNull() ?: -Double.MAX_VALUE)
        val pad=(hi-lo)*0.08; lo-=pad; hi+=pad
        val left=34.dp.toPx(); val right=8.dp.toPx(); val top=12.dp.toPx(); val bottom=24.dp.toPx()
        fun x(m: Double)=(left+(m-minMonth)/(maxMonth-minMonth).let { if(it==0.0) 1.0 else it }*(size.width-left-right)).toFloat()
        fun y(v: Double)=(top+(1-(v-lo)/(hi-lo).let { if(it==0.0) 1.0 else it })*(size.height-top-bottom)).toFloat()
        val band=Path().apply { pts.forEachIndexed { i,pt -> if(i==0) moveTo(x(pt.month),y(convert(pt.p98))) else lineTo(x(pt.month),y(convert(pt.p98))) }
            pts.reversed().forEach { lineTo(x(it.month),y(convert(it.p2))) }; close() }
        drawPath(band,p.blue400.copy(alpha=0.18f))
        val median=Path().apply { pts.forEachIndexed { i,pt -> if(i==0) moveTo(x(pt.month),y(convert(pt.median))) else lineTo(x(pt.month),y(convert(pt.median))) } }
        drawPath(median,p.blue500,style=Stroke(2.dp.toPx()))
        fun label(t: String,at: Offset,end: Boolean=false,mid: Boolean=false) { val m=text.measure(t,label)
            drawText(m,topLeft=Offset(if(end) at.x-m.size.width else if(mid) at.x-m.size.width/2 else at.x,at.y-m.size.height/2)) }
        listOf(lo,(lo+hi)/2,hi).forEach { v -> label(Units.number(v,if(v<10) 1 else 0),Offset(left-4.dp.toPx(),y(v)),end=true) }
        listOf(minMonth,maxMonth/2,maxMonth).forEach { m -> label("${Units.number(m,1)}m",Offset(x(m),size.height-8.dp.toPx()),mid=true) }
        plots.forEach { pl -> val v=convert(pl.value)
            if(showCorrected) { drawLine(p.accentStrong.copy(alpha=0.5f),Offset(x(pl.correctedAgeMonths),y(v)),Offset(x(pl.ageMonths),y(v)),1.5.dp.toPx())
                drawCircle(p.accentStrong,3.5.dp.toPx(),Offset(x(pl.correctedAgeMonths),y(v))) }
            drawCircle(p.blue700,3.5.dp.toPx(),Offset(x(pl.ageMonths),y(v)))
        }
    }
}

// ── Feed clock & order ──────────────────────────────────────────────────────────

@Composable
private fun FeedClockSection(events: List<CareEvent>,scope: String) {
    var hours by rememberSaveable { mutableIntStateOf(3) }
    val report=remember(events,hours) { FeedClock.report(events,hours) }
    val scopeCap=scope.replaceFirstChar { it.uppercase() }
    fun feeds(n: Int)="$n feed${if(n==1) "" else "s"}"
    Panel(event=EventType.FEED) {
        Heading("Feed clock") { Segmented(listOf(1 to "1h",2 to "2h",3 to "3h"),hours,Modifier.width(150.dp)) { hours=it } }
        Ink(if(report.feeds==0) "$scopeCap: no feeds logged." else "$scopeCap: ${feeds(report.feeds)}${if(report.days==1) "" else " across ${report.days} days"}${report.busiest?.let { ", most often around ${it.label}" } ?: ""}.",size=14,weight=500)
    }
    if(report.feeds==0) return
    ClockChart("Feeds by time of day",report.busiest?.label ?: "—","busiest · ${feeds(report.feeds)}",report.bands,{ it.feeds.toDouble() },{ "${it.toInt()}" },
        { b -> b.feedsPerDay?.let { "${feeds(b.feeds)} · ${Units.stat(it)}/day" } ?: feeds(b.feeds) },
        "Busiest ${report.busiest?.label ?: "—"}" to (report.busiest?.feedsPerDay?.let { "${Units.stat(it)}/day" } ?: "per day —"))
    ClockChart("Feed length by time",report.averageMinutes?.let(Dates::duration) ?: "—","avg feed · ${report.timed} of ${report.feeds} timed",report.bands,{ it.averageMinutes },{ Dates.duration(it) },
        { b -> if(b.averageMinutes==null) "no timed feeds" else "${Dates.duration(b.averageMinutes)} avg${durationRange(b.minMinutes!!,b.maxMinutes!!).let { r -> if(r.contains('–')) " · $r" else "" }} · ${b.timed} timed" },
        "Longest ${report.longest?.label ?: "—"}" to "Shortest ${report.shortest?.label ?: "—"}")
}

@Composable
private fun ClockChart(title: String,headline: String,note: String,bands: List<FeedClock.Band>,valueOf: (FeedClock.Band) -> Double?,format: (Double) -> String,
    readout: (FeedClock.Band) -> String,stats: Pair<String,String>) {
    val p=LocalPalette.current
    var active by remember(bands.size) { mutableStateOf<Int?>(null) }
    val max=maxOf(1.0,bands.maxOf { valueOf(it) ?: 0.0 })
    val labelled=bands.size<=12
    Panel(event=EventType.FEED) {
        Row(verticalAlignment=Alignment.Bottom) {
            Text(title,Modifier.weight(1f),style=display(17),color=p.ink)
            Column(horizontalAlignment=Alignment.End) { Text(headline,style=display(17),color=p.ink); Muted(note,size=12) }
        }
        Row(Modifier.fillMaxWidth().height(130.dp),horizontalArrangement=Arrangement.spacedBy(if(bands.size>12) 2.dp else 4.dp),verticalAlignment=Alignment.Bottom) {
            bands.forEachIndexed { i,b ->
                val v=valueOf(b)
                Column(Modifier.weight(1f).fillMaxHeight().clickable { active=i },horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.Bottom) {
                    if(labelled) Text(v?.let(format) ?: "—",style=body(10,700),color=p.muted,maxLines=1)
                    Canvas(Modifier.fillMaxWidth().weight(1f)) {
                        // An empty band draws no bar: on a clock a gap is the point.
                        if(v!=null && v>0) { val h=size.height*maxOf(0.08,v/max).toFloat()
                            drawRoundRect(p.tint(EventType.FEED).copy(alpha=if(active==i) 1f else 0.62f),Offset(0f,size.height-h),Size(size.width,h),CornerRadius(3.dp.toPx())) }
                    }
                    Text(if(labelled || b.startHour%3==0) b.shortLabel else "",style=body(10,600),color=p.muted,maxLines=1)
                }
            }
        }
        active?.let { bands.getOrNull(it) }?.let { b ->
            Row(Modifier.fillMaxWidth().clip(Radius).background(p.panelBlue).padding(horizontal=10.dp,vertical=8.dp)) {
                Text(b.label,Modifier.weight(1f),style=body(13,600),color=p.muted); Text(readout(b),style=body(13,700),color=p.ink)
            }
        }
        Row { Muted(stats.first,Modifier.weight(1f),12); Muted(stats.second,size=12) }
    }
}

@Composable
private fun FeedOrderSection(events: List<CareEvent>,scope: String) {
    val p=LocalPalette.current
    val report=remember(events) { FeedOrder.report(events) }
    val scopeCap=scope.replaceFirstChar { it.uppercase() }
    fun clock(offset: Double)=Dates.minutesOfDay(FeedOrder.clockMinutes(offset))
    fun days(n: Int)="$n day${if(n==1) "" else "s"}"
    Panel(event=EventType.FEED) {
        Heading("Feed order",scope)
        if(report.slots.isEmpty()) { Ink(if(report.loggedDays==0) "$scopeCap: no feeds logged." else "$scopeCap: no day logged ${FeedOrder.MIN_FEEDS}–${FeedOrder.MAX_FEEDS} feeds, so there is no ordinary day to describe (${days(report.loggedDays)} logged).",size=14,weight=500); return@Panel }
        val first=report.slots.first(); val last=if(report.typicalCount>0) report.slots[report.typicalCount-1] else null
        Ink("$scopeCap: ${Units.number(report.feedsPerDay,1)} feeds a day, starting around ${clock(first.averageOffset)}${if(last!=null && last!=first) " and reaching feed ${last.index} around ${clock(last.averageOffset)}" else ""}.",size=14,weight=500)
        Muted("${report.days} of ${days(report.loggedDays)} · only days with ${FeedOrder.MIN_FEEDS}–${FeedOrder.MAX_FEEDS} feeds · day starts ${Dates.minutesOfDay(report.dayStartMinutes.toDouble())}",size=12)
        val tint=p.tint(EventType.FEED)
        report.slots.forEach { s ->
            Column(Modifier.fillMaxWidth().then(if(s.typical) Modifier else Modifier.background(Color.Transparent)),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment=Alignment.CenterVertically) {
                    Text("Feed ${s.index}",Modifier.width(64.dp),style=body(13,700),color=if(s.typical) p.ink else p.muted)
                    Text(clock(s.averageOffset),Modifier.weight(1f),style=display(15),color=if(s.typical) p.ink else p.muted)
                    Muted((s.averageGapMinutes?.let { "+${Dates.duration(it)} · " } ?: "")+days(s.days),size=12)
                }
                Canvas(Modifier.fillMaxWidth().height(10.dp)) {
                    drawRoundRect(p.line,size=size,cornerRadius=CornerRadius(5.dp.toPx()))
                    val x0=(s.earliestOffset/1440*size.width).toFloat(); val w=maxOf(3.dp.toPx(),((s.latestOffset-s.earliestOffset)/1440*size.width).toFloat())
                    drawRoundRect(tint.copy(alpha=if(s.typical) 0.4f else 0.2f),Offset(x0,0f),Size(w,size.height),CornerRadius(5.dp.toPx()))
                    drawCircle(tint.copy(alpha=if(s.typical) 1f else 0.5f),5.dp.toPx(),Offset((s.averageOffset/1440*size.width).toFloat(),size.height/2))
                }
            }
        }
        Row { listOf(0.0,360.0,720.0,1080.0,1440.0).forEach { o -> Text(clock(o),Modifier.weight(1f),style=body(10,600),color=p.muted) } }
    }
}
