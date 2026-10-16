package com.babysteps.nurserysensor.sync

import android.content.Context
import com.babysteps.nurserysensor.monitoring.SensorLog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Last feed, change and heard cry, read back from the family sheet through the Pi for the lock screen. */
data class CareStatus(
    val feedAt: Instant?, val feedDetail: String?,
    val diaperAt: Instant?, val diaperKind: String?,
    val cryAt: Instant?,
    val fetchedAt: Instant,
)

object CareStatusClient {
    private val mutable=MutableStateFlow<CareStatus?>(null)
    val status=mutable.asStateFlow()

    /** GET on the delivery URL with the same token. The Apps Script fallback has no read, so it is skipped. */
    suspend fun refresh(context: Context) = withContext(Dispatchers.IO) {
        val settings=SyncSettings(context)
        if(!settings.enabled || !SyncSettings.validEndpoint(settings.endpoint) || URI(settings.endpoint).host=="script.google.com") return@withContext
        try {
            mutable.value=parse(get(settings.endpoint,settings.token),Instant.now())
        } catch(e: CancellationException) { throw e }
        catch(e: Exception) {
            // Keep the last good status; the lock screen marks it stale by its age. Never log URL or token.
            SensorLog.event("care_status_failed","exception" to e.javaClass.simpleName,"message" to (e as? IllegalStateException)?.message)
        }
    }

    private fun parse(reply: JSONObject,now: Instant): CareStatus {
        check(reply.optBoolean("ok",false)) { "Receiver refused the status read" }
        fun instant(obj: JSONObject?,name: String)=obj?.optString(name)?.takeIf { it.isNotEmpty() }?.let { runCatching { Instant.parse(it) }.getOrNull() }
        val feed=reply.optJSONObject("lastFeed"); val diaper=reply.optJSONObject("lastDiaper"); val cry=reply.optJSONObject("lastCry")
        val feedDetail=feed?.let { listOfNotNull(it.optString("method").takeIf { m -> m.isNotEmpty() && m!="null" },
            it.optDouble("amountOz").takeIf { oz -> !oz.isNaN() }?.let { oz -> "${"%.1f".format(oz).removeSuffix(".0")} oz" },
            it.optString("side").takeIf { s -> s.isNotEmpty() && s!="null" }).joinToString(" ").ifEmpty { null } }
        return CareStatus(instant(feed,"at"),feedDetail,instant(diaper,"at"),diaper?.optString("kind")?.takeIf { it.isNotEmpty() && it!="null" },
            instant(cry,"at"),now)
    }

    private fun get(endpoint: String,token: String): JSONObject {
        val c=URI(endpoint).toURL().openConnection() as HttpURLConnection
        try {
            c.apply { requestMethod="GET"; instanceFollowRedirects=false; connectTimeout=15000; readTimeout=15000
                setRequestProperty("Authorization","Bearer $token") }
            check(c.responseCode in 200..299) { "status HTTP ${c.responseCode}" }
            val text=c.inputStream.bufferedReader().use { it.readText() }
            check(text.length<=16000) { "Oversized status" }
            return JSONObject(text)
        } finally { c.disconnect() }
    }
}

/** Lock screen lines: a collapsed title/text pair and the expanded body. Pure, so it is unit tested. */
object CareStatusText {
    /** Older than this and the numbers are marked stale: the Pi or Wi-Fi is down. */
    val STALE_AFTER: Duration=Duration.ofMinutes(20)

    data class Lines(val title: String,val text: String,val expanded: String)

    fun lines(status: CareStatus,now: Instant,zone: ZoneId): Lines {
        val clock=DateTimeFormatter.ofPattern("h:mm a").withZone(zone)
        fun ago(at: Instant?)=at?.let { since(it,now) } ?: "—"
        fun row(label: String,at: Instant?,detail: String?)=if(at==null) "$label: none logged"
            else "$label ${clock.format(at)} (${since(at,now)})"+(detail?.let { " · $it" } ?: "")
        val stale=Duration.between(status.fetchedAt,now)>STALE_AFTER
        val asOf=(if(stale) "Not updated since " else "Updated ")+clock.format(status.fetchedAt)
        return Lines(
            title="Fed ${ago(status.feedAt)} · Diaper ${ago(status.diaperAt)}",
            text="Cry ${ago(status.cryAt)} · ${if(stale) "stale since ${clock.format(status.fetchedAt)}" else "sound monitoring on"}",
            expanded=listOf(row("Last feed",status.feedAt,status.feedDetail),row("Last diaper",status.diaperAt,status.diaperKind),
                row("Last cry heard",status.cryAt,null),asOf).joinToString("\n"))
    }

    fun since(at: Instant,now: Instant): String {
        val minutes=Duration.between(at,now).toMinutes().coerceAtLeast(0)
        return when {
            minutes<1 -> "just now"
            minutes<60 -> "${minutes}m ago"
            minutes<24*60 -> "${minutes/60}h ${minutes%60}m ago"
            else -> "${minutes/(24*60)}d ${(minutes/60)%24}h ago"
        }
    }
}
