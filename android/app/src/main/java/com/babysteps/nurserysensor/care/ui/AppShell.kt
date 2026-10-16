package com.babysteps.nurserysensor.care.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.babysteps.nurserysensor.care.data.CareRepository
import com.babysteps.nurserysensor.care.data.DevicePrefs
import com.babysteps.nurserysensor.care.domain.Dates
import com.babysteps.nurserysensor.care.domain.Family
import com.babysteps.nurserysensor.care.domain.Reference
import com.babysteps.nurserysensor.care.model.CareEvent
import com.babysteps.nurserysensor.care.model.EventType
import com.babysteps.nurserysensor.care.model.Profile
import com.babysteps.nurserysensor.care.model.Tracker
import kotlinx.coroutines.delay
import java.time.Instant

enum class Tab(val key: String,val label: String,val icon: ImageVector) {
    HOME("home","Home",Lucide.home), LOG("log","Log",Lucide.list), REPORTS("reports","Reports",Lucide.chart), CARE("care","Care",Lucide.clipboardCheck),
    SHOPPING("shopping","Shopping",Lucide.cart), TODOS("todos","To-do",Lucide.listTodo), SETTINGS("settings","Settings",Lucide.settings),
    /** The nursery monitor — on the Android app only; the web app has no sensor. */
    NURSERY("nursery","Nursery",Lucide.radio),
    LEARN("learn","Learn",Lucide.bookOpen),
}

private val PARENT_TABS=listOf(Tab.HOME,Tab.LOG,Tab.REPORTS,Tab.SHOPPING,Tab.TODOS,Tab.SETTINGS,Tab.NURSERY)
private val CHILD_TABS=listOf(Tab.HOME,Tab.LOG,Tab.REPORTS,Tab.CARE,Tab.SETTINGS,Tab.NURSERY)

/** Everything a screen needs about who is on screen, and the things it can ask the shell to do. */
class Ui(
    val tracker: Tracker,
    val profile: Profile,
    val profiles: List<Profile>,
    /** The person on screen's entries, newest first. */
    val events: List<CareEvent>,
    /** Every child's entries — a parent's nights are partly about the babies. */
    val childEvents: List<CareEvent>,
    val timers: Map<EventType,Instant>,
    val onAdd: (EventType) -> Unit,
    val onEdit: (CareEvent) -> Unit,
    val onDelete: (CareEvent) -> Unit,
    val openLog: (EventType?) -> Unit,
    val openDetail: (Metric) -> Unit,
    val navigate: (Tab) -> Unit,
    val selectProfile: (String) -> Unit,
    /** Opens the sleep form on an estimated stretch from the Nights track. */
    val logSleep: (Instant,Instant?) -> Unit,
)

/** How often a foreground app re-reads the shared sheet for other people's edits — the web app's 45 seconds. */
private const val POLL_MS=45_000L

@Composable
fun CareApp(nursery: @Composable () -> Unit) {
    val context=LocalContext.current
    val prefs=remember { DevicePrefs(context) }
    remember { Reference.init(context); CareRepository.load(context); 0 }
    val state by CareRepository.state.collectAsStateWithLifecycle()
    val refused by CareRepository.refused.collectAsStateWithLifecycle()
    val themeChoice by DevicePrefs.theme.collectAsStateWithLifecycle()
    val timerRevision by DevicePrefs.timerRevision.collectAsStateWithLifecycle()
    val lifecycle=LocalLifecycleOwner.current.lifecycle

    LaunchedEffect(Unit) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while(true) { CareRepository.flush(context); CareRepository.refresh(context); delay(POLL_MS) }
        }
    }

    BabystepsTheme(themeChoice ?: prefs.theme) {
        val p=LocalPalette.current
        var tab by rememberSaveable { mutableStateOf(Tab.HOME) }
        var activeId by rememberSaveable { mutableStateOf(prefs.activeProfileId) }
        var logFilter by remember { mutableStateOf<EventType?>(null) }
        var addType by remember { mutableStateOf<EventType?>(null) }
        var editing by remember { mutableStateOf<CareEvent?>(null) }
        var preset by remember { mutableStateOf<Pair<Instant,Instant?>?>(null) }
        var detail by remember { mutableStateOf<Metric?>(null) }
        var deleting by remember { mutableStateOf<CareEvent?>(null) }
        val snackbar=remember { SnackbarHostState() }

        LaunchedEffect(refused) { refused?.let { snackbar.showSnackbar("Not saved: $it"); CareRepository.clearRefused() } }

        val tracker=state.tracker
        val active=remember(tracker) { Family.active(tracker.profiles) }
        // The stored person may have been archived on another device: land on whoever is first.
        val profile=active.find { it.id==activeId } ?: active.firstOrNull { it.isChild } ?: active.firstOrNull()

        Scaffold(containerColor=p.page,snackbarHost={ SnackbarHost(snackbar) },
            // Before the first read there is no one to show, but the nursery monitor must stay one tap away.
            bottomBar={ BottomBar(if(profile?.isParent==true) PARENT_TABS else if(profile!=null) CHILD_TABS else listOf(Tab.HOME,Tab.NURSERY),tab) { tab=it; if(it==Tab.LOG) logFilter=null } }
        ) { padding ->
            Column(Modifier.fillMaxSize().padding(padding)) {
                if(tab==Tab.NURSERY) { Box(Modifier.weight(1f)) { nursery() }; return@Column }
                if(profile==null) { ConnectScreen(state); return@Column }
                val allowed=if(profile.isParent) PARENT_TABS else CHILD_TABS
                val view=if(tab in allowed || tab==Tab.LEARN) tab else Tab.HOME
                val events=tracker.eventsFor(profile.id)
                val childIds=tracker.profiles.filter { it.isChild }.map { it.id }.toSet()
                val timers=remember(profile.id,timerRevision) { prefs.timers(profile.id) }
                val ui=Ui(tracker,profile,tracker.profiles,events,if(profile.isParent) tracker.events.filter { it.babyId in childIds } else emptyList(),timers,
                    onAdd={ editing=null; preset=null; addType=it },onEdit={ addType=null; editing=it },onDelete={ deleting=it },
                    openLog={ logFilter=it; tab=Tab.LOG },openDetail={ detail=it },navigate={ tab=it },
                    selectProfile={ activeId=it; prefs.activeProfileId=it },logSleep={ s,e -> editing=null; preset=s to e; addType=EventType.SLEEP })

                Header(active,profile) { ui.selectProfile(it) }
                SyncBanner(state)
                // Each screen, for each person, opens at its top.
                val scroll=remember(view,profile.id) { androidx.compose.foundation.ScrollState(0) }
                Column(Modifier.weight(1f).verticalScroll(scroll).padding(horizontal=16.dp).padding(bottom=24.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                    when(view) {
                        Tab.HOME -> if(profile.isParent) ParentHome(ui) else ChildHome(ui)
                        Tab.LOG -> LogScreen(ui,logFilter)
                        Tab.REPORTS -> if(profile.isParent) ParentReports(ui) else ChildReports(ui)
                        Tab.CARE -> CareScreen(ui)
                        Tab.SHOPPING -> ShoppingScreen(ui)
                        Tab.TODOS -> TodosScreen(ui)
                        Tab.SETTINGS -> SettingsScreen(ui,state)
                        Tab.LEARN -> LearnScreen()
                        Tab.NURSERY -> {}
                    }
                }

                val type=editing?.type ?: addType
                if(type!=null) QuickAddSheet(ui,type,editing,preset,onClose={ addType=null; editing=null; preset=null })
            }
        }

        detail?.let { ReportDetailDialog(it) { detail=null } }
        deleting?.let { event ->
            AlertDialog(onDismissRequest={ deleting=null },title={ Text("Delete this ${event.type?.label?.lowercase() ?: "entry"}?",style=display(20)) },
                text={ Text("${Dates.shortDate(event.start)} · ${Dates.clock(event.start)} — it comes off the shared log for everyone.",style=body(14)) },
                confirmButton={ TextButton({ deleting=null; CareRepository.deleteEvent(context,event.id) }) { Text("Delete",color=p.danger,style=body(15,700)) } },
                dismissButton={ TextButton({ deleting=null }) { Text("Keep",style=body(15,700)) } })
        }
    }
}


@Composable
private fun Header(active: List<Profile>,profile: Profile,onSelect: (String) -> Unit) {
    val p=LocalPalette.current
    Row(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=10.dp),verticalAlignment=Alignment.CenterVertically) {
        Text("BabySteps",style=display(21),color=p.blue700)
        Spacer(Modifier.weight(1f))
        // Only with more than one person, so a single-baby tracker looks untouched.
        if(active.size>1) Row(Modifier.widthIn(max=260.dp).horizontalScroll(rememberScrollState()).clip(Radius).background(p.panel).border(1.dp,p.line,Radius).padding(3.dp),
            horizontalArrangement=Arrangement.spacedBy(2.dp)) {
            active.forEach { person ->
                val on=person.id==profile.id
                Box(Modifier.clip(RoundedCornerShape(6.dp)).background(if(on) p.blue500 else Color.Transparent).clickable { onSelect(person.id) }.padding(horizontal=10.dp,vertical=6.dp)) {
                    Text(person.firstName,style=body(13,700),color=if(on) (if(p.dark) p.page else Color.White) else p.ink)
                }
            }
        }
    }
}

@Composable
private fun SyncBanner(state: CareRepository.State) {
    val p=LocalPalette.current
    val text=state.problem ?: if(state.pending>0) "Sending ${state.pending} change${if(state.pending==1) "" else "s"}…" else null
    text ?: return
    Row(Modifier.fillMaxWidth().padding(horizontal=16.dp).padding(bottom=8.dp).clip(Radius).background(if(state.problem!=null) p.pastDue.copy(alpha=0.25f) else p.blue100)
        .padding(horizontal=12.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        Icon(if(state.problem!=null) Lucide.cloudOff else Lucide.refresh,null,tint=p.ink,modifier=Modifier.size(16.dp))
        Text(text,style=body(13,600),color=p.ink)
    }
}

@Composable
private fun BottomBar(tabs: List<Tab>,selected: Tab,onSelect: (Tab) -> Unit) {
    val p=LocalPalette.current
    Row(Modifier.fillMaxWidth().background(p.panel).border(1.dp,p.line).navigationBarsPadding().padding(horizontal=4.dp,vertical=6.dp)) {
        tabs.forEach { t ->
            val on=t==selected || (selected==Tab.LEARN && t==Tab.SETTINGS)
            val tint=p.nav(t.key)
            Column(Modifier.weight(1f).clip(Radius).background(if(on) tint.copy(alpha=if(p.dark) 0.16f else 0.12f) else Color.Transparent).clickable { onSelect(t) }.padding(vertical=6.dp),
                horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(2.dp)) {
                Icon(t.icon,t.label,tint=if(on) tint else p.muted,modifier=Modifier.size(22.dp))
                Text(t.label,style=body(11,700),color=if(on) tint else p.muted,maxLines=1)
            }
        }
    }
}

/** No copy of the family yet: say what is needed and go straight to Settings' connection card. */
@Composable
private fun ConnectScreen(state: CareRepository.State) {
    val p=LocalPalette.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        Text("BabySteps",style=display(28),color=p.blue700)
        Panel {
            Heading(if(state.configured) "Reading the family log" else "Connect to the Babysteps Pi",level=2)
            Muted(if(state.configured) state.problem ?: "One moment — reading the shared sheet through the Pi." else
                "This app reads and writes the family's shared Babysteps sheet through the Pi, the way the web app does through Google. Enter the Pi's address and the app token (APP_API_TOKEN in ~/babysteps/events.env on the Pi).",size=14)
            if(state.configured) LinearProgressIndicator(Modifier.fillMaxWidth(),color=p.blue500)
        }
        ConnectionCard()
    }
}
