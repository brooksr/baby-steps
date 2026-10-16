package com.babysteps.nurserysensor

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.babysteps.nurserysensor.monitoring.*
import com.babysteps.nurserysensor.reporting.*
import com.babysteps.nurserysensor.audio.AudioLabel
import com.babysteps.nurserysensor.care.ui.CareApp
import com.babysteps.nurserysensor.care.ui.Segmented
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // The Babysteps app, rebuilt natively, with the nursery monitor as its own tab —
        // the one tab the web app does not have, since only this phone has the sensor.
        setContent { CareApp { Dashboard() } }
    }
    override fun onResume() {
        super.onResume()
        // Resume prior explicit consent only while the activity is visible. Modern
        // Android microphone restrictions still apply after reboot/force-stop.
        if (MonitoringPreferences(this).wanted && granted(Manifest.permission.RECORD_AUDIO) &&
            !MonitoringStore.state.value.active) {
            try {
                startForegroundService(Intent(this,MonitoringService::class.java).setAction(MonitoringService.ACTION_RESUME))
            } catch(e: RuntimeException) {
                MonitoringStore.finished("Automatic resume was blocked. Tap Start Monitoring while the app is visible.")
                SensorLog.event("resume_request_failed","exception" to e.javaClass.simpleName)
            }
        }
    }
    @Composable private fun Dashboard() {
        val state by MonitoringStore.state.collectAsStateWithLifecycle()
        val deliveryStatus by com.babysteps.nurserysensor.sync.DeliveryCoordinator.status.collectAsStateWithLifecycle()
        var tab by rememberSaveable { mutableIntStateOf(0) }
        var permissionRevision by remember { mutableIntStateOf(0) }
        var message by remember { mutableStateOf<String?>(null) }
        var repository by remember { mutableStateOf<NightRepository?>(null) }
        var storageError by remember { mutableStateOf<String?>(null) }
        val preferences = remember { getSharedPreferences("nursery-settings",MODE_PRIVATE) }
        var classification by remember { mutableStateOf(preferences.getBoolean("classification",true)) }
        LaunchedEffect(Unit) {
            try { repository=withContext(Dispatchers.IO) { NightRepository.get(this@MainActivity) } }
            catch(e: Exception) { storageError="Overnight storage failed: ${e.message}"; SensorLog.event("storage_open_failed","message" to e.message) }
        }
        DisposableEffect(lifecycle) {
            val observer=LifecycleEventObserver { _,event -> if(event==Lifecycle.Event.ON_RESUME) permissionRevision++ }
            lifecycle.addObserver(observer)
            onDispose { lifecycle.removeObserver(observer) }
        }
        val mic = remember(permissionRevision) { granted(Manifest.permission.RECORD_AUDIO) }
        val notifications = remember(permissionRevision) { Build.VERSION.SDK_INT<33 || granted(Manifest.permission.POST_NOTIFICATIONS) }
        val permissionLauncher=rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            permissionRevision++
            message=if(granted(Manifest.permission.RECORD_AUDIO)) "Permission updated. Tap Start Monitoring." else "Microphone permission is required. Use App Settings if denied permanently."
            SensorLog.event("permissions_updated","microphone" to granted(Manifest.permission.RECORD_AUDIO))
        }
        fun requestPermissions() {
            permissionLauncher.launch(buildList {
                if(!mic) add(Manifest.permission.RECORD_AUDIO)
                if(Build.VERSION.SDK_INT>=33 && !notifications) add(Manifest.permission.POST_NOTIFICATIONS)
            }.toTypedArray())
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement=Arrangement.spacedBy(14.dp)) {
                Text("Nursery",style=MaterialTheme.typography.headlineSmall)
                Text("Continuous sound monitoring on this phone • v${BuildConfig.VERSION_NAME}",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                Segmented(listOf(0 to "Monitor",1 to "Reports",2 to "Settings"),tab,Modifier.fillMaxWidth()) { tab=it }
                when(tab) {
                    0 -> {
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                                Text("Monitoring: ${if(state.status==ServiceStatus.RUNNING) "On" else "Off"}",style=MaterialTheme.typography.titleLarge)
                                Text("Service status: ${state.status.name.lowercase().replaceFirstChar { it.uppercase() }}")
                                Text(state.latest?.soundLevel?.let { String.format(Locale.US,"%.1f",it) } ?: "—",style=MaterialTheme.typography.displayMedium)
                                Text("Current sound level · dBFS",style=MaterialTheme.typography.bodySmall)
                                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
                                    Column { Text("30 s average",style=MaterialTheme.typography.labelMedium); Text(db(state.latest?.rollingAverage),style=MaterialTheme.typography.titleMedium) }
                                    Column { Text("Session peak",style=MaterialTheme.typography.labelMedium); Text(db(state.latest?.sessionPeak),style=MaterialTheme.typography.titleMedium) }
                                }
                                val levels=state.history
                                val lineColor=MaterialTheme.colorScheme.primary
                                Canvas(Modifier.fillMaxWidth().height(100.dp).semantics { contentDescription="Relative sound levels over the last minute" }) {
                                    fun point(index: Int): Offset = Offset(index.toFloat()/239*size.width,
                                        (1-((levels[index].soundLevel+90)/90).coerceIn(0.0,1.0)).toFloat()*size.height)
                                    for(i in 1 until levels.size) if(!levels[i].microphoneSilenced && !levels[i-1].microphoneSilenced &&
                                        java.time.Duration.between(levels[i-1].timestamp,levels[i].timestamp).toMillis() in 0..750)
                                        drawLine(lineColor,point(i-1),point(i),strokeWidth=3f)
                                }
                                Text("Last minute · relative amplitude, not calibrated SPL",style=MaterialTheme.typography.bodySmall)
                                state.startedAt?.let { Text("Started ${TIME.format(it)}",style=MaterialTheme.typography.bodySmall) }
                                if(!state.active && state.latest!=null) Text("Values are from the last stopped session.",style=MaterialTheme.typography.bodySmall)
                            }
                        }
                        if(!mic || !notifications) OutlinedButton(onClick={ requestPermissions() },enabled=!state.active,modifier=Modifier.fillMaxWidth()) { Text("Grant Permissions") }
                        Button(onClick={
                            if(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                                message=null
                                try { startForegroundService(Intent(this@MainActivity,MonitoringService::class.java)
                                    .setAction(MonitoringService.ACTION_START).putExtra(MonitoringService.EXTRA_CLASSIFICATION,classification)) }
                                catch(e: RuntimeException) { message="Android could not start monitoring. Check permissions and retry."; SensorLog.event("start_request_failed","exception" to e.javaClass.simpleName) }
                            }
                        },enabled=mic && !state.active && repository!=null,modifier=Modifier.fillMaxWidth()) { Text("Start Monitoring") }
                        OutlinedButton(onClick={ startService(Intent(this@MainActivity,MonitoringService::class.java).setAction(MonitoringService.ACTION_STOP)) },
                            enabled=state.active || MonitoringPreferences(this@MainActivity).wanted,modifier=Modifier.fillMaxWidth()) { Text("Stop Monitoring") }
                        Text(if(repository!=null) "Overnight storage: Ready · numeric report saved locally" else storageError ?: "Opening overnight storage…",style=MaterialTheme.typography.bodySmall)
                        Text("Start once to monitor nights and naps continuously. Stop Monitoring turns off automatic recovery. Reboot recovery depends on Android version.",style=MaterialTheme.typography.bodySmall)
                        Text("Summary delivery: $deliveryStatus",style=MaterialTheme.typography.bodySmall)
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                                Text("Local sound classification",style=MaterialTheme.typography.titleMedium)
                                Text(state.modelStatus)
                                state.prediction?.let { p ->
                                    val label=if(p.result.label==AudioLabel.UNKNOWN) "Uncertain / other sound" else "Likely ${p.result.label.eventName.replace('_',' ')}"
                                    Text(label,style=MaterialTheme.typography.headlineSmall)
                                    p.result.scores.filter { it.key!=AudioLabel.UNKNOWN }.entries.sortedByDescending { it.value }.take(3).forEach {
                                        Text("${it.key.eventName.replace('_',' ')} · score ${String.format(Locale.US,"%.2f",it.value)}",style=MaterialTheme.typography.bodySmall)
                                    }
                                    Text("Last inference ${p.inferenceMs} ms · dropped windows ${state.classificationDropped}",style=MaterialTheme.typography.bodySmall)
                                }
                                state.classificationError?.let { Text(it,color=MaterialTheme.colorScheme.error) }
                                Text("Experimental YAMNet scores. Categories may overlap; sounds are not attributed to the baby.",style=MaterialTheme.typography.bodySmall)
                            }
                        }
                        if(state.latest?.microphoneSilenced==true && state.active) Text("Android has silenced microphone input. Check privacy controls or other apps.",color=MaterialTheme.colorScheme.error)
                        state.error?.let { Text(it,color=MaterialTheme.colorScheme.error) }
                        TextButton(onClick={ tab=1 }) { Text("Open saved reports") }
                    }
                    1 -> NightReports(repository,state,storageError)
                    2 -> {
                        Text("Settings",style=MaterialTheme.typography.headlineSmall)
                        Text("Theme: Device default · automatically follows light/dark mode")
                        com.babysteps.nurserysensor.sync.DeliverySettings()
                        TextButton(onClick={ startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }) { Text("Battery Optimization Settings") }
                        Text("For this dedicated plugged-in phone, allow Babysteps to run in the background in OnePlus battery settings. Android force-stop, revoked microphone permission, or power loss can still interrupt monitoring.")
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
                                    Text("Local classification",modifier=Modifier.weight(1f))
                                    Switch(checked=classification,enabled=!state.active,onCheckedChange={ classification=it; preferences.edit().putBoolean("classification",it).apply() })
                                }
                                Text("Apply to the next session. Turn off for sound-level reporting only. YAMNet runs offline on CPU; scores and likely episodes are saved, audio is discarded.")
                            }
                        }
                        Text("Microphone permission: ${if(mic) "Granted" else "Not granted"}")
                        Text("Notification permission: ${if(notifications) "Granted / not required" else "Not granted"}")
                        if(!mic || !notifications) OutlinedButton(onClick={ requestPermissions() },enabled=!state.active) { Text("Grant Permissions") }
                        TextButton(onClick={ startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:$packageName"))) }) { Text("App Settings") }
                        Text("Phone time: ${TIME.format(java.time.Instant.now())}")
                        TextButton(onClick={ startActivity(Intent(Settings.ACTION_DATE_SETTINGS)) }) { Text("Date and Time Settings") }
                        Text("Keep automatic date/time enabled to align the report with feed and diaper notes. No crying annotations are required.")
                        Text("Privacy: raw PCM remains in bounded RAM buffers and is erased. No recordings, camera or speech transcription. Optional HTTPS delivery sends numeric/event metadata only.")
                        Text("Reports are kept locally until app data is cleared or the app is uninstalled. Export before running device tests.")
                    }
                }
                message?.let { Text(it) }
        }
    }
    private fun granted(permission: String)=checkSelfPermission(permission)==PackageManager.PERMISSION_GRANTED
    private fun db(value: Double?)=value?.let { String.format(Locale.US,"%.1f dBFS",it) } ?: "—"
    companion object { private val TIME=DateTimeFormatter.ofPattern("MMM d, HH:mm:ss z").withZone(ZoneId.systemDefault()) }
}
