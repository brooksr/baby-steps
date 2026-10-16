package com.babysteps.nurserysensor.sync

import android.content.Context
import com.babysteps.nurserysensor.reporting.NightRepository
import com.babysteps.nurserysensor.monitoring.SensorLog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI

/** One writer, bounded batches, durable SQLite queue; never accepts PCM. */
object DeliveryCoordinator {
    private val mutex=Mutex()
    private val mutable=MutableStateFlow("Not configured")
    val status=mutable.asStateFlow()
    suspend fun sync(context: Context) = mutex.withLock {
        withContext(Dispatchers.IO) {
            val settings=SyncSettings(context)
            if(!settings.enabled) { mutable.value="Off / not configured"; return@withContext }
            try {
                require(settings.internal.selected || SyncSettings.validEndpoint(settings.endpoint))
                val repository=NightRepository.get(context)
                repository.queueSessionSummaries()
                repository.queueNightlySummaries(System.currentTimeMillis())
                var sent=0
                repeat(4) {
                    val records=repository.pendingDelivery(100)
                    if(records.isEmpty()) return@repeat
                    mutable.value="Sending numeric summaries…"
                    // The token travels in the Authorization header (Babysteps Pi). The body
                    // copy serves only the Apps Script fallback, which cannot read headers.
                    val body=JSONObject().put("schemaVersion",NightRepository.DELIVERY_SCHEMA).put("deviceId",settings.deviceId).put("token",settings.token)
                        .put("records",JSONArray().apply { records.forEach { put(JSONObject(it.payload).put("key",it.key)) } }).toString()
                    val reply=if(settings.internal.selected) {
                        val payload=JSONObject(body).apply { remove("token") }
                        val result=settings.internal.call(settings.internal.familyPath("nursery-delivery"),payload)
                        check(result.code in 200..299) { "Account delivery refused (${result.code})" }; result.body
                    } else post(settings.endpoint,settings.token,body)
                    check(reply.optBoolean("ok",false)) { "Receiver did not acknowledge the batch" }
                    val ack=reply.getJSONArray("acceptedKeys")
                    val keys=(0 until ack.length()).map { ack.getString(it) }.toSet()
                    check(keys==records.map { it.key }.toSet()) { "Receiver acknowledgement does not match the batch" }
                    repository.acknowledgeDelivery(records)
                    sent+=records.size
                }
                val pending=repository.pendingDelivery(1).isNotEmpty()
                mutable.value="Last sync ${java.time.Instant.now()} · sent $sent${if(pending) " · backlog will retry" else " · queue clear"}"
                SensorLog.event("metadata_sync_completed","records" to sent,"backlog" to pending)
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) {
                // Never log URLs, tokens, request bodies, private notes or response bodies.
                // check() messages are ours (status codes/reasons), never URLs or tokens.
                val reason=if(e is IllegalStateException) e.message else e.javaClass.simpleName
                mutable.value="Delivery failed ($reason) · saved locally; retries every 5 min while monitoring"
                SensorLog.event("metadata_sync_failed","exception" to e.javaClass.simpleName)
            }
        }
    }
    private fun post(endpoint: String,token: String,body: String): JSONObject {
        fun connection(url: String)=URI(url).toURL().openConnection() as HttpURLConnection
        var c=connection(endpoint)
        try {
            c.apply { requestMethod="POST"; instanceFollowRedirects=false; connectTimeout=15000; readTimeout=15000
                doOutput=true; setRequestProperty("Content-Type","application/json; charset=utf-8")
                setRequestProperty("Authorization","Bearer $token") }
            c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            // Apps Script ContentService redirects only the RESPONSE to this Google
            // host. Fetch with GET; never forward the token/body to a redirect target.
            if(c.responseCode in setOf(302,303)) {
                val target=URI(c.getHeaderField("Location") ?: error("Missing response redirect"))
                check(URI(endpoint).host=="script.google.com" && target.scheme=="https" && target.host=="script.googleusercontent.com") { "Untrusted redirect" }
                c.disconnect(); c=connection(target.toString()).apply { instanceFollowRedirects=false; connectTimeout=15000; readTimeout=15000 }
            }
            check(c.responseCode in 200..299) { "receiver HTTP ${c.responseCode}"+when(c.responseCode) {
                401 -> ": check token"; 409 -> ": a Nursery tab has a different header"; 502 -> ": sheet unavailable"; else -> "" } }
            val result=c.inputStream.bufferedReader().use { reader ->
                val text=StringBuilder(); val buffer=CharArray(2048)
                while(true) { val count=reader.read(buffer); if(count<0) break
                    check(text.length+count<=64000) { "Oversized acknowledgement" }; text.append(buffer,0,count) }
                text.toString()
            }
            return JSONObject(result)
        } finally { c.disconnect() }
    }
}
