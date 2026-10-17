package com.babysteps.nurserysensor.care.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.babysteps.nurserysensor.care.domain.DateRange
import com.babysteps.nurserysensor.care.domain.Dates
import com.babysteps.nurserysensor.care.domain.EventText
import com.babysteps.nurserysensor.care.domain.Family
import com.babysteps.nurserysensor.care.domain.FirstYear
import com.babysteps.nurserysensor.care.domain.Units
import com.babysteps.nurserysensor.care.model.CareEvent
import com.babysteps.nurserysensor.care.model.EventType
import com.babysteps.nurserysensor.care.model.Profile
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset

val Radius=RoundedCornerShape(8.dp)

/** `.section-block` / `.metric-card`: a panel with a hairline, and the entry family's hue down its leading edge. */
@Composable
fun Panel(modifier: Modifier=Modifier,event: EventType?=null,padding: Dp=16.dp,onClick: (() -> Unit)?=null,content: @Composable ColumnScope.() -> Unit) {
    val p=LocalPalette.current
    val edge=event?.let { p.tint(it) }
    Column(modifier.fillMaxWidth().clip(Radius).background(p.panel).border(1.dp,p.line,Radius)
        .then(if(edge!=null) Modifier.drawBehind { drawRect(edge,size=Size(3.dp.toPx(),size.height)) } else Modifier)
        .then(if(onClick!=null) Modifier.clickable(onClick=onClick) else Modifier).padding(padding),verticalArrangement=Arrangement.spacedBy(10.dp),content=content)
}

/** Optional context stays available without crowding the primary reading. */
@Composable
fun Disclosure(title: String,content: @Composable ColumnScope.() -> Unit) {
    var open by rememberSaveable(title) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        SecondaryButton(title,icon=if(open) Lucide.chevronDown else Lucide.chevronRight) { open=!open }
        if(open) content()
    }
}

@Composable
fun Heading(title: String,subtitle: String?=null,level: Int=2,trailing: (@Composable () -> Unit)?=null) {
    val p=LocalPalette.current
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
        Column(Modifier.weight(1f)) {
            Text(title,style=display(if(level==1) 26 else if(level==2) 20 else 17),color=p.ink)
            subtitle?.let { Text(it,style=body(13),color=p.muted) }
        }
        trailing?.invoke()
    }
}

@Composable fun Muted(text: String,modifier: Modifier=Modifier,size: Int=13) = Text(text,modifier,style=body(size),color=LocalPalette.current.muted)
@Composable fun Ink(text: String,modifier: Modifier=Modifier,size: Int=15,weight: Int=600) = Text(text,modifier,style=body(size,weight),color=LocalPalette.current.ink)
@Composable fun EmptyState(text: String) = Text(text,Modifier.fillMaxWidth().padding(vertical=6.dp),style=body(14),color=LocalPalette.current.muted,fontStyle=FontStyle.Normal)

/** `.field-note`: guidance under a control; `flagged` is the one worth a call. */
@Composable
fun FieldNote(text: String,flagged: Boolean=false) {
    val p=LocalPalette.current
    Text(text,Modifier.fillMaxWidth().then(if(flagged) Modifier.clip(Radius).background(p.danger.copy(alpha=0.1f)).padding(10.dp) else Modifier),
        style=body(13),color=if(flagged) p.danger else p.muted)
}

/** One card on a report grid; tapping it opens what it measured and how to read it (`ReportExplorer`). */
data class Metric(val title: String,val value: String,val notes: List<String> = emptyList(),val event: EventType?=null)

@Composable
fun MetricCard(metric: Metric,modifier: Modifier=Modifier,onOpen: ((Metric) -> Unit)?=null) {
    val p=LocalPalette.current
    Panel(modifier.heightIn(min=92.dp),event=metric.event,padding=14.dp,onClick=onOpen?.let { { it(metric) } }) {
        Column(verticalArrangement=Arrangement.spacedBy(4.dp)) {
            Text(metric.title,style=body(13,600),color=p.muted)
            Text(metric.value,style=display(22),color=p.ink)
            metric.notes.forEach { Text(it,style=body(12,700),color=p.muted) }
        }
    }
}

/** Two to a row, the way `.metric-grid` lays them out. */
@Composable
fun MetricGrid(metrics: List<Metric>,onOpen: ((Metric) -> Unit)?=null) {
    Column(verticalArrangement=Arrangement.spacedBy(10.dp)) {
        metrics.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min),horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                row.forEach { MetricCard(it,Modifier.weight(1f).fillMaxHeight(),onOpen) }
                if(row.size==1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

/** `.status-row`: an alert, a reminder, a contact. */
@Composable
fun StatusRow(icon: ImageVector,title: String,text: String?=null,tone: String="normal",role: String?=null,content: (@Composable ColumnScope.() -> Unit)?=null) {
    val p=LocalPalette.current
    val (bg,fg,border)=when(tone) {
        "urgent" -> Triple(p.danger.copy(alpha=if(p.dark) 0.16f else 0.08f),p.danger,p.danger.copy(alpha=0.4f))
        "gentle" -> Triple(p.accent.copy(alpha=if(p.dark) 0.14f else 0.18f),if(p.dark) p.accent else p.accentStrong,p.accent.copy(alpha=0.5f))
        else -> Triple(p.panel,p.blue700,p.line)
    }
    Row(Modifier.fillMaxWidth().clip(Radius).background(bg).border(1.dp,border,Radius).padding(14.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        Icon(icon,null,tint=fg,modifier=Modifier.size(20.dp))
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
            role?.let { Text(it.uppercase(),style=body(11,700).copy(letterSpacing=0.5.sp),color=p.muted) }
            Text(title,style=body(15,700),color=p.ink)
            text?.let { Text(it,style=body(13),color=p.muted) }
            content?.invoke(this)
        }
    }
}

/** `.segmented-control`. */
@Composable
fun <T> Segmented(options: List<Pair<T,String>>,selected: T,modifier: Modifier=Modifier,scroll: Boolean=false,onSelect: (T) -> Unit) {
    val p=LocalPalette.current
    val row: @Composable RowScope.() -> Unit={
        options.forEach { (value,label) ->
            val on=value==selected
            Box(Modifier.then(if(scroll) Modifier else Modifier.weight(1f)).clip(RoundedCornerShape(6.dp)).background(if(on) p.blue500 else Color.Transparent)
                .clickable { onSelect(value) }.padding(horizontal=12.dp,vertical=8.dp),contentAlignment=Alignment.Center) {
                Text(label,style=body(13,700),color=if(on) (if(p.dark) p.page else Color.White) else p.ink,maxLines=1)
            }
        }
    }
    Row(modifier.clip(Radius).background(if(p.dark) p.panel else p.blue50).border(1.dp,p.line,Radius).padding(3.dp)
        .then(if(scroll) Modifier.horizontalScroll(rememberScrollState()) else Modifier),horizontalArrangement=Arrangement.spacedBy(2.dp),content=row)
}

@Composable
fun PrimaryButton(text: String,modifier: Modifier=Modifier,icon: ImageVector?=null,enabled: Boolean=true,onClick: () -> Unit) {
    val p=LocalPalette.current
    Button(onClick,modifier.heightIn(min=46.dp),enabled=enabled,shape=Radius,colors=ButtonDefaults.buttonColors(containerColor=p.blue500,contentColor=if(p.dark) p.page else Color.White)) {
        icon?.let { Icon(it,null,Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text,style=body(15,700),maxLines=1,overflow=TextOverflow.Ellipsis)
    }
}

@Composable
fun SecondaryButton(text: String,modifier: Modifier=Modifier,icon: ImageVector?=null,enabled: Boolean=true,danger: Boolean=false,onClick: () -> Unit) {
    val p=LocalPalette.current
    OutlinedButton(onClick,modifier.heightIn(min=44.dp),enabled=enabled,shape=Radius,border=BorderStroke(1.dp,if(danger) p.danger else p.lineStrong),
        colors=ButtonDefaults.outlinedButtonColors(containerColor=p.panel,contentColor=if(danger) p.danger else p.ink)) {
        icon?.let { Icon(it,null,Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text,style=body(14,700),maxLines=1,overflow=TextOverflow.Ellipsis)
    }
}

@Composable
fun IconAction(icon: ImageVector,label: String,tint: Color=LocalPalette.current.muted,onClick: () -> Unit) {
    IconButton(onClick,Modifier.size(40.dp)) { Icon(icon,label,tint=tint,modifier=Modifier.size(20.dp)) }
}

/** `.tag-chip`. */
@Composable
fun Chip(text: String,selected: Boolean=false,onClick: () -> Unit) {
    val p=LocalPalette.current
    Box(Modifier.clip(RoundedCornerShape(999.dp)).background(if(selected) p.blue500 else p.panel).border(1.dp,if(selected) p.blue500 else p.lineStrong,RoundedCornerShape(999.dp))
        .clickable(onClick=onClick).padding(horizontal=12.dp,vertical=7.dp)) {
        Text(text,style=body(13,700),color=if(selected) (if(p.dark) p.page else Color.White) else p.ink)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChipRow(content: @Composable FlowRowScope.() -> Unit) = FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp),verticalArrangement=Arrangement.spacedBy(6.dp),content=content)

// ── Form fields ─────────────────────────────────────────────────────────────────

@Composable
fun FieldLabel(label: String,hint: String?=null) {
    val p=LocalPalette.current
    Row(verticalAlignment=Alignment.Bottom) {
        Text(label,style=body(13,700),color=p.ink)
        hint?.let { Text("  $it",style=body(12),color=p.muted) }
    }
}

@Composable
fun TextInput(label: String,value: String,onChange: (String) -> Unit,modifier: Modifier=Modifier,hint: String?=null,placeholder: String?=null,
    number: Boolean=false,singleLine: Boolean=true,minLines: Int=1,keyboard: KeyboardType?=null,secret: Boolean=false) {
    val p=LocalPalette.current
    Column(modifier,verticalArrangement=Arrangement.spacedBy(4.dp)) {
        FieldLabel(label,hint)
        OutlinedTextField(value,onChange,Modifier.fillMaxWidth(),singleLine=singleLine,minLines=minLines,textStyle=body(15),shape=Radius,
            placeholder=placeholder?.let { { Text(it,style=body(14),color=p.muted) } },
            visualTransformation=if(secret) androidx.compose.ui.text.input.PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
            keyboardOptions=KeyboardOptions(keyboardType=keyboard ?: if(number) KeyboardType.Decimal else KeyboardType.Text),
            colors=OutlinedTextFieldDefaults.colors(focusedContainerColor=p.panel,unfocusedContainerColor=p.panel,unfocusedBorderColor=p.lineStrong,focusedBorderColor=p.blue500))
    }
}

/** A select: the field shows the choice, a tap opens the list. */
@Composable
fun <T> Select(label: String,options: List<Pair<T,String>>,selected: T,modifier: Modifier=Modifier,hint: String?=null,enabled: Boolean=true,onSelect: (T) -> Unit) {
    val p=LocalPalette.current
    var open by remember { mutableStateOf(false) }
    Column(modifier,verticalArrangement=Arrangement.spacedBy(4.dp)) {
        FieldLabel(label,hint)
        Box {
            Row(Modifier.fillMaxWidth().clip(Radius).background(p.panel).border(1.dp,p.lineStrong,Radius).clickable(enabled=enabled) { open=true }
                .padding(horizontal=14.dp,vertical=13.dp).alpha(if(enabled) 1f else 0.5f),verticalAlignment=Alignment.CenterVertically) {
                Text(options.find { it.first==selected }?.second ?: "",Modifier.weight(1f),style=body(15),color=p.ink,maxLines=1,overflow=TextOverflow.Ellipsis)
                Icon(Lucide.chevronDown,null,tint=p.muted,modifier=Modifier.size(18.dp))
            }
            DropdownMenu(open,{ open=false },Modifier.heightIn(max=360.dp)) {
                options.forEach { (value,text) -> DropdownMenuItem(text={ Text(text,style=body(15,if(value==selected) 700 else 500)) },onClick={ open=false; onSelect(value) }) }
            }
        }
    }
}

/** A local date and time, picked in two steps; `clearable` lets an optional time go back to empty. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateTimeInput(label: String,value: Instant?,onChange: (Instant?) -> Unit,modifier: Modifier=Modifier,hint: String?=null,clearable: Boolean=false,dateOnly: Boolean=false) {
    val p=LocalPalette.current
    var pickingDate by remember { mutableStateOf(false) }
    var pendingDate by remember { mutableStateOf<LocalDate?>(null) }
    val local=value?.atZone(Dates.zone)
    Column(modifier,verticalArrangement=Arrangement.spacedBy(4.dp)) {
        FieldLabel(label,hint)
        Row(Modifier.fillMaxWidth().clip(Radius).background(p.panel).border(1.dp,p.lineStrong,Radius).clickable { pickingDate=true }
            .padding(horizontal=14.dp,vertical=13.dp),verticalAlignment=Alignment.CenterVertically) {
            Text(value?.let { if(dateOnly) Dates.fullDate(it) else "${Dates.fullDate(it)} · ${Dates.clock(it)}" } ?: "Not set",Modifier.weight(1f),style=body(15),color=if(value==null) p.muted else p.ink)
            if(clearable && value!=null) Icon(Lucide.x,"Clear",tint=p.muted,modifier=Modifier.size(18.dp).clickable { onChange(null) })
            else Icon(Lucide.calendar,null,tint=p.muted,modifier=Modifier.size(18.dp))
        }
    }
    if(pickingDate) {
        val state=rememberDatePickerState(initialSelectedDateMillis=(local?.toLocalDate() ?: LocalDate.now()).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(onDismissRequest={ pickingDate=false },confirmButton={ TextButton({
            val picked=state.selectedDateMillis?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() }
            pickingDate=false
            if(picked!=null) { if(dateOnly) onChange(picked.atTime(12,0).atZone(Dates.zone).toInstant()) else pendingDate=picked }
        }) { Text("OK") } },dismissButton={ TextButton({ pickingDate=false }) { Text("Cancel") } }) { DatePicker(state) }
    }
    pendingDate?.let { date ->
        val time=local?.toLocalTime() ?: LocalTime.now()
        val state=rememberTimePickerState(time.hour,time.minute,is24Hour=!Dates.clock(Instant.parse("2000-01-01T15:00:00Z")).contains("M",ignoreCase=true))
        AlertDialog(onDismissRequest={ pendingDate=null },confirmButton={ TextButton({ pendingDate=null; onChange(date.atTime(state.hour,state.minute).atZone(Dates.zone).toInstant()) }) { Text("OK") } },
            dismissButton={ TextButton({ pendingDate=null }) { Text("Cancel") } },text={ TimePicker(state) })
    }
}

/** A calendar day as a key, or empty. */
@Composable
fun DateKeyInput(label: String,value: String,onChange: (String) -> Unit,modifier: Modifier=Modifier,hint: String?=null) {
    DateTimeInput(label,value.takeIf { it.isNotEmpty() }?.let { Dates.noon(Dates.key(it)) },{ onChange(it?.let(Dates::key) ?: "") },modifier,hint,clearable=true,dateOnly=true)
}

@Composable
fun SwitchRow(label: String,checked: Boolean,onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) { Ink(label,Modifier.weight(1f)); Switch(checked,onChange) }
}

// ── Timeline ────────────────────────────────────────────────────────────────────

val EventType.icon: ImageVector get()=when(this) {
    EventType.APPOINTMENT -> Lucide.calendar; EventType.BATH -> Lucide.bath; EventType.BIRTH -> Lucide.heart; EventType.DIAPER -> Lucide.wind
    EventType.FEED -> Lucide.milk; EventType.GROWTH -> Lucide.ruler; EventType.INTAKE -> Lucide.utensils; EventType.MEDICATION -> Lucide.pill
    EventType.MENSES -> Lucide.waves; EventType.MILESTONE -> Lucide.award; EventType.MOOD -> Lucide.smile; EventType.NOTE -> Lucide.fileText
    EventType.OUTPUT -> Lucide.toilet; EventType.PUMP -> Lucide.droplets; EventType.SLEEP -> Lucide.bed; EventType.TEMPERATURE -> Lucide.thermometer
    EventType.TUMMYTIME -> Lucide.dumbbell; EventType.VACCINE -> Lucide.syringe
}

@Composable
fun EventChip(type: EventType?,size: Dp=36.dp) {
    val p=LocalPalette.current
    Box(Modifier.size(size).clip(Radius).background(p.fill(type)),contentAlignment=Alignment.Center) {
        type?.let { Icon(it.icon,null,tint=p.tint(it),modifier=Modifier.size(size*0.55f)) }
    }
}

@Composable
fun Timeline(events: List<CareEvent>,profile: Profile?,profiles: List<Profile>,empty: String="No entries yet.",onEdit: ((CareEvent) -> Unit)?=null,onDelete: ((CareEvent) -> Unit)?=null) {
    val p=LocalPalette.current
    if(events.isEmpty()) { EmptyState(empty); return }
    Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
        events.sortedByDescending { it.start }.forEach { e ->
            val by=Family.nameOf(profiles,e.caregiverId)
            Row(Modifier.fillMaxWidth().clip(Radius).background(p.panel).border(1.dp,p.line,Radius).padding(12.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                EventChip(e.type)
                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
                    Row(verticalAlignment=Alignment.CenterVertically) {
                        Text(e.type?.label ?: "",Modifier.weight(1f),style=body(15,700),color=p.ink)
                        Text("${Dates.shortDate(e.start)} · ${Dates.clock(e.start)}",style=body(12,600),color=p.muted)
                    }
                    Text(buildString { append(EventText.detail(e,profile)); by?.let { append(" · $it") } },style=body(14),color=p.ink)
                    if(e.type!=EventType.NOTE) e.notes?.let { Text(it,style=body(13),color=p.muted) }
                }
                if(onEdit!=null || onDelete!=null) Column {
                    onEdit?.let { IconAction(Lucide.pencil,"Edit ${e.type?.label}",p.blue700) { it(e) } }
                    onDelete?.let { IconAction(Lucide.trash,"Delete ${e.type?.label}") { it(e) } }
                }
            }
        }
    }
}

// ── Charts ──────────────────────────────────────────────────────────────────────

/** One bar; `parts` stack bottom-up (wet under dirty). */
data class Bar(val label: String,val value: Double,val parts: List<Double>?=null)

/** `components/MiniChart.tsx`: a day's bars, the picked bar's reading, and min/max. */
@Composable
fun MiniChart(title: String,event: EventType,stats: FirstYear.Stats,total: Double,bars: List<Bar>,suffix: String="",partLabels: List<String>?=null,
    partAverages: List<Double>?=null,partTotals: List<Double>?=null,sampled: Boolean=false,onOpen: ((Metric) -> Unit)?=null) {
    val p=LocalPalette.current
    var active by remember(bars.size,title) { mutableStateOf<Int?>(null) }
    val tint=p.tint(event)
    val point=bars.getOrNull(active ?: (bars.size-1))
    fun parts(b: Bar)=if(b.parts==null || partLabels==null) "" else " ("+b.parts.mapIndexed { i,v -> "${Units.barValue(v)} ${partLabels[i]}" }.joinToString(" · ")+")"
    val dayWord=if(sampled) "avg/day from " else ""
    val legend=partLabels?.mapIndexed { i,l -> "$l ${partAverages?.let { "${Units.stat(it[i],suffix)} avg · " } ?: ""}${Units.stat(partTotals?.getOrNull(i) ?: 0.0,suffix)} total" }.orEmpty()
    val metric=Metric(title,"${Units.stat(stats.average,suffix)} avg",listOfNotNull("${Units.stat(total,suffix)} total",
        point?.let { "$dayWord${Dates.shortDate(it.label)}: ${Units.stat(it.value,suffix)}${parts(it)}" })+legend+
        listOf("Min ${Units.stat(stats.min,suffix)}","Max ${Units.stat(stats.max,suffix)}"),event)
    Panel(event=event,onClick=onOpen?.let { { it(metric) } }) {
        Row(verticalAlignment=Alignment.Bottom) {
            Text(title,Modifier.weight(1f),style=display(17),color=p.ink)
            Column(horizontalAlignment=Alignment.End) {
                Text("${Units.stat(stats.average,suffix)} avg",style=display(17),color=p.ink)
                Muted("${Units.stat(total,suffix)} total",size=12)
            }
        }
        if(bars.isEmpty()) EmptyState("No data") else {
            val max=maxOf(1.0,bars.maxOf { it.value })
            val gap=if(bars.size>45) 1.dp else if(bars.size>24) 2.dp else 4.dp
            val labels=bars.size<=7
            Row(Modifier.fillMaxWidth().height(if(labels) 140.dp else 116.dp),horizontalArrangement=Arrangement.spacedBy(gap),verticalAlignment=Alignment.Bottom) {
                bars.forEachIndexed { i,b ->
                    val picked=i==(active ?: bars.size-1)
                    Column(Modifier.weight(1f).fillMaxHeight().clickable { active=i },horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.Bottom) {
                        if(labels) Text(Units.barValue(b.value),style=body(11,700),color=p.muted,maxLines=1)
                        Canvas(Modifier.fillMaxWidth().weight(1f)) {
                            val h=size.height*maxOf(0.08,b.value/max).toFloat()
                            val top=size.height-h
                            val parts=b.parts
                            val alpha=if(picked) 1f else 0.62f
                            if(parts!=null && b.value>0) {
                                var y=size.height
                                parts.forEachIndexed { pi,v -> val ph=(h*(v/b.value)).toFloat()
                                    drawRoundRect(if(pi==0) tint.copy(alpha=alpha*0.55f) else tint.copy(alpha=alpha),Offset(0f,y-ph),Size(size.width,ph),CornerRadius(3.dp.toPx())); y-=ph }
                            } else drawRoundRect(tint.copy(alpha=alpha),Offset(0f,top),Size(size.width,h),CornerRadius(3.dp.toPx()))
                        }
                        if(labels) Text(runCatching { Dates.date(b.label).dayOfMonth.toString() }.getOrDefault(""),style=body(11,600),color=p.muted)
                    }
                }
            }
        }
        point?.let {
            Row(Modifier.fillMaxWidth().clip(Radius).background(p.panelBlue).padding(horizontal=10.dp,vertical=8.dp)) {
                Text("$dayWord${Dates.shortDate(it.label)}",Modifier.weight(1f),style=body(13,600),color=p.muted)
                Text(Units.stat(it.value,suffix)+parts(it),style=body(13,700),color=p.ink)
            }
        }
        legend.forEach { Muted(it,size=12) }
        Row { Muted("Min ${Units.stat(stats.min,suffix)}",Modifier.weight(1f),12); Muted("Max ${Units.stat(stats.max,suffix)}",size=12) }
    }
}

// ── Date range ──────────────────────────────────────────────────────────────────

@Composable
fun DateRangeFilter(range: DateRange,summary: String?=null,onChange: (DateRange) -> Unit) {
    val p=LocalPalette.current
    val preset=DateRange.matchPreset(range)
    Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
        ChipRow { DateRange.PRESETS.forEach { (id,_) -> Chip(if(id=="all") "All time" else id,selected=preset==id) { onChange(DateRange.preset(id)) } } }
        Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            DateKeyInput("From",range.from,{ onChange(range.copy(from=it)) },Modifier.weight(1f))
            DateKeyInput("To",range.to,{ onChange(range.copy(to=it)) },Modifier.weight(1f))
        }
        Row { Text(range.label(),Modifier.weight(1f),style=body(14,700),color=p.ink); summary?.let { Muted(it) } }
    }
}

/** A running timer pulses, like `.quick-timer`. */
@Composable
fun pulse(): Float {
    val t=rememberInfiniteTransition(label="timer")
    return t.animateFloat(1f,0.5f,infiniteRepeatable(tween(1000),RepeatMode.Reverse),label="pulse").value
}

@Composable
fun Dot(color: Color,size: Dp=10.dp) = Box(Modifier.size(size).clip(CircleShape).background(color))

@Composable
fun TextLink(text: String,color: Color=LocalPalette.current.blue700,onClick: () -> Unit) =
    Text(text,Modifier.clip(Radius).clickable(onClick=onClick).padding(vertical=6.dp),style=body(14,700),color=color,textAlign=TextAlign.Start)
