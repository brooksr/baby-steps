package com.babysteps.watch

import android.Manifest
import android.content.Context
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnScope
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.AlertDialog
import androidx.wear.compose.material3.AlertDialogDefaults
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.CompactButton
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.EdgeButtonSize
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.OutlinedButton
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.SurfaceTransformation
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.lazy.rememberTransformationSpec
import androidx.wear.compose.material3.lazy.transformedHeight
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.ZoneId
import kotlin.math.abs

/** Ticks once a second so clocks and "ago" stay current. */
@Composable
private fun rememberNow(): Instant {
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) { while(true) { now=Instant.now(); delay(1000) } }
    return now
}

@Composable
private fun Caption(text: String,color: Color,icon: ImageVector?=null,modifier: Modifier=Modifier) {
    Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.Center,modifier=modifier) {
        if(icon!=null) { Icon(icon,null,tint=color,modifier=Modifier.size(13.dp)); Spacer(Modifier.width(4.dp)) }
        Text(text.uppercase(),color=color,style=MaterialTheme.typography.labelSmall.copy(letterSpacing=1.2.sp,fontWeight=FontWeight.Medium))
    }
}

// ── Home ────────────────────────────────────────────────────────────────────────

/**
 * One glance answers the question asked most at night, "when did they last eat?", in the
 * largest type on the screen. Diaper and sleep sit beneath it, smaller; the four actions
 * come next, each a single tap from here.
 */
@Composable
fun HomeScreen(onTimer: () -> Unit,onBottle: () -> Unit,onDiaper: () -> Unit,onSettings: () -> Unit) {
    val context=LocalContext.current.applicationContext
    val haptics=LocalHapticFeedback.current
    val status by WatchRepository.status.collectAsState()
    val timer by WatchRepository.timer.collectAsState()
    val pending by WatchRepository.pending.collectAsState()
    val notice by WatchRepository.notice.collectAsState()
    val now=rememberNow()
    val configured=remember(status) { WatchSettings(context).configured }
    val askNotifications=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { FeedNotification.update(context,WatchRepository.timer.value) }
    val state=rememberTransformingLazyColumnState()
    val spec=rememberTransformationSpec()

    fun startFeed(side: String) {
        haptics.performHapticFeedback(HapticFeedbackType.Confirm)
        WatchRepository.startFeed(context,side)
        if(Build.VERSION.SDK_INT>=33) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        onTimer()
    }

    ScreenScaffold(scrollState=state) { padding ->
        TransformingLazyColumn(state=state,contentPadding=padding) {
            val t=timer
            item {
                if(t!=null) LiveTimer(t,now,onTimer,Modifier.transformedHeight(this,spec),SurfaceTransformation(spec))
                else FeedHero(status,configured,now,onSettings)
            }
            status?.let { s -> item { StatRow(s,now) } }
            if(t==null) item {
                val next=CareText.nextSide(status)
                ActionRow(
                    Action("Left",letter="L",badge=next=="left",strong=next=="left") { startFeed("left") },
                    Action("Right",letter="R",badge=next=="right",strong=next=="right") { startFeed("right") })
            }
            item {
                ActionRow(
                    Action("Bottle",icon=CareIcons.milk,onClick=onBottle),
                    Action("Diaper",icon=CareIcons.wind,tint=Care.diaper,container=Care.diaperContainer,onClick=onDiaper))
            }
            item { SyncLine(status,pending,notice,now) }
            item {
                CompactButton(onClick=onSettings,
                    icon={ Icon(CareIcons.settings,null,modifier=Modifier.size(16.dp)) },
                    colors=ButtonDefaults.buttonColors(containerColor=Care.surface,contentColor=Care.dim,iconColor=Care.dim),
                    transformation=SurfaceTransformation(spec),
                    modifier=Modifier.transformedHeight(this,spec)) { Text("Settings") }
            }
        }
    }
}

@Composable
private fun FeedHero(status: CareStatus?,configured: Boolean,now: Instant,onSettings: () -> Unit) {
    Column(horizontalAlignment=Alignment.CenterHorizontally,modifier=Modifier.fillMaxWidth().padding(top=6.dp,bottom=4.dp)) {
        Caption(status?.child?.let { "$it · last feed" } ?: "Last feed",Care.feed,CareIcons.milk)
        when {
            !configured -> {
                Text("Set up",style=MaterialTheme.typography.displaySmall,color=Care.text,modifier=Modifier.padding(top=4.dp))
                Text("Add the Pi's token in Settings",style=MaterialTheme.typography.bodySmall,color=Care.dim,textAlign=TextAlign.Center,
                    modifier=Modifier.clickable(onClick=onSettings).padding(4.dp))
            }
            status==null -> {
                Text("—",style=MaterialTheme.typography.numeralMedium,color=Care.faint)
                Text("Reading the log…",style=MaterialTheme.typography.bodySmall,color=Care.dim)
            }
            status.feedAt==null -> {
                Text("—",style=MaterialTheme.typography.numeralMedium,color=Care.faint)
                Text("No feed logged yet",style=MaterialTheme.typography.bodySmall,color=Care.dim)
            }
            else -> {
                Text(duration(CareText.compact(status.feedAt,now),20.sp,Care.dim),
                    style=MaterialTheme.typography.numeralMedium.tabular,color=Care.text,maxLines=1)
                Text(CareText.feedDetail(status),style=MaterialTheme.typography.bodySmall,color=Care.dim)
            }
        }
    }
}

@Composable
private fun LiveTimer(timer: FeedTimer,now: Instant,onClick: () -> Unit,modifier: Modifier,transformation: SurfaceTransformation) {
    Button(onClick=onClick,modifier=modifier.fillMaxWidth(),transformation=transformation,
        colors=ButtonDefaults.buttonColors(containerColor=Care.feedContainer,contentColor=Care.feed,secondaryContentColor=Care.feed.copy(alpha=0.75f),iconColor=Care.feed),
        icon={ Icon(if(timer.paused) CareIcons.pause else CareIcons.play,null,modifier=Modifier.size(20.dp)) },
        secondaryLabel={ Text(if(timer.paused) "Paused · ${CareText.sideLetter(timer.side)}" else "Nursing · ${if(timer.side=="left") "Left" else "Right"}") },
        label={ Text(CareText.clock(timer.totalMs(now)),style=MaterialTheme.typography.titleLarge.tabular) })
}

@Composable
private fun StatRow(status: CareStatus,now: Instant) {
    Row(horizontalArrangement=Arrangement.spacedBy(6.dp,Alignment.CenterHorizontally),modifier=Modifier.fillMaxWidth().padding(horizontal=10.dp)) {
        Stat(CareIcons.wind,Care.diaper,status.diaperAt?.let { CareText.compact(it,now) } ?: "—",
            status.diaperKind?.replaceFirstChar { it.uppercase() } ?: "Diaper",Modifier.weight(1f))
        val sleeping=status.asleep
        val since=if(sleeping) status.sleepAt else status.sleepEndedAt
        Stat(if(sleeping) CareIcons.moon else CareIcons.bed,Care.sleep,since?.let { CareText.compact(it,now) } ?: "—",
            if(status.sleepAt==null) "Sleep" else if(sleeping) "Asleep" else "Awake",Modifier.weight(1f))
    }
}

@Composable
private fun Stat(icon: ImageVector,tint: Color,value: String,label: String,modifier: Modifier) {
    Column(horizontalAlignment=Alignment.CenterHorizontally,
        modifier=modifier.clip(RoundedCornerShape(18.dp)).background(Care.surface).padding(vertical=7.dp)) {
        Row(verticalAlignment=Alignment.CenterVertically) {
            Icon(icon,null,tint=tint,modifier=Modifier.size(12.dp))
            Spacer(Modifier.width(3.dp))
            Text(label,style=MaterialTheme.typography.labelSmall,color=tint,maxLines=1)
        }
        Text(duration(value,11.sp,Care.dim),style=MaterialTheme.typography.titleMedium.tabular,color=Care.text,maxLines=1)
    }
}

private class Action(val label: String,val letter: String?=null,val icon: ImageVector?=null,val badge: Boolean=false,val strong: Boolean=false,
    val tint: Color=Care.feed,val container: Color=Care.feedContainer,val onClick: () -> Unit)

@Composable
private fun ActionRow(vararg actions: Action) {
    Row(horizontalArrangement=Arrangement.spacedBy(22.dp,Alignment.CenterHorizontally),modifier=Modifier.fillMaxWidth().padding(vertical=2.dp)) {
        for(a in actions) ActionCircle(a)
    }
}

/** A large round target, the side due next filled in, with its name beneath: thumbs find circles. */
@Composable
private fun ActionCircle(a: Action) {
    Column(horizontalAlignment=Alignment.CenterHorizontally) {
        Box(contentAlignment=Alignment.Center,
            modifier=Modifier.size(54.dp).clip(CircleShape).background(if(a.strong) a.tint else a.container)
                .clickable(onClick=a.onClick).semantics { contentDescription=a.label }) {
            val color=if(a.strong) Care.onFeed else a.tint
            if(a.letter!=null) Text(a.letter,color=color,style=MaterialTheme.typography.titleLarge.copy(fontSize=22.sp,fontWeight=FontWeight.SemiBold))
            if(a.icon!=null) Icon(a.icon,null,tint=color,modifier=Modifier.size(24.dp))
        }
        Text(if(a.badge) "${a.label} · next" else a.label,style=MaterialTheme.typography.labelSmall,
            color=if(a.badge) a.tint else Care.dim,modifier=Modifier.padding(top=3.dp))
    }
}

@Composable
private fun SyncLine(status: CareStatus?,pending: Int,notice: WatchRepository.Notice?,now: Instant) {
    val (text,color,icon)=when {
        notice!=null && !notice.ok -> Triple(notice.text,Care.warn,if(pending>0) CareIcons.cloudOff else null)
        pending>0 -> Triple("$pending waiting to send",Care.dim,CareIcons.cloudOff)
        status!=null && CareText.stale(status,now) -> Triple("Updated ${CareText.since(status.fetchedAt,now)}",Care.warn,CareIcons.cloudOff)
        status!=null -> Triple("Updated ${CareText.since(status.fetchedAt,now)}",Care.faint,null)
        else -> return
    }
    Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.Center,modifier=Modifier.fillMaxWidth().padding(horizontal=24.dp,vertical=4.dp)) {
        if(icon!=null) { Icon(icon,null,tint=color,modifier=Modifier.size(12.dp)); Spacer(Modifier.width(4.dp)) }
        Text(text,style=MaterialTheme.typography.bodyExtraSmall,color=color,textAlign=TextAlign.Center)
    }
}

// ── Nursing timer ───────────────────────────────────────────────────────────────

/**
 * Full screen, legible at arm's length with a baby in the other arm. The ring sweeps once a
 * minute so a glance shows it is running; tapping a side switches to it (and resumes), the
 * middle button pauses, and Done sits under the thumb on the bottom edge.
 */
@Composable
fun TimerScreen(onDone: (String?) -> Unit) {
    val context=LocalContext.current.applicationContext
    val haptics=LocalHapticFeedback.current
    val timer by WatchRepository.timer.collectAsState()
    val now=rememberNow()
    var confirmDiscard by remember { mutableStateOf(false) }
    val t=timer ?: run { LaunchedEffect(Unit) { onDone(null) }; return }
    val pulse by rememberInfiniteTransition(label="paused").animateFloat(1f,0.35f,infiniteRepeatable(tween(900),RepeatMode.Reverse),label="pulse")

    // Fixed, not a list: Done must always be on screen, never below a scroll.
    Box(Modifier.fillMaxSize()) {
        MinuteRing(if(t.paused) null else (t.totalMs(now)%60_000)/60_000f)
        Column(horizontalAlignment=Alignment.CenterHorizontally,modifier=Modifier.align(Alignment.TopCenter).padding(top=22.dp)) {
            Caption(if(t.paused) "Paused" else "Nursing",Care.feed)
            // The numeral's line box is mostly empty space; held to the digits, Discard clears Done.
            Box(contentAlignment=Alignment.Center,modifier=Modifier.height(36.dp)) {
                Text(CareText.clock(t.totalMs(now)),style=MaterialTheme.typography.numeralMedium.tabular,color=Care.text,
                    modifier=Modifier.wrapContentHeight(unbounded=true).alpha(if(t.paused) pulse else 1f))
            }
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp),modifier=Modifier.offset(y=(-2).dp)) {
                SidePill("L",t.onSide("left",now),active=t.side=="left" && !t.paused,current=t.side=="left") {
                    haptics.performHapticFeedback(HapticFeedbackType.SegmentTick); WatchRepository.switchTo(context,"left") }
                Box(contentAlignment=Alignment.Center,modifier=Modifier.size(40.dp).clip(CircleShape).background(Care.surfaceHigh)
                    .clickable { haptics.performHapticFeedback(HapticFeedbackType.SegmentTick); WatchRepository.togglePause(context) }
                    .semantics { contentDescription=if(t.paused) "Resume" else "Pause" }) {
                    Icon(if(t.paused) CareIcons.play else CareIcons.pause,null,tint=Care.text,modifier=Modifier.size(18.dp))
                }
                SidePill("R",t.onSide("right",now),active=t.side=="right" && !t.paused,current=t.side=="right") {
                    haptics.performHapticFeedback(HapticFeedbackType.SegmentTick); WatchRepository.switchTo(context,"right") }
            }
            // A real target, not a text link: it is tapped one-handed, often in the dark.
            Box(contentAlignment=Alignment.Center,modifier=Modifier.padding(top=2.dp).width(96.dp).height(32.dp).clip(CircleShape)
                .background(Care.warn.copy(alpha=0.12f)).clickable { confirmDiscard=true }) {
                Text("Discard",style=MaterialTheme.typography.labelMedium,color=Care.warn)
            }
        }
        EdgeButton(onClick={ haptics.performHapticFeedback(HapticFeedbackType.Confirm); onDone(WatchRepository.stopFeed(context)) },
            modifier=Modifier.align(Alignment.BottomCenter),buttonSize=EdgeButtonSize.ExtraSmall,
            colors=ButtonDefaults.buttonColors(containerColor=Care.feed,contentColor=Care.onFeed)) { Text("Done",fontWeight=FontWeight.SemiBold) }
    }
    AlertDialog(visible=confirmDiscard,onDismissRequest={ confirmDiscard=false },
        title={ Text("Discard this feed?",textAlign=TextAlign.Center) },
        text={ Text("${CareText.clock(t.totalMs(now))} won't be logged.",textAlign=TextAlign.Center) },
        confirmButton={ AlertDialogDefaults.ConfirmButton(onClick={ confirmDiscard=false; WatchRepository.cancelFeed(context) }) },
        dismissButton={ AlertDialogDefaults.DismissButton(onClick={ confirmDiscard=false }) })
}

@Composable
private fun SidePill(letter: String,ms: Long,active: Boolean,current: Boolean,onClick: () -> Unit) {
    Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.Center,
        modifier=Modifier.width(56.dp).height(44.dp).clip(RoundedCornerShape(22.dp))
            .background(if(active) Care.feed else if(current) Care.feedContainer.copy(alpha=0.9f) else Care.surface)
            .clickable(onClick=onClick).semantics { contentDescription="${if(letter=="L") "Left" else "Right"} side" }) {
        val color=if(active) Care.onFeed else Care.feed
        Text(letter,color=color,style=MaterialTheme.typography.titleMedium.copy(fontWeight=FontWeight.SemiBold),modifier=Modifier.offset(y=1.dp))
        Text(CareText.clock(ms),color=color.copy(alpha=0.8f),style=MaterialTheme.typography.bodyExtraSmall.tabular)
    }
}

/** A thin track around the bezel; the arc fills once a minute while running and rests empty when paused. */
@Composable
private fun MinuteRing(progress: Float?) {
    Canvas(Modifier.fillMaxSize().padding(3.dp)) {
        val stroke=4.dp.toPx()
        val inset=stroke/2
        val arcSize=Size(size.width-stroke,size.height-stroke)
        drawArc(Care.feed.copy(alpha=0.14f),0f,360f,false,Offset(inset,inset),arcSize,style=Stroke(stroke))
        if(progress!=null && progress>0f) drawArc(Care.feed,-90f,360f*progress,false,Offset(inset,inset),arcSize,style=Stroke(stroke,cap=StrokeCap.Round))
    }
}

// ── Bottle ──────────────────────────────────────────────────────────────────────

/** The crown sets the amount, in half ounces, with a tick under the finger for each step. */
@Composable
fun BottleScreen(onDone: (String) -> Unit) {
    val context=LocalContext.current.applicationContext
    val prefs=remember { context.getSharedPreferences("babysteps-watch",Context.MODE_PRIVATE) }
    val haptics=LocalHapticFeedback.current
    var oz by remember { mutableDoubleStateOf(prefs.getFloat("bottleOz",3f).toDouble()) }
    var scrolled by remember { mutableFloatStateOf(0f) }
    val focus=remember { FocusRequester() }
    // After the screen's enter transition: until then the outgoing screen's list still holds the crown.
    LaunchedEffect(Unit) { delay(450); focus.requestFocus() }
    fun step(by: Double) {
        val next=(oz+by).coerceIn(0.5,MAX_OZ)
        if(next!=oz) { oz=next; haptics.performHapticFeedback(HapticFeedbackType.SegmentFrequentTick) }
    }
    Box(Modifier.fillMaxSize().onRotaryScrollEvent { e ->
            scrolled+=e.verticalScrollPixels
            while(abs(scrolled)>=CROWN_STEP_PX) { step(if(scrolled>0) 0.5 else -0.5); scrolled-=CROWN_STEP_PX*Math.signum(scrolled) }
            true
        }.focusRequester(focus).focusable()) {
        Column(horizontalAlignment=Alignment.CenterHorizontally,modifier=Modifier.align(Alignment.TopCenter).padding(top=34.dp)) {
            Caption("Bottle",Care.feed,CareIcons.milk)
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp),modifier=Modifier.padding(top=6.dp)) {
                RoundIcon(CareIcons.minus,"Less") { step(-0.5) }
                val number=CareText.ozNumber(oz)
                Row(verticalAlignment=Alignment.Bottom,modifier=Modifier.width(100.dp),horizontalArrangement=Arrangement.Center) {
                    // "13½" steps down a size so the amount and its unit always share one line.
                    Text(number,style=(if(number.length>2) MaterialTheme.typography.numeralSmall else MaterialTheme.typography.numeralMedium).tabular,
                        color=Care.text,maxLines=1,softWrap=false)
                    Text("oz",style=MaterialTheme.typography.bodyMedium,color=Care.dim,maxLines=1,softWrap=false,
                        modifier=Modifier.padding(start=2.dp,bottom=if(number.length>2) 5.dp else 9.dp))
                }
                RoundIcon(CareIcons.plus,"More") { step(0.5) }
            }
            Text("Turn the crown to adjust",style=MaterialTheme.typography.bodyExtraSmall,color=Care.faint,modifier=Modifier.padding(top=8.dp))
        }
        EdgeButton(onClick={
            haptics.performHapticFeedback(HapticFeedbackType.Confirm)
            prefs.edit().putFloat("bottleOz",oz.toFloat()).apply()
            WatchRepository.submit(context,Requests.bottle(oz,Instant.now(),ZoneId.systemDefault()))
            onDone(CareText.oz(oz))
        },modifier=Modifier.align(Alignment.BottomCenter),buttonSize=EdgeButtonSize.Small,
            colors=ButtonDefaults.buttonColors(containerColor=Care.feed,contentColor=Care.onFeed)) {
            Text("Log ${CareText.oz(oz)}",fontWeight=FontWeight.SemiBold)
        }
    }
}

private const val MAX_OZ=16.0
/** Crown travel per half ounce: a deliberate turn, not a brush, changes the amount. */
private const val CROWN_STEP_PX=80f

@Composable
private fun RoundIcon(icon: ImageVector,label: String,onClick: () -> Unit) {
    Box(contentAlignment=Alignment.Center,modifier=Modifier.size(40.dp).clip(CircleShape).background(Care.feedContainer)
        .clickable(onClick=onClick).semantics { contentDescription=label }) {
        Icon(icon,null,tint=Care.feed,modifier=Modifier.size(20.dp))
    }
}

// ── Diaper ──────────────────────────────────────────────────────────────────────

/** Three big choices; one tap logs it and returns home. */
@Composable
fun DiaperScreen(onDone: (String) -> Unit) {
    val context=LocalContext.current.applicationContext
    val haptics=LocalHapticFeedback.current
    val state=rememberTransformingLazyColumnState()
    val spec=rememberTransformationSpec()
    ScreenScaffold(scrollState=state) { padding ->
        TransformingLazyColumn(state=state,contentPadding=padding) {
            item { Caption("Diaper",Care.diaper,CareIcons.wind,Modifier.padding(bottom=4.dp)) }
            for((kind,label,icons) in listOf(Triple("wet","Wet",listOf(CareIcons.droplet)),Triple("dirty","Dirty",listOf(CareIcons.wind)),
                Triple("both","Both",listOf(CareIcons.droplet,CareIcons.wind)))) item {
                Button(onClick={
                    haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                    WatchRepository.submit(context,Requests.diaper(kind,Instant.now(),ZoneId.systemDefault()))
                    onDone(label)
                },modifier=Modifier.fillMaxWidth().transformedHeight(this,spec),transformation=SurfaceTransformation(spec),
                    colors=ButtonDefaults.buttonColors(containerColor=Care.diaperContainer,contentColor=Care.text,iconColor=Care.diaper),
                    icon={ Row { for(i in icons) Icon(i,null,modifier=Modifier.size(if(icons.size>1) 16.dp else 22.dp)) } },
                    label={ Text(label,style=MaterialTheme.typography.titleMedium) })
            }
        }
    }
}

// ── Settings ────────────────────────────────────────────────────────────────────

@Composable
fun SettingsScreen(onDone: () -> Unit) {
    val context=LocalContext.current.applicationContext
    val settings=remember { WatchSettings(context) }
    var endpoint by remember { mutableStateOf(settings.endpoint) }
    var token by remember { mutableStateOf(settings.token) }
    var child by remember { mutableStateOf(settings.child) }
    var error by remember { mutableStateOf<String?>(null) }
    val state=rememberTransformingLazyColumnState()
    ScreenScaffold(scrollState=state,
        edgeButton={
            EdgeButton(onClick={ try { settings.save(endpoint,token,child); onDone() } catch(e: IllegalArgumentException) { error=e.message } },
                buttonSize=EdgeButtonSize.Small,colors=ButtonDefaults.buttonColors(containerColor=Care.feed,contentColor=Care.onFeed)) { Text("Save") }
        }) { padding ->
        TransformingLazyColumn(state=state,contentPadding=padding) {
            item { Caption("Settings",Care.dim,CareIcons.settings) }
            item { Field("Pi events URL",endpoint) { endpoint=it } }
            item { Field("Events token",token,secret=true) { token=it } }
            item { Field("Child · blank if one",child) { child=it } }
            error?.let { item { Text(it,color=Care.warn,style=MaterialTheme.typography.bodySmall,textAlign=TextAlign.Center) } }
        }
    }
}

/** Tap to type with the watch keyboard, or focus it and send the text with `adb shell input text`. */
@Composable
private fun Field(label: String,value: String,secret: Boolean=false,onChange: (String) -> Unit) {
    Column(modifier=Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Care.surface).padding(PaddingValues(horizontal=14.dp,vertical=8.dp))) {
        Text(label,style=MaterialTheme.typography.labelSmall,color=Care.dim)
        BasicTextField(value=value,onValueChange=onChange,singleLine=true,
            textStyle=MaterialTheme.typography.bodySmall.copy(color=Care.text),cursorBrush=SolidColor(Care.feed),
            visualTransformation=if(secret) PasswordVisualTransformation() else VisualTransformation.None,
            modifier=Modifier.fillMaxWidth().padding(top=2.dp))
        if(secret && value.isNotEmpty()) Text("${value.length} characters · ends ${value.takeLast(4)}",style=MaterialTheme.typography.bodyExtraSmall,color=Care.faint)
    }
}
