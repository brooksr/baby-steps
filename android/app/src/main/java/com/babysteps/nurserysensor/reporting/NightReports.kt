package com.babysteps.nurserysensor.reporting

import android.os.SystemClock
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.babysteps.nurserysensor.audio.AudioStatistics
import com.babysteps.nurserysensor.monitoring.MonitoringState
import com.babysteps.nurserysensor.monitoring.ServiceStatus
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun NightReports(repository: NightRepository?, monitoring: MonitoringState, storageError: String?) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var message by remember { mutableStateOf<String?>(null) }
    if (repository == null) {
        Text(storageError ?: "Opening overnight storage…")
        return
    }
    val sessions by repository.sessions.collectAsStateWithLifecycle()
    var selectedId by rememberSaveable { mutableStateOf<Long?>(null) }
    var report by remember { mutableStateOf<NightReport?>(null) }
    var busy by remember { mutableStateOf(false) }
    var note by rememberSaveable { mutableStateOf("") }
    var selectedLabel by rememberSaveable { mutableStateOf("feed") }
    var pendingExport by rememberSaveable { mutableStateOf<Pair<Long, String>?>(null) }
    val selected = sessions.firstOrNull { it.id == selectedId } ?: sessions.firstOrNull()
    LaunchedEffect(selected) {
        report = null
        selected?.let { session ->
            // The on-screen report uses episode aggregates, not every model frame. Full scores
            // are read only for explicit export, avoiding repeated large reads during capture.
            try { report = withContext(Dispatchers.IO) { repository.report(session.id,includePredictions=false,
                fromOffsetMs=(session.elapsedMs-86400000L).coerceAtLeast(0)) } }
            catch (e: Exception) { message = "Could not load report: ${e.message}" }
        }
    }
    val exportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uri = result.data?.data
        val request = pendingExport
        pendingExport = null
        if (result.resultCode == android.app.Activity.RESULT_OK && uri != null && request != null) {
            scope.launch {
                busy = true
                try {
                    withContext(Dispatchers.IO) {
                        val snapshot = repository.report(request.first)
                        val output = context.contentResolver.openOutputStream(uri, "wt") ?: error("Cannot open selected destination")
                        output.bufferedWriter(Charsets.UTF_8).use {
                            when(request.second) {
                                "json" -> NightExport.writeJson(snapshot,it)
                                "events" -> NightExport.writeEventsCsv(snapshot,it)
                                else -> NightExport.writeCsv(snapshot,it)
                            }
                        }
                    }
                    message = "${request.second.uppercase()} saved. JSON includes session details and manual markers."
                } catch (e: Exception) { message = "Export failed: ${e.message}" }
                finally { busy = false }
            }
        }
    }

    Text("Overnight reports", style = MaterialTheme.typography.titleLarge)
    Text("Sound levels, likely sound episodes, and care markers are saved locally. All sessions are retained.")
    Text("Phone time: ${localTime(System.currentTimeMillis(), ZoneId.systemDefault().id)} — check automatic date/time before bed.")
    if (monitoring.status == ServiceStatus.RUNNING && monitoring.sessionId != null) {
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Manual event marker", style = MaterialTheme.typography.titleMedium)
                Text("Optional: log care events here, or keep your existing feed/diaper notes to compare tomorrow. These are not automatic sound detections.")
                listOf("feed", "diaper", "room_note", "ambient_noise").forEach { label ->
                    TextButton(onClick = { selectedLabel = label }) { Text("${if (selectedLabel == label) "✓ " else ""}$label") }
                }
                OutlinedTextField(value = note, onValueChange = { note = it.take(500) }, label = { Text("Optional note / room conditions") }, modifier = Modifier.fillMaxWidth())
                Button(onClick = {
                    val id = monitoring.sessionId
                    val timestamp = System.currentTimeMillis()
                    val offset = SystemClock.elapsedRealtime() - (monitoring.startedElapsedMs ?: SystemClock.elapsedRealtime())
                    val savedLabel = selectedLabel; val savedNote = note
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) { repository.mark(id, timestamp, offset, savedLabel, savedNote) }
                            message = "Saved manual marker: $savedLabel"; note = ""
                        } catch (e: Exception) { message = "Marker could not be saved: ${e.message}" }
                    }
                }) { Text("Save Marker") }
            }
        }
    }
    if (sessions.isEmpty()) Text("No saved sessions yet. Start Monitoring to begin tonight's report.")
    sessions.forEach { s ->
        TextButton(onClick = { selectedId = s.id }) {
            Text("Session ${s.id}: ${localTime(s.startedAtMs, s.zoneId)} • ${s.status} • ${s.binCount} saved buckets")
        }
    }
    selected?.let { s ->
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Report for session ${s.id}", style = MaterialTheme.typography.titleMedium)
                Text("${localTime(s.startedAtMs, s.zoneId)} → ${s.endedAtMs?.let { localTime(it, s.zoneId) } ?: "running (last persisted heartbeat)"}")
                Text("Status: ${s.status} • elapsed ${duration(s.elapsedMs)}")
                Text("Saved summaries: ${s.binCount} • valid input ${duration(s.validMs)}")
                Text("Valid capture coverage: ${String.format(Locale.US, "%.1f%%", s.coveragePercent)}")
                Text("Silenced input: ${duration(s.silencedMs)} • unobserved time: ${duration(s.unobservedMs)}")
                Text("Energy average: ${s.meanSquare?.let { db(AudioStatistics.powerDbfs(it)) } ?: "no valid input"} • peak: ${s.peakDbfs?.let(::db) ?: "—"}")
                Text("Near-clipping windows: ${s.clippedWindows} • manual markers: ${s.markerCount}")
                Text("Classifier: ${s.modelStatus} • ${s.inferenceCount} predictions • ${s.droppedWindows} dropped windows")
                if(s.inferenceCount>0) Text("Inference: mean ${s.inferenceTotalMs/s.inferenceCount} ms • max ${s.inferenceMaxMs} ms")
                s.modelError?.let { Text(it,color=MaterialTheme.colorScheme.error) }
                if (s.endedAtMs != null && kotlin.math.abs(s.endedAtMs - s.startedAtMs - s.elapsedMs) > 5000)
                    Text("Phone clock changed during this session. Use elapsed offsets for duration comparisons.", color = MaterialTheme.colorScheme.error)
                s.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                if (s.status == "interrupted") Text("The tail after the last saved heartbeat is unknown; this is not a complete night's coverage.")
                report?.takeIf { it.session.id == s.id }?.let { r ->
                    SessionTimeline(r)
                    Text("Likely sound episodes (latest 24 hours)",style=MaterialTheme.typography.titleMedium)
                    if(r.episodes.isEmpty()) Text("No confirmed episodes in this saved report. This does not prove there was no crying.")
                    r.episodes.groupBy { it.label }.forEach { (label,events) ->
                        Text("${label.eventName.replace('_',' ')}: ${events.size} episodes • ${duration(events.sumOf { it.durationMs })} total • longest ${duration(events.maxOf { it.durationMs })}")
                    }
                    Text("Experimental model estimates; overlapping categories are counted separately. Stop monitoring to finalize active episodes.",style=MaterialTheme.typography.bodySmall)
                    val minutes = remember(r) { minuteLevels(r.bins) }
                    Text("Recent minute averages", style = MaterialTheme.typography.titleSmall)
                    minutes.takeLast(10).forEach { (minute, level) -> Text("+${minute} min: ${db(level)}") }
                    r.markers.takeLast(10).forEach { marker ->
                        Text("Manual ${marker.label} at +${duration(marker.offsetMs)}${if (marker.note.isBlank()) "" else ": ${marker.note}"}")
                    }
                    r.episodes.takeLast(20).forEach { event ->
                        Text("Likely ${event.label.eventName.replace('_',' ')} at ${localTime(s.startedAtMs+event.startOffsetMs,s.zoneId)} • ${duration(event.durationMs)} • max score ${String.format(Locale.US,"%.2f",event.maxScore)}")
                    }
                    Text("Loudest measured seconds",style=MaterialTheme.typography.titleSmall)
                    r.bins.filter { it.peakDbfs!=null }.sortedByDescending { it.peakDbfs }.take(3).forEach { bin ->
                        Text("${localTime(bin.timestampMs,s.zoneId)} • peak ${db(bin.peakDbfs!!)}")
                    }
                }
                listOf("json", "csv", "events").forEach { format ->
                    OutlinedButton(enabled = !busy && pendingExport == null && !monitoring.active, onClick = {
                        pendingExport = s.id to format
                        exportLauncher.launch(android.content.Intent(android.content.Intent.ACTION_CREATE_DOCUMENT).apply {
                            addCategory(android.content.Intent.CATEGORY_OPENABLE)
                            type = if (format == "json") "application/json" else "text/csv"
                            putExtra(android.content.Intent.EXTRA_TITLE, if(format=="events") "babysteps-session-${s.id}-events.csv" else "babysteps-session-${s.id}.$format")
                        })
                    }) { Text(if(format=="events") "Export events CSV" else "Export ${format.uppercase()}") }
                }
                if(monitoring.active) Text("Stop monitoring to finalize episodes and export the report.")
                Text("JSON includes model scores, settings, episodes and care notes. CSV is the numeric timeline; events CSV contains episodes and manual markers. Save to Downloads and share tomorrow.")
            }
        }
    }
    message?.let { Text(it) }
}

private fun minuteLevels(bins: List<SoundBin>): List<Pair<Long, Double>> = bins.groupBy { it.offsetMs / 60_000 }
    .mapNotNull { (minute, values) ->
        val valid = values.sumOf { it.validMs }
        if (valid == 0L) null else minute to AudioStatistics.powerDbfs(values.sumOf { (it.meanSquare ?: 0.0) * it.validMs } / valid)
    }.sortedBy { it.first }
private fun db(value: Double): String = String.format(Locale.US, "%.1f dBFS", value)
private fun duration(ms: Long): String = String.format(Locale.US, "%dh %02dm %02ds", ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60)
private fun localTime(ms: Long, zone: String): String = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss z")
    .withZone(ZoneId.of(zone)).format(Instant.ofEpochMilli(ms))
