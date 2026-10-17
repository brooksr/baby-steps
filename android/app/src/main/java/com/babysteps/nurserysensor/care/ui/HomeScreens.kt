package com.babysteps.nurserysensor.care.ui

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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.babysteps.nurserysensor.care.domain.Cadence
import com.babysteps.nurserysensor.care.domain.Cycle
import com.babysteps.nurserysensor.care.domain.Dates
import com.babysteps.nurserysensor.care.domain.Diapers
import com.babysteps.nurserysensor.care.domain.Expect
import com.babysteps.nurserysensor.care.domain.Growth
import com.babysteps.nurserysensor.care.domain.ParentReport
import com.babysteps.nurserysensor.care.domain.Reference
import com.babysteps.nurserysensor.care.domain.Summary
import com.babysteps.nurserysensor.care.domain.TIMER_TYPES
import com.babysteps.nurserysensor.care.domain.Units
import com.babysteps.nurserysensor.care.model.EventType
import kotlinx.coroutines.delay
import java.time.Instant

/** A clock that ticks once a second while a timer is showing, and once a minute otherwise. */
@Composable
fun rememberNow(fast: Boolean=false): Instant {
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(fast) { while(true) { now=Instant.now(); delay(if(fast) 1000 else 30_000) } }
    return now
}

/** `.profile-band`: the blue hero, name above, the big headline, and the hero metrics below. */
@Composable
fun ProfileBand(eyebrow: String,headline: String,detail: String?,big: Boolean,side: (@Composable () -> Unit)?=null,metrics: @Composable ColumnScope.() -> Unit) {
    val p=LocalPalette.current
    Column(Modifier.fillMaxWidth().clip(Radius).background(Brush.linearGradient(listOf(p.bandStart,p.bandEnd))).border(1.dp,p.bandBorder,Radius).padding(18.dp),
        verticalArrangement=Arrangement.spacedBy(16.dp)) {
        Row(verticalAlignment=Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                Text(eyebrow.uppercase(),style=body(13,800).copy(letterSpacing=0.5.sp),color=p.accent)
                Text(headline,style=display(if(big) 72 else 44).copy(lineHeight=(if(big) 70 else 46).sp),color=Color.White)
                detail?.let { Text(it,style=body(15,600),color=Color.White,modifier=Modifier.padding(top=6.dp)) }
            }
            side?.invoke()
        }
        metrics()
    }
}

/** One of the hero's three tiles; amber when its rhythm has run out. */
@Composable
fun HeroMetric(label: String,value: String,sub: String,detail: String?,pastDue: Boolean,modifier: Modifier,inRange: Boolean=false,onClick: (() -> Unit)?) {
    val p=LocalPalette.current
    val fg=if(pastDue) p.onPastDue else Color.White
    val scale=LocalDensity.current.fontScale
    Column(modifier.clip(Radius).background(if(pastDue) p.pastDue else Color.White.copy(alpha=0.16f)).then(if(onClick!=null) Modifier.clickable(onClick=onClick) else Modifier)
        .padding(horizontal=12.dp,vertical=10.dp),verticalArrangement=Arrangement.spacedBy(2.dp)) {
        Text(label.uppercase(),style=body(11,800).copy(letterSpacing=0.4.sp),color=fg.copy(alpha=0.85f),maxLines=2,modifier=Modifier.heightIn(min=(28*scale).dp))
        Text(value,style=body(19,800),color=if(inRange && !pastDue) p.pastDue else fg,maxLines=1,modifier=Modifier.heightIn(min=(26*scale).dp))
        Text(sub.replace(" · ","\n"),style=body(12,700),color=fg.copy(alpha=0.82f),maxLines=2,modifier=Modifier.heightIn(min=(36*scale).dp))
        detail?.let {
            Box(Modifier.fillMaxWidth().padding(top=6.dp).height(1.dp).background(fg.copy(alpha=0.24f)))
            Text(it,style=body(12,700),color=fg,modifier=Modifier.padding(top=4.dp))
        }
    }
}

/** `.quick-grid`: three to a row, tinted by entry family; a running timer pulses under its label. */
@Composable
fun QuickGrid(actions: List<Triple<EventType,String,androidx.compose.ui.graphics.vector.ImageVector>>,timers: Map<EventType,Instant>,onAdd: (EventType) -> Unit) {
    val p=LocalPalette.current
    val anyTimer=timers.isNotEmpty()
    val now=rememberNow(anyTimer)
    val pulse=if(anyTimer) pulse() else 1f
    Column(verticalArrangement=Arrangement.spacedBy(10.dp)) {
        actions.chunked(3).forEach { row ->
            Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                row.forEach { (type,label,icon) ->
                    val timer=if(type in TIMER_TYPES) timers[type] else null
                    Column(Modifier.weight(1f).heightIn(min=82.dp).clip(Radius).background(if(timer!=null) p.blue100 else p.fill(type))
                        .border(1.dp,if(timer!=null) p.blue400 else p.line,Radius).clickable { onAdd(type) }.padding(vertical=12.dp,horizontal=8.dp),
                        horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(6.dp,Alignment.CenterVertically)) {
                        Icon(icon,null,tint=if(timer!=null) p.blue700 else p.tint(type),modifier=Modifier.size(22.dp))
                        Text(label,style=body(14,800),color=if(timer!=null) p.blue700 else p.ink)
                        timer?.let { Text(Dates.elapsed(Dates.elapsedSeconds(it,now)),style=body(12,700),color=p.blue700,modifier=Modifier.alpha(pulse)) }
                    }
                }
                repeat(3-row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

private val CHILD_ACTIONS=listOf(
    Triple(EventType.FEED,"Feed",Lucide.milk),Triple(EventType.PUMP,"Pump",Lucide.droplets),Triple(EventType.DIAPER,"Diaper",Lucide.wind),
    Triple(EventType.TUMMYTIME,"Tummy",Lucide.dumbbell),Triple(EventType.BATH,"Bath",Lucide.bath),Triple(EventType.SLEEP,"Sleep",Lucide.bed),
    Triple(EventType.MEDICATION,"Med",Lucide.pill),Triple(EventType.APPOINTMENT,"Visit",Lucide.calendar),Triple(EventType.GROWTH,"Growth",Lucide.ruler),
    Triple(EventType.TEMPERATURE,"Temp",Lucide.thermometer),Triple(EventType.MOOD,"Mood",Lucide.smile),Triple(EventType.NOTE,"Note",Lucide.fileText))

@Composable
fun ChildHome(ui: Ui) {
    val p=LocalPalette.current
    val profile=ui.profile; val events=ui.events
    val now=rememberNow()
    val today=Dates.key(now)
    val born=profile.birthDate!=null; val hasDue=profile.dueDate!=null
    val untilDue=Dates.daysUntilDue(profile,now); val ageDays=Dates.ageDays(profile,now)
    val todayEvents=events.filter { Dates.key(it.start)==today }.sortedByDescending { it.start }
    val summary=Summary.daily(todayEvents)
    val lastFeed=Summary.last(events) { it.type==EventType.FEED }
    val nextFeed=if(ui.timers.containsKey(EventType.FEED)) null else Cadence.nextFeed(events,now)
    val lastNursing=Summary.last(events) { it.isNursing }
    val nextSide=lastNursing?.let { when(it.side) { "left" -> "right"; "right" -> "left"; else -> "either" } }
    val lastDiaper=Summary.last(events) { it.type==EventType.DIAPER }
    val nextDiaper=remember(events,now.epochSecond/60) { Diapers.predict(events,now) }
    val lastBath=Summary.last(events) { it.type==EventType.BATH }
    val nextBath=Cadence.nextBath(events,now)
    val reminders=Cadence.reminders(events,ui.timers.containsKey(EventType.FEED),now)
    fun day(key: String)=if(key==today) "Today" else Dates.weekday(key)
    val ageDetail=if(born) { if(ageDays>=14) { if(ageDays>=56) "${ageDays/7} weeks · ${Dates.dueStatus(profile,now)}" else Dates.dueStatus(profile,now) } else "" }
        else if(hasDue) (if(untilDue==1) "day until due date" else "days until due date") else "Add a due date or birth date in Settings."
    val activeSleep=Summary.activeSleep(events)
    val lastTemp=events.firstOrNull { it.type==EventType.TEMPERATURE }
    val band=lastTemp?.let { Reference.classifyTemperature(it.celsius) }
    val fever=band?.band=="Fever" || band?.band=="High fever"

    ProfileBand(profile.name,if(born) Dates.ageSummary(profile,now) else if(hasDue) untilDue.toString() else "Welcome",ageDetail.ifEmpty { null },big=!born && hasDue,
        side=if(!born) ({
            if(!ui.caregiver) Row(Modifier.clip(Radius).background(Color.White).clickable { ui.onAdd(EventType.BIRTH) }.padding(horizontal=14.dp,vertical=11.dp),
                verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                Icon(Lucide.heart,null,tint=p.ink,modifier=Modifier.size(20.dp)); Text("Log birth",style=body(15,800),color=Color(0xFF20384B))
            }
        }) else null) {
        if(lastFeed!=null || lastDiaper!=null || lastBath!=null) Row(Modifier.height(IntrinsicSize.Min),horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            val m=Modifier.weight(1f).fillMaxHeight()
            if(lastFeed!=null) HeroMetric("Last feed",Dates.ago(lastFeed.start,now).removeSuffix(" ago"),Dates.clock(lastFeed.start),
                nextFeed?.let { (if(it.minutesAway>0) "Next ~${Dates.clockRange(it.windowStart,it.windowEnd)}" else "Due now")+(nextSide?.let { s -> " · $s" } ?: "") },
                nextFeed?.windowEnd?.let(now::isAfter)==true,m,Cadence.inWindow(nextFeed?.windowStart,nextFeed?.windowEnd,now),if(ui.caregiver) null else ({ ui.openLog(EventType.FEED) }))
            if(lastDiaper!=null) HeroMetric("Last diaper",Dates.ago(lastDiaper.start,now).removeSuffix(" ago"),Dates.clock(lastDiaper.start),
                nextDiaper?.let { (if(!now.isAfter(it.windowEnd)) "Next ~${Dates.clockRange(it.windowStart,it.windowEnd)}" else "Likely now")+" · ${it.likelyKind}" },
                nextDiaper?.windowEnd?.let(now::isAfter)==true,m,Cadence.inWindow(nextDiaper?.windowStart,nextDiaper?.windowEnd,now),if(ui.caregiver) null else ({ ui.openLog(EventType.DIAPER) }))
            if(lastBath!=null) HeroMetric("Last bath",Dates.daysSince(lastBath.start,now),"${Dates.shortDate(lastBath.start)} · ${Dates.clock(lastBath.start)}",
                nextBath?.let { if(it.due) "Due today" else "Next ${day(it.windowStartKey)}–${day(it.windowEndKey)}" },nextBath?.due==true,m,Cadence.inWindow(nextBath?.windowStart,nextBath?.windowEnd,now),if(ui.caregiver) null else ({ ui.openLog(EventType.BATH) }))
        }
    }

    QuickGrid(CHILD_ACTIONS,ui.timers,ui.onAdd)

    if(fever && lastTemp!=null) StatusRow(Lucide.triangleAlert,"${profile.firstName} has a fever — ${Units.temperature(lastTemp.celsius,profile.metric)}",
        (if(ageDays<90) "Under 3 months, a fever is worth a call to your doctor now." else "Keep ${profile.firstName} comfortable and hydrated; call your doctor if it climbs or persists.")+" · ${Dates.clock(lastTemp.start)}","urgent")
    reminders.filter { it.kind!="bath" }.forEach { StatusRow(if(it.kind=="feed") Lucide.milk else Lucide.bath,it.title,it.message,"gentle") }

    NewbornStatus(ui,today,"Today's newborn check")
    WhatToExpectCard(ui)

    val meds=Summary.upcomingMedications(events,now).take(3); val visits=Summary.upcomingAppointments(events,now).take(3)
    meds.forEach { StatusRow(Lucide.pill,it.medicationName,"${it.dose} · ${Dates.clock(com.babysteps.nurserysensor.care.model.parseInstant(it.scheduledAt) ?: it.start)}","urgent") }
    visits.forEach { StatusRow(Lucide.calendar,it.reason,Dates.clock(it.start)+(it.location?.let { l -> " · $l" } ?: "")) }

    Panel {
        Heading("Today",subtitle="${summary.feedCount} feeds · ${summary.wetDiapers+summary.dirtyDiapers} diapers")
        val sleep=if(activeSleep!=null) Dates.duration(Dates.minutesBetween(activeSleep.start,now)) else Dates.duration(summary.sleepMinutes)
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            listOf("Sleep" to sleep,"Milk out" to Units.volume(summary.pumpOunces,profile.metric),"Wet" to "${summary.wetDiapers}","Dirty" to "${summary.dirtyDiapers}").forEach { (label,value) ->
                Column(Modifier.weight(1f).clip(Radius).background(p.panelBlue).border(1.dp,p.line,Radius).padding(10.dp)) {
                    Muted(label,size=12); Text(value,style=display(17),color=p.ink,maxLines=1)
                }
            }
        }
        Timeline(todayEvents.take(8),profile,ui.profiles,"No entries for today.")
    }
}

/** `components/NewbornStatus.tsx`: the day's diapers and feeds against the first weeks' minimums, judged on pace mid-day. */
@Composable
fun NewbornStatus(ui: Ui,dateKey: String,heading: String) {
    val p=LocalPalette.current
    val now=rememberNow()
    val day=Growth.assessNewbornDay(ui.profile,ui.events,dateKey,now) ?: return
    val behind=!day.onTrack; val onPace=day.onTrack && day.stillCounting
    val (pill,pillColor)=if(behind) "Below range" to p.danger else if(onPace) "On pace so far" to p.blue700 else "In range" to Color(0xFF3D8046).let { if(p.dark) Color(0xFF86C98D) else it }
    Panel {
        Heading(heading,"Day ${day.dayOfLife} of life"+if(day.dayComplete) "" else " · ${Math.round(day.dayProgress*100)}% of the day so far") {
            Text(pill,Modifier.clip(RoundedCornerShape(999.dp)).background(pillColor.copy(alpha=0.14f)).padding(horizontal=10.dp,vertical=4.dp),style=body(12,800),color=pillColor)
        }
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            day.checks.forEach { c ->
                val color=when(c.status) { "below" -> p.danger; "pending" -> p.blue700; else -> if(p.dark) Color(0xFF86C98D) else Color(0xFF3D8046) }
                Column(Modifier.weight(1f).clip(Radius).background(p.panelBlue).border(1.dp,p.line,Radius).padding(10.dp),verticalArrangement=Arrangement.spacedBy(2.dp)) {
                    Icon(when(c.status) { "below" -> Lucide.triangleAlert; "pending" -> Lucide.hourglass; else -> Lucide.check },null,tint=color,modifier=Modifier.size(18.dp))
                    Text("${c.count}",style=display(22),color=p.ink)
                    Muted(c.label,size=12)
                    Text(if(!day.dayComplete && c.status!="within") "${c.expectedByNow} by now · ${c.expectedMin} by bedtime" else "expect ≥ ${c.expectedMin}",style=body(11,700),color=p.muted)
                }
            }
        }
        Muted(day.expectation.note)
        if(behind) FieldNote(if(day.dayComplete) "A quiet day or two can be normal — keep offering feeds and watch the next nappies. If the low days continue or ${ui.profile.firstName} seems unwell, check in with your pediatrician."
            else "Running behind the usual pace for this point in the day — offer a feed and watch the next nappy. If it stays low or ${ui.profile.firstName} seems unwell, check in with your pediatrician.",flagged=true)
    }
}

/** `components/WhatToExpect.tsx`: this week of the pregnancy, or this stretch of life. */
@Composable
fun WhatToExpectCard(ui: Ui) {
    val p=LocalPalette.current
    var collapsed by rememberSaveable(ui.profile.id) { mutableStateOf(false) }
    var at by remember(ui.profile.id) { mutableStateOf<Instant?>(null) }
    val current=at ?: Instant.now()
    val outlook=remember(ui.profile,ui.events,current) { Expect.outlook(ui.profile,current,ui.events) } ?: return
    val prev=remember(outlook,current) { Expect.adjacent(ui.profile,ui.events,outlook,current,-1) }
    val next=remember(outlook,current) { Expect.adjacent(ui.profile,ui.events,outlook,current,1) }
    val name=Expect.firstName(ui.profile)
    Panel {
        Heading("What to expect") { IconAction(if(collapsed) Lucide.chevronRight else Lucide.chevronDown,if(collapsed) "Expand what to expect" else "Collapse what to expect") { collapsed=!collapsed } }
        if(collapsed) return@Panel
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            SecondaryButton("Previous",icon=Lucide.chevronLeft,enabled=prev!=null) { at=prev }
            if(at!=null) SecondaryButton("Today") { at=null }
            SecondaryButton("Next",enabled=next!=null) { at=next }
        }
        @Composable fun facet(icon: androidx.compose.ui.graphics.vector.ImageVector,label: String,text: String) =
            Row(Modifier.fillMaxWidth().clip(Radius).background(p.panelBlue).border(1.dp,p.line,Radius).padding(12.dp),horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                Icon(icon,null,tint=p.blue700,modifier=Modifier.size(20.dp))
                Column { Text(label,style=body(14,800),color=p.ink); Text(text,style=body(14),color=p.ink) }
            }
        @Composable fun facts(list: List<String>)=list.forEach { Row { Text("•  ",style=body(14),color=p.blue700); Text(it,style=body(14),color=p.ink) } }
        when(outlook) {
            is Expect.Pregnancy -> {
                val d=outlook.daysUntilDue
                val countdown=if(d>0) "$d day${if(d==1) "" else "s"} to go" else if(d==0) "due today" else "${-d} day${if(d==-1) "" else "s"} past the due date"
                Column { Text("Week ${outlook.gestationWeeks}",style=display(22),color=p.ink); Muted("${outlook.week.trimester} trimester · $countdown") }
                facet(Lucide.ruler,"About the size of",outlook.week.size)
                facet(Lucide.baby,"Developing now",outlook.week.development)
                facet(Lucide.lightbulb,"Heads up",outlook.week.headsUp)
                Disclosure("Notes & context") { facts(outlook.week.facts); Muted("General guidance, not a schedule. Bring concerns to your pediatrician.",size=12) }
            }
            is Expect.Child -> {
                val stage=outlook.stage
                if(stage==null) {
                    Text("Past two years",style=display(22),color=p.ink)
                    Ink("Day-to-day guidance here is written through age two. Beyond it, the Care tab still tracks milestones and immunisations, and your pediatrician is the better guide.",size=14,weight=500)
                } else {
                    Column { Text(stage.label,style=display(22),color=p.ink); Muted(if(outlook.corrected) "At corrected age" else "$name right now") }
                    Ink(stage.summary,size=15,weight=600)
                    facet(Lucide.sparkles,"Development",stage.development)
                    facet(Lucide.milk,"Feeding",stage.feeding)
                    facet(Lucide.moon,"Sleep",stage.sleep)
                    facet(Lucide.lightbulb,"Heads up",stage.headsUp)
                    Disclosure("Notes & context") {
                    facts(stage.facts)
                    outlook.notes.forEach { StatusRow(Lucide.sparkles,it,tone="gentle") }
                    val g=outlook.gestation
                    if(outlook.corrected && g!=null) FieldNote("Born at ${g.label}, ${g.correctionDays} days early. "+
                        (if(outlook.stageAgeDays>outlook.correctedAgeDays) "Corrected age is ${outlook.correctedAgeDays} days, so this stays at the end of the newborn window until it catches up."
                        else "Skills are shown at $name’s corrected age of ${outlook.correctedAgeDays} days.")+" Feeding and diapers still run on the actual ${outlook.ageDays} days.")
                    Muted("General guidance, not a schedule. Bring concerns to your pediatrician.",size=12)
                    }
                }
            }
        }
    }
}

private val PARENT_ACTIONS=listOf(
    Triple(EventType.INTAKE,"Input",Lucide.utensils),Triple(EventType.OUTPUT,"Output",Lucide.toilet),Triple(EventType.SLEEP,"Sleep",Lucide.bed),
    Triple(EventType.MOOD,"Mood",Lucide.smile),Triple(EventType.TEMPERATURE,"Temp",Lucide.thermometer),Triple(EventType.MEDICATION,"Med",Lucide.pill),
    Triple(EventType.APPOINTMENT,"Visit",Lucide.calendar),Triple(EventType.NOTE,"Note",Lucide.fileText))

private fun dueIn(days: Int)=when { days>1 -> "in $days days"; days==1 -> "tomorrow"; days==0 -> "today"; else -> "${-days} day${if(days==-1) "" else "s"} late" }

@Composable
fun ParentHome(ui: Ui) {
    val profile=ui.profile; val events=ui.events
    val now=rememberNow()
    val showsCycle=profile.tracksCycle
    val cycle=if(showsCycle) Cycle.today(events,now,Cycle.context(ui.profiles)) else null
    val tile=cycle?.let(Cycle::describe)
    val report=remember(events,ui.childEvents) { ParentReport.report(events,ui.childEvents,profile.id) }
    val lastNight=report.nights.lastOrNull()
    val recent=lastNight!=null && lastNight.dateKey>=Dates.key(now.minusSeconds(86_400))
    val lastSleep=Summary.last(events) { it.type==EventType.SLEEP }
    val asleep=lastSleep!=null && lastSleep.end==null
    val lastTemp=events.firstOrNull { it.type==EventType.TEMPERATURE }
    val today=Dates.key(now)
    val todayEvents=events.filter { Dates.key(it.start)==today || (it.end!=null && Dates.key(it.end)==today) }

    ProfileBand(profile.name,if(recent) Dates.duration(lastNight!!.sleepMinutes) else "—",
        if(recent) "slept last night · ${Dates.duration(lastNight!!.inBedMinutes)} in bed · ${lastNight.interruptions} wake-up${if(lastNight.interruptions==1) "" else "s"}" else "no sleep logged yet",big=false) {
        Row(Modifier.height(IntrinsicSize.Min),horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            val m=Modifier.weight(1f).fillMaxHeight()
            HeroMetric(if(asleep) "Asleep for" else "Awake for",lastSleep?.let { Dates.duration(Dates.minutesBetween(it.end ?: it.start,now)) } ?: "None",
                lastSleep?.let { Dates.clock(it.start)+(it.end?.let { e -> " – ${Dates.clock(e)}" } ?: "") } ?: "Nothing logged yet",null,false,m,onClick=null)
            HeroMetric(if(showsCycle) (if(cycle==null || cycle.status=="cycling") "Cycle day" else "Cycle") else "Nights logged",
                if(showsCycle) tile?.first ?: "—" else "${report.nights.size}",
                if(showsCycle) tile?.second ?: "No period logged yet" else report.averageSleep?.let { "${Dates.duration(it)} average" } ?: "Nothing logged yet",null,false,m,onClick=null)
        }
    }

    QuickGrid(if(showsCycle) PARENT_ACTIONS+Triple(EventType.MENSES,"Period",Lucide.waves) else PARENT_ACTIONS,ui.timers,ui.onAdd)

    if(cycle?.status=="cycling" && cycle.prediction!=null) {
        val pr=cycle.prediction
        StatusRow(Lucide.waves,"Period ${cycle.daysUntilNextPeriod?.let(::dueIn) ?: "due"} · ${Dates.shortDate(pr.nextPeriodKey)}",
            "${Dates.shortDate(pr.windowStartKey)}–${Dates.shortDate(pr.windowEndKey)} · ${pr.basis} · ${pr.confidence} confidence")
        StatusRow(Lucide.moon,"Fertile window ${Dates.shortDate(pr.fertileStartKey)}–${Dates.shortDate(pr.fertileEndKey)}",
            "Ovulation estimated ${Dates.shortDate(pr.ovulationKey)} — an estimate from logged dates, not contraception and not a fertility test.","gentle")
    }
    if(showsCycle) when {
        cycle?.status=="pregnant" -> FieldNote("Cycle tracking is paused while a baby is on the way. It picks up again from the first period after the birth — the ones logged before are left where they are.")
        cycle?.status=="postpartum" -> FieldNote("Cycles often take months to return, longer while breastfeeding. Ovulation comes first, so it can happen before any period. Log the days when it returns.")
        cycle==null || (cycle.status=="cycling" && cycle.prediction==null) -> FieldNote("Log the days of a period and BabySteps works out the cycle. It needs two cycles before it will estimate the next one — until then it stays quiet rather than guessing.")
    }

    MetricGrid(listOf(
        Metric("Sleep/night",report.averageSleep?.let { Dates.duration(it) } ?: "—",listOf(if(report.nights.isNotEmpty()) "rest, over ${report.nights.size} night${if(report.nights.size==1) "" else "s"}" else "Nothing logged yet")),
        Metric("Longest stretch",report.averageLongest?.let { Dates.duration(it) } ?: "—",listOf("avg unbroken run"+(report.bestStretch?.let { " · best ${Dates.duration(it)}" } ?: ""))),
        Metric("Wake-ups",report.averageInterruptions?.let { Units.stat(it) } ?: "—",listOf("per night"))),ui.openDetail)

    lastTemp?.let { StatusRow(Lucide.circleAlert,"Last temperature — ${Units.temperature(it.celsius,profile.metric)}","${Dates.shortDate(it.start)} · ${Dates.clock(it.start)}") }

    Panel {
        Heading("Today",subtitle="${todayEvents.size} entr${if(todayEvents.size==1) "y" else "ies"}")
        Timeline(todayEvents,profile,ui.profiles,"Nothing logged for ${profile.firstName} today.")
    }
}
