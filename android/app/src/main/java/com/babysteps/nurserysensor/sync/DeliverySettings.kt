package com.babysteps.nurserysensor.sync

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable fun DeliverySettings() {
    val context=LocalContext.current
    val settings=remember { SyncSettings(context) }
    var endpoint by remember { mutableStateOf(settings.endpoint) }
    var token by remember { mutableStateOf(settings.token) }
    var enabled by remember { mutableStateOf(settings.enabled) }
    var message by remember { mutableStateOf<String?>(null) }
    val status by DeliveryCoordinator.status.collectAsStateWithLifecycle()
    val scope=rememberCoroutineScope()
    var accountApi by remember { mutableStateOf("https://raspberrypi.tailc2b8e3.ts.net:8443/api/v1") }
    var pairCode by remember { mutableStateOf("") }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            Text("Automatic summary delivery",style=MaterialTheme.typography.titleMedium)
            Text("Every 5 minutes while monitoring, sends nightly summaries, 15-minute sound levels, completed cry/speech/snoring/cough episodes and session health. Per-second data stays on the phone. No PCM, recordings, transcripts or manual notes are uploaded.")
            OutlinedTextField(accountApi,{ accountApi=it.trim() },label={ Text("BabySteps account server") },modifier=Modifier.fillMaxWidth())
            OutlinedButton(onClick={ scope.launch {
                try {
                    check(!com.babysteps.nurserysensor.monitoring.MonitoringStore.state.value.active) { "Stop monitoring before changing the delivery family." }
                    val reply=withContext(Dispatchers.IO) { settings.internal.begin(accountApi,"nursery",settings.deviceId) }
                    pairCode=reply.getString("userCode"); message="Approve $pairCode in the website Account page. This connection can send nursery metadata only."
                } catch(e: Exception) { message=e.message }
            } }) { Text("Connect nursery account") }
            if(pairCode.isNotEmpty()) OutlinedButton(onClick={ scope.launch {
                try {
                    check(!com.babysteps.nurserysensor.monitoring.MonitoringStore.state.value.active) { "Stop monitoring before changing the delivery family." }
                    if(withContext(Dispatchers.IO) { settings.internal.complete() }) {
                        pairCode=""; message="Nursery account connected. Turn on delivery, save, then start monitoring. Earlier nights stay in their original family's database."
                        (context as? android.app.Activity)?.recreate()
                    } else message="The website has not approved this code yet."
                } catch(e: Exception) { message=e.message }
            } }) { Text("I approved the nursery code") }
            if(settings.internal.selected) OutlinedButton(onClick={
                if(com.babysteps.nurserysensor.monitoring.MonitoringStore.state.value.active) message="Stop monitoring before disconnecting."
                else { settings.internal.disconnect(); message="Disconnected; data is kept locally." }
            }) { Text("Disconnect nursery account") }
            Row { Text("Enable delivery",Modifier.weight(1f)); Switch(enabled,onCheckedChange={ enabled=it }) }
            OutlinedTextField(endpoint,{ endpoint=it.trim() },label={ Text("HTTPS receiver URL") },modifier=Modifier.fillMaxWidth(),singleLine=true)
            OutlinedTextField(token,{ token=it },label={ Text("Receiver token") },modifier=Modifier.fillMaxWidth(),singleLine=true,visualTransformation=PasswordVisualTransformation())
            Button(onClick={
                scope.launch {
                    try { withContext(Dispatchers.IO) { settings.save(enabled,endpoint,token) }; message="Saved. Delivery uses these settings on its next cycle." }
                    catch(e: Exception) { message=e.message ?: "Could not save delivery settings" }
                }
            }) { Text("Save Delivery Settings") }
            OutlinedButton(onClick={ scope.launch { DeliveryCoordinator.sync(context) } }) { Text("Sync Now") }
            Text(status,style=MaterialTheme.typography.bodySmall)
            message?.let { Text(it) }
            Text("Receiver: the Babysteps Pi at https://<pi>.ts.net:8443/api/nursery with its NURSERY_API_TOKEN (see docs/CONTINUOUS_MONITORING.md). URL and token stay in private app preferences; app backup is disabled.",style=MaterialTheme.typography.bodySmall)
        }
    }
}
