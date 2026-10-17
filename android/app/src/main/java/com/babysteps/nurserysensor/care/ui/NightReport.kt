package com.babysteps.nurserysensor.care.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.babysteps.nurserysensor.care.data.CareRepository
import com.babysteps.nurserysensor.care.domain.BabyNights
import com.babysteps.nurserysensor.care.domain.CryContext
import com.babysteps.nurserysensor.care.domain.DateRange
import com.babysteps.nurserysensor.care.domain.Dates
import com.babysteps.nurserysensor.care.model.EventType
import com.babysteps.nurserysensor.care.model.isoString
import org.json.JSONObject
import java.time.Instant

private fun plural(n: Int,word: String)="$n $word${if(n==1) "" else "s"}"

/**
 * `components/NightReport.tsx`: one night at a time — sleep logged and estimated, wakes,
 * and what the nursery sensor heard — then the day after it, and averages over the period.
 */
@Composable
fun NightReport(ui: Ui,averageRange: DateRange?,scopeLabel: String) {
    val p=LocalPalette.current
    val context=LocalContext.current
    val nursery by CareRepository.nursery.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { CareRepository.refreshNursery(context) }
    val now=rememberNow()
    var nightKey by rememberSaveable { mutableStateOf(BabyNights.defaultNightKey(now)) }
    var selectedCry by remember(nightKey) { mutableStateOf<Instant?>(null) }
    val events=ui.events
    val latest=BabyNights.currentNightKey(now)
    val earliest=events.minByOrNull { it.start }?.let { BabyNights.shiftNightKey(Dates.key(it.start),-1) } ?: latest
    val night=remember(events,nightKey,nursery,now.epochSecond/60) { BabyNights.night(events,nightKey,nursery,now) }
    val day=remember(events,nightKey,nursery,now.epochSecond/60) { BabyNights.day(events,nightKey,nursery,now) }
    val dayTracked=!day.upcoming && (day.items.isNotEmpty() || day.naps.isNotEmpty())
    val report=remember(events,nursery,averageRange) { averageRange?.let { BabyNights.report(events,nursery,it,now) } }
    // A stretch still going is left to the form: logged in bulk it would be a sleep still running.
    val toLog=night.sleeps.flatMap { it.unlogged }.filter { it.end!=null }

    Panel(event=EventType.SLEEP) {
        Heading("Night & Day","Sleep, wakes and the day that follows")
        Row(verticalAlignment=Alignment.CenterVertically) {
            IconAction(Lucide.chevronLeft,"Previous night",if(nightKey>earliest) p.ink else p.line) { if(nightKey>earliest) nightKey=BabyNights.shiftNightKey(nightKey,-1) }
            Column(Modifier.weight(1f),horizontalAlignment=Alignment.CenterHorizontally) {
                Ink(Dates.nightLabel(nightKey))
                Muted(if(night.inProgress) "In progress" else if(nightKey==BabyNights.defaultNightKey(now)) "Last night" else "Night of",size=12)
            }
            IconAction(Lucide.chevronRight,"Next night",if(nightKey<latest) p.ink else p.line) { if(nightKey<latest) nightKey=BabyNights.shiftNightKey(nightKey,1) }
        }
        Heading("Night","7pm–7am",level=3)
        if(!night.tracked) EmptyState("Nothing logged around this night.") else {
            val wakes=(night.wakes+night.edges).sortedBy { it.start }
            Track(night.start,night.end,"night",night.sleeps,wakes.map { it.start to it.resumed },wakes.flatMap { it.items },night.heard,night.wakes.map { it.start },
                night.sleeps.flatMap { it.unlogged },{ u -> ui.logSleep(u.start,u.end) },selectedCry) { selectedCry=if(selectedCry==it) null else it }
            Disclosure("Track legend") { Legend(listOfNotNull("Logged sleep" to p.tint(EventType.SLEEP),"Estimated" to p.tint(EventType.SLEEP).copy(alpha=0.45f),"Awake" to p.pastDue)+
                wakes.flatMap { w -> w.types }.distinct().sortedBy { it.key }.map { it.label to p.tint(it) }+(if(nursery!=null) listOf("Crying heard" to p.danger) else emptyList())) }
            if(toLog.isNotEmpty()) Column(verticalArrangement=Arrangement.spacedBy(6.dp)) {
                SecondaryButton("Log ${plural(toLog.size,"estimated sleep")}") {
                    toLog.forEach { u -> CareRepository.addEvent(context,JSONObject().put("babyId",ui.profile.id).put("type","sleep").put("startedAt",isoString(u.start)).put("endedAt",isoString(u.end!!))) }
                }
                Muted("Or tap one hatched stretch to log it.",size=12)
            }
            MetricGrid(listOf(
                Metric("Asleep",Dates.duration(night.sleepMinutes),listOf((if(night.estimated) "estimated" else "logged")+if(night.inProgress) " · so far" else ""),EventType.SLEEP),
                Metric("Wakes","${night.wakes.size}",listOf(night.wakes.count { it.heard }.let { if(it>0) "$it heard by sensor" else "from logged entries" }),EventType.SLEEP),
                Metric("Longest sleep",if(night.longestStretchMinutes>0) Dates.duration(night.longestStretchMinutes) else "—",listOf("this night"),EventType.SLEEP),
                Metric("Bedtime",night.bedtime?.let(Dates::clock) ?: "—",listOf(if(night.bedtime!=null) "logged sleep" else "not logged"),EventType.SLEEP)),ui.openDetail)
        }

        Heading("Day","7am–7pm · ${Dates.nightLabel(day.dateKey)}",level=3)
        when {
            day.upcoming -> EmptyState("Starts when the night ends.")
            !dayTracked -> EmptyState("Nothing logged this day${if(day.inProgress) " yet" else ""}.")
            else -> {
                Track(day.start,day.end,"day",day.naps,emptyList(),day.items,day.heard,emptyList(),day.openings,{ u -> ui.logSleep(u.start,u.end) },selectedCry) { selectedCry=if(selectedCry==it) null else it }
                Muted((if(day.naps.isEmpty()) "No naps logged" else "${plural(day.naps.size,"nap")} · ${Dates.duration(day.napMinutes)} in all · longest ${Dates.duration(day.longestNapMinutes)}")+
                    (if(day.inProgress) " so far" else "")+(if(day.openings.isNotEmpty()) " · tap a dashed gap to log a nap" else ""),size=12)
            }
        }

        CryPanel(ui,night.heard+day.heard,selectedCry) { selectedCry=if(selectedCry==it) null else it }

        if(nursery!=null) Disclosure("Nursery coverage") { Muted(if(night.sensor==null) "Nursery sensor: not running this night." else
            "Nursery sensor: "+(if(night.heard.isEmpty()) "no crying heard overnight" else "crying heard ${if(night.heard.size==1) "once" else "${night.heard.size} times"} overnight")+
            night.heard.count { !it.withWake }.let { if(it>0) " ($it with nothing logged, outlined — a possible wake, not counted)" else "" }+
            " · listening ${Math.round(night.sensor.coveragePercent)}% of noon to noon",size=12) }

        report?.let { r ->
            Heading("Averages",scopeLabel,level=3)
            if(r.nights.isEmpty()) EmptyState("No finished night logged ${if(scopeLabel=="selected range") "in the selected range" else scopeLabel}.") else {
                fun range(s: BabyNights.Stat)=Dates.duration(s.min).let { a -> val b=Dates.duration(s.max); if(a==b) a else "$a–$b" }
                MetricGrid(listOf(
                    Metric("Night sleep",r.sleepMinutes?.let { Dates.duration(it.average) } ?: "—",listOfNotNull(r.sleepMinutes?.let { "${range(it)} range" }),EventType.SLEEP),
                    Metric("Wakes/night",r.wakes?.let { com.babysteps.nurserysensor.care.domain.Units.stat(it.average) } ?: "—",listOfNotNull(r.wakes?.let { if(it.min==it.max) "${it.min.toInt()} range" else "${it.min.toInt()}–${it.max.toInt()} range" }),EventType.SLEEP),
                    Metric("Longest stretch",r.longestStretchMinutes?.let { Dates.duration(it.average) } ?: "—",listOfNotNull(r.longestStretchMinutes?.let { "best ${Dates.duration(it.max)}" }),EventType.SLEEP),
                    Metric("Naps/day",r.napMinutes?.let { Dates.duration(it.average) } ?: "—",listOf(r.napMinutes?.let { "${range(it)} range" } ?: "no naps logged"),EventType.SLEEP)),ui.openDetail)
                Muted("${r.nights.size} of ${plural(r.span,"night")} logged${if(r.estimatedNights>0) " · ${r.estimatedNights} with sleep estimated" else ""}",size=12)
            }
        }

        Disclosure("How sleep is estimated") { Muted("Wakes are night feeds, changes and meds logged within 30 minutes of each other. Sleep not logged as a sleep entry is estimated: the time between wakes, less ${BabyNights.SETTLE_MINUTES} minutes to settle. Crying the sensor heard is taken out of estimated sleep the same way, but it never adds a wake or changes a logged sleep: the sensor only hears what reaches the phone.",size=12) }
    }
}

@Composable
private fun Legend(items: List<Pair<String,androidx.compose.ui.graphics.Color>>) {
    ChipRow { items.forEach { (label,color) -> Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(5.dp)) { Dot(color,9.dp); Muted(label,size=11) } } }
}

/**
 * A night or a day on one track: sleep as bars (solid when logged, faded when estimated),
 * awake time as amber breaks, entries as dots, crying heard as ticks above. Tapping an
 * estimated stretch (or a gap in the day) opens the sleep form on it.
 */
@Composable
private fun Track(start: Instant,end: Instant,variant: String,sleeps: List<BabyNights.Stretch>,awake: List<Pair<Instant,Instant>>,items: List<BabyNights.Item>,
    heard: List<BabyNights.Cry>,wakeLabels: List<Instant>,targets: List<BabyNights.Unlogged>,onLog: (BabyNights.Unlogged) -> Unit,selectedCry: Instant?,onCry: (Instant) -> Unit) {
    val p=LocalPalette.current
    val text=rememberTextMeasurer()
    val s0=start.toEpochMilli(); val length=maxOf(1L,end.toEpochMilli()-s0)
    fun share(i: Instant)=((i.toEpochMilli()-s0).toDouble()/length).coerceIn(0.0,1.0).toFloat()
    val sleepTint=p.tint(EventType.SLEEP)
    val labelStyle=body(10,700).copy(color=p.muted)
    val lengthStyle=body(10,800).copy(color=if(p.dark) p.page else androidx.compose.ui.graphics.Color.White)
    Column(verticalArrangement=Arrangement.spacedBy(2.dp)) {
        // Heard crying, each bout tappable.
        Canvas(Modifier.fillMaxWidth().height(14.dp).pointerInput(heard) { detectTap { x -> heard.minByOrNull { kotlin.math.abs(share(it.start)*size.width-x) }?.let { onCry(it.start) } } }) {
            heard.forEach { c -> val x=share(c.start)*size.width; val w=maxOf(3.dp.toPx(),(share(c.end)-share(c.start))*size.width)
                val color=p.danger.copy(alpha=if(c.start==selectedCry) 1f else if(c.withWake) 0.8f else 0.45f)
                if(c.withWake) drawRoundRect(color,Offset(x,2.dp.toPx()),Size(w,size.height-4.dp.toPx()),CornerRadius(2.dp.toPx()))
                else drawRoundRect(color,Offset(x,2.dp.toPx()),Size(w,size.height-4.dp.toPx()),CornerRadius(2.dp.toPx()),style=Stroke(1.5.dp.toPx())) }
        }
        Canvas(Modifier.fillMaxWidth().height(34.dp).clip(RoundedCornerShape(6.dp)).pointerInput(targets) {
            detectTap { x -> val at=x/size.width; targets.find { t -> at>=share(t.start) && at<=share(t.end ?: end) }?.let(onLog) } }) {
            drawRect(if(variant=="day") p.pastDue.copy(alpha=0.18f) else p.panelBlue)
            sleeps.forEach { st -> val x=share(st.start)*size.width; val w=maxOf(2f,(share(st.end)-share(st.start))*size.width)
                val color=if(st.source=="logged") sleepTint else sleepTint.copy(alpha=0.45f)
                drawRect(color,Offset(x,0f),Size(w,size.height))
                if(st.source!="logged") { var hx=x; while(hx<x+w) { drawLine(sleepTint.copy(alpha=0.7f),Offset(hx,size.height),Offset(minOf(hx+8.dp.toPx(),x+w),0f),1.dp.toPx()); hx+=6.dp.toPx() } }
                if(share(st.end)-share(st.start)>=0.09f) { val m=text.measure(Dates.duration(st.minutes),lengthStyle)
                    drawText(m,topLeft=Offset(x+w/2-m.size.width/2,size.height/2-m.size.height/2)) }
            }
            awake.forEach { (a,b) -> val x=share(a)*size.width; drawRect(p.pastDue,Offset(x,0f),Size(maxOf(2f,(share(b)-share(a))*size.width),size.height)) }
            if(variant=="day") targets.forEach { t -> val x=share(t.start)*size.width; val w=(share(t.end ?: end)-share(t.start))*size.width
                drawRoundRect(sleepTint,Offset(x+1,3.dp.toPx()),Size(maxOf(2f,w-2),size.height-6.dp.toPx()),CornerRadius(4.dp.toPx()),style=Stroke(1.5.dp.toPx(),pathEffect=PathEffect.dashPathEffect(floatArrayOf(6f,5f)))) }
            items.forEach { it2 -> drawCircle(p.tint(it2.type),4.dp.toPx(),Offset(share(it2.start)*size.width,size.height/2)); drawCircle(p.panel,4.dp.toPx(),Offset(share(it2.start)*size.width,size.height/2),style=Stroke(1.dp.toPx())) }
        }
        // Sleep starts, then wakes, under the track.
        val marks=sleeps.map { it.start to sleepTint }+wakeLabels.map { it to p.danger }
        if(marks.isNotEmpty()) Canvas(Modifier.fillMaxWidth().height(28.dp)) {
            var lastEnd=-1f; var row=0
            marks.sortedBy { it.first }.forEach { (at,color) ->
                val m=text.measure(Dates.clock(at),labelStyle.copy(color=color)); val cx=share(at)*size.width
                val x=(cx-m.size.width/2).coerceIn(0f,size.width-m.size.width)
                row=if(x<lastEnd+4) 1-row else 0; lastEnd=x+m.size.width
                drawText(m,topLeft=Offset(x,row*13.dp.toPx()))
            }
        }
        Row { (0..4).forEach { i -> Text(Dates.clock(Instant.ofEpochMilli(s0+length*i/4)),Modifier.weight(1f),style=body(10,600),color=p.muted,
            textAlign=if(i==0) androidx.compose.ui.text.style.TextAlign.Start else if(i==4) androidx.compose.ui.text.style.TextAlign.End else androidx.compose.ui.text.style.TextAlign.Center) } }
    }
}

private suspend fun PointerInputScope.detectTap(onTap: (Float) -> Unit)=detectTapGestures { onTap(it.x) }

/** Every bout the sensor heard, each a chip; the log's context around one, and marking them as Crying in Mood. */
@Composable
private fun CryPanel(ui: Ui,cries: List<BabyNights.Cry>,selected: Instant?,onSelect: (Instant) -> Unit) {
    val p=LocalPalette.current
    val context=LocalContext.current
    if(cries.isEmpty()) return
    val unmarked=cries.filter { !CryContext.isMarked(it,ui.events) }
    fun mark(list: List<BabyNights.Cry>)=list.forEach { cry ->
        CareRepository.addEvent(context,JSONObject().put("babyId",ui.profile.id).put("type","mood").put("level",CryContext.CRYING_MOOD_LEVEL)
            .put("notes",CryContext.toMoodNote(cry,ui.events)).put("startedAt",isoString(cry.start)))
    }
    Column(Modifier.fillMaxWidth().clip(Radius).background(p.panelBlue).border(1.dp,p.line,Radius).padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment=Alignment.CenterVertically) {
            Ink("Crying heard",Modifier.weight(1f))
            if(unmarked.isNotEmpty()) SecondaryButton(if(unmarked.size==cries.size) "Mark all ${unmarked.size} in Mood" else "Mark ${unmarked.size} more in Mood") { mark(unmarked) }
        }
        ChipRow {
            cries.forEach { c ->
                val marked=CryContext.isMarked(c,ui.events)
                val secs=maxOf(1L,(c.end.toEpochMilli()-c.start.toEpochMilli())/1000)
                Row(Modifier.clip(RoundedCornerShape(999.dp)).background(if(c.start==selected) p.danger.copy(alpha=0.18f) else p.panel)
                    .border(1.dp,p.danger.copy(alpha=if(c.withWake) 0.7f else 0.35f),RoundedCornerShape(999.dp)).clickable { onSelect(c.start) }.padding(horizontal=10.dp,vertical=6.dp),
                    verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(4.dp)) {
                    Text("${Dates.clock(c.start)} · ${if(secs<60) "${secs}s" else Dates.duration(secs/60.0)}",style=body(12,700),color=p.ink)
                    if(marked) Icon(Lucide.check,"in Mood",tint=p.danger,modifier=Modifier.size(14.dp))
                }
            }
        }
        cries.find { it.start==selected }?.let { c ->
            val clues=CryContext.describe(CryContext.context(ui.events,c.start))
            Ink("${Dates.clock(c.start)}–${Dates.clock(c.end)} · ${plural(c.episodes,"episode")} · ${if(c.withWake) "with a logged wake" else "nothing logged near it"}",size=14)
            if(clues.isEmpty()) Muted("Nothing logged before it to go on.",size=12)
            clues.forEach { Row { Text("•  ",style=body(13),color=p.muted); Text(it.text+(if(it.due) " — past the usual gap" else ""),style=body(13,if(it.due) 700 else 500),color=if(it.due) p.danger else p.ink) } }
            if(CryContext.isMarked(c,ui.events)) Muted("In Mood as crying.",size=12) else SecondaryButton("Mark in Mood") { mark(listOf(c)) }
        }
        Muted("The sensor hears that a baby cried, not why. These are what was logged around it: pain, illness, a room too warm or cold, overstimulation or wanting company leave nothing in a log, so the baby is the one to check.",size=12)
    }
}
