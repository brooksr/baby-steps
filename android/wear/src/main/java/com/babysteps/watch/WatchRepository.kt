package com.babysteps.watch

import android.content.Context
import com.babysteps.internal.InternalConnection
import com.babysteps.internal.InternalProtocol
import com.babysteps.internal.SecureCredentials
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.time.Instant

class WatchSettings(context: Context) {
    val internal=InternalConnection(context,"watch")
    private val secure=SecureCredentials(context,"watch-legacy")
    private val prefs=context.getSharedPreferences("babysteps-watch",Context.MODE_PRIVATE)
    val endpoint get()=prefs.getString("endpoint",DEFAULT_ENDPOINT)!!
    val token get(): String {
        secure.get("token")?.let { return it }
        val old=prefs.getString("token","")!!
        if(old.isNotEmpty()) { secure.set("token",old); prefs.edit().remove("token").commit() }
        return old
    }
    /** Blank is the family's only child; the Pi refuses a blank with two. */
    private val app=context.applicationContext
    private val childPrefs get()=if(internal.selected) app.getSharedPreferences("babysteps-watch-choice-${internal.scope}",Context.MODE_PRIVATE) else prefs
    val child get()=childPrefs.getString("child","")!!
    fun saveChild(value: String) { check(childPrefs.edit().putString("child",value.trim()).commit()) }
    val configured get()=if(internal.selected) internal.configured else validEndpoint(endpoint) && token.length in 32..128

    fun save(endpoint: String,token: String,child: String) {
        require(validEndpoint(endpoint)) { "Use an https URL with no query." }
        require(token.trim().length in 32..128) { "The token is 32–128 characters." }
        secure.set("token",token.trim()); internal.useLegacy()
        check(prefs.edit().putString("endpoint",endpoint.trim().trimEnd('/')).putString("child",child.trim()).commit())
    }

    companion object {
        const val DEFAULT_ENDPOINT="https://raspberrypi.tailc2b8e3.ts.net:8443/api/events"
        fun validEndpoint(value: String)=try {
            val uri=URI(value.trim())
            uri.scheme=="https" && !uri.host.isNullOrBlank() && uri.userInfo==null && uri.query==null && uri.fragment==null
        } catch(_: Exception) { false }
    }
}

/** Status, the running feed timer and the unsent queue, shared by the screens and the ongoing notification. */
object WatchRepository {
    data class Notice(val text: String,val ok: Boolean)

    /** What became of an entry, for the confirmation the watch shows right after the tap. */
    sealed interface Outcome {
        data class Sent(val message: String): Outcome
        /** Kept on the watch with its own time; it goes out on the next try. */
        data class Queued(val reason: String): Outcome
        data class Refused(val reason: String): Outcome
    }

    private val statusFlow=MutableStateFlow<CareStatus?>(null)
    private val timerFlow=MutableStateFlow<FeedTimer?>(null)
    private val pendingFlow=MutableStateFlow(0)
    private val noticeFlow=MutableStateFlow<Notice?>(null)
    val status=statusFlow.asStateFlow()
    val timer=timerFlow.asStateFlow()
    val pending=pendingFlow.asStateFlow()
    val notice=noticeFlow.asStateFlow()
    private val refusedFlow=MutableStateFlow<String?>(null)
    /** The Pi turned an entry down for good: worth interrupting for, unlike a retry. */
    val refused=refusedFlow.asStateFlow()
    /** Sends outlive the screen that started them. */
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main)
    private val sendLock=Mutex()
    private var loaded=false
    private var loadedScope=""

    private fun prefs(context: Context)=context.getSharedPreferences(if(WatchSettings(context).internal.selected) "babysteps-watch-state-${WatchSettings(context).internal.scope}" else "babysteps-watch-state",Context.MODE_PRIVATE)

    fun load(context: Context) {
        val connection=WatchSettings(context).internal
        if(connection.selected && !connection.configured) { statusFlow.value=null; timerFlow.value=null; loaded=false; return }
        val scope=WatchSettings(context).internal.scope
        if(loaded && loadedScope==scope) return
        loaded=true; loadedScope=scope; statusFlow.value=null
        val prefs=prefs(context)
        // A timer saved by an older build has another shape; dropping it beats crashing on it.
        timerFlow.value=prefs.getString("timer",null)?.let { runCatching { FeedTimer.fromJson(JSONObject(it)) }.getOrNull() }
        pendingFlow.value=queue(context).length()
    }

    fun clearNotice() { noticeFlow.value=null }
    fun clearRefused() { refusedFlow.value=null }

    /** Saves the entry on the watch now and sends it in the background. */
    fun submit(context: Context,request: JSONObject) {
        scope.launch { (log(context,request) as? Outcome.Refused)?.let { refusedFlow.value=it.reason } }
    }

    // ── Feed timer ──────────────────────────────────────────────────────────────

    fun startFeed(context: Context,side: String) = saveTimer(context,FeedTimer.start(side,Instant.now()))
    fun switchTo(context: Context,side: String) { timerFlow.value?.let { saveTimer(context,it.switchTo(side,Instant.now())) } }
    fun togglePause(context: Context) { timerFlow.value?.let { saveTimer(context,if(it.paused) it.resume(Instant.now()) else it.pause(Instant.now())) } }
    fun cancelFeed(context: Context) = saveTimer(context,null)

    /** Ends the timer as one logged feed; returns what to confirm, or null with no timer running. */
    fun stopFeed(context: Context): String? {
        val timer=timerFlow.value ?: return null
        val now=Instant.now()
        saveTimer(context,null)
        submit(context,timer.request(now,java.time.ZoneId.systemDefault()))
        return "${timer.minutes(now)} min ${CareText.sideLetter(timer.loggedSide(now))}"
    }

    private fun saveTimer(context: Context,timer: FeedTimer?) {
        timerFlow.value=timer
        val value=timer?.toJson()?.toString()
        check(prefs(context).edit().putString("timer",value).commit())
        FeedNotification.update(context,timer)
    }

    // ── Logging ─────────────────────────────────────────────────────────────────

    /** Queue first, then send: an entry tapped with no signal is kept, with its own time, until the Pi takes it. */
    suspend fun log(context: Context,request: JSONObject): Outcome {
        sendLock.withLock {
            load(context)
            val settings=WatchSettings(context)
            if(settings.internal.selected) {
                val meta=runCatching { JSONObject(prefs(context).getString("internalMeta","{}")!!) }.getOrDefault(JSONObject())
                val command=try { InternalProtocol.watchCommand(request,meta,settings.child) } catch(e: Exception) { return Outcome.Refused(e.message ?: "Sync before logging") }
                request.put("_internalCommand",command)
            }
            val q=queue(context); q.put(request.toString()); saveQueue(context,q)
        }
        val outcome=flush(context)
        refresh(context)
        return outcome
    }

    /** Sends the queue in order. The outcome is the last entry's, or why the queue stopped. */
    suspend fun flush(context: Context): Outcome = withContext(Dispatchers.IO) {
        val settings=WatchSettings(context)
        if(!settings.configured) { noticeFlow.value=Notice("Set the token in Settings",false); return@withContext Outcome.Queued("Add the token in Settings") }
        var outcome: Outcome=Outcome.Sent("")
        sendLock.withLock {
            var q=queue(context)
            while(q.length()>0) {
                val body=JSONObject(q.getString(0)).apply { if(settings.child.isNotEmpty()) put("child",settings.child) }
                val result=try { if(settings.internal.selected) { val response=settings.internal.call(settings.internal.familyPath("mutations"),body.getJSONObject("_internalCommand")); Reply(response.code,response.body) } else send(settings,"POST",settings.endpoint,body.toString()) }
                    catch(e: CancellationException) { throw e }
                    catch(_: IOException) { outcome=Outcome.Queued("No connection"); noticeFlow.value=Notice("Offline · ${q.length()} saved to send",false); break }
                when {
                    result.code in 200..299 -> { outcome=Outcome.Sent(result.body.optString("message","Logged")); noticeFlow.value=null }
                    result.code==400 || result.code==413 -> {
                        // The Pi will never take this one; drop it rather than block the rest.
                        val reason=result.body.optJSONArray("errors")?.optString(0) ?: "Refused: ${result.body.optString("error")}"
                        outcome=Outcome.Refused(reason); noticeFlow.value=Notice(reason,false)
                    }
                    result.code==401 -> { outcome=Outcome.Queued("Token refused"); noticeFlow.value=Notice("Token refused · check Settings",false); break }
                    // The Pi answers its old routes with 410 once it has moved to accounts; keep the entry.
                    result.code==410 -> { outcome=Outcome.Queued("Connect your account"); noticeFlow.value=Notice("Pi moved to accounts · connect in Settings",false); break }
                    else -> { outcome=Outcome.Queued("Pi unavailable"); noticeFlow.value=Notice("Pi unavailable (${result.code}) · will retry",false); break }
                }
                q=JSONArray().also { next -> for(i in 1 until q.length()) next.put(q.getString(i)) }
                saveQueue(context,q)
            }
        }
        outcome
    }

    suspend fun refresh(context: Context) = withContext(Dispatchers.IO) {
        load(context)
        val settings=WatchSettings(context)
        if(settings.internal.selected) {
            try {
                val reply=settings.internal.call(settings.internal.familyPath("bootstrap"))
                if(reply.code !in 200..299) { noticeFlow.value=Notice("Sign in again · queued entries are kept",false); statusFlow.value=null; return@withContext }
                prefs(context).edit().putString("internalMeta",reply.body.toString()).commit()
                val status=CareStatus.fromBootstrap(reply.body.getJSONObject("data"),settings.child,Instant.now())
                if(status==null) { noticeFlow.value=Notice("Choose a child in Settings",false); return@withContext }
                statusFlow.value=status
            } catch(e: CancellationException) { throw e } catch(_: Exception) { /* Retain a stale-marked last read. */ }
            return@withContext
        }
        if(!settings.configured) return@withContext
        val url=settings.endpoint+"/status"+(settings.child.takeIf { it.isNotEmpty() }?.let { "?child="+java.net.URLEncoder.encode(it,"UTF-8") } ?: "")
        try {
            val result=send(settings,"GET",url,null)
            if(result.code==401) { noticeFlow.value=Notice("Token refused · check Settings",false); return@withContext }
            if(result.code==410) { noticeFlow.value=Notice("Pi moved to accounts · connect in Settings",false); return@withContext }
            statusFlow.value=CareStatus.parse(result.body,Instant.now())
        } catch(e: CancellationException) { throw e }
        catch(_: Exception) { /* Keep the last good status; the screen marks it stale by its age. */ }
    }

    private fun queue(context: Context)=runCatching { JSONArray(prefs(context).getString("queue","[]")) }.getOrDefault(JSONArray())

    private fun saveQueue(context: Context,q: JSONArray) {
        check(prefs(context).edit().putString("queue",q.toString()).commit())
        pendingFlow.value=q.length()
    }

    private class Reply(val code: Int,val body: JSONObject)

    private fun send(settings: WatchSettings,method: String,url: String,body: String?): Reply {
        val c=URI(url).toURL().openConnection() as HttpURLConnection
        try {
            c.requestMethod=method; c.instanceFollowRedirects=false; c.connectTimeout=15000; c.readTimeout=20000
            c.setRequestProperty("Authorization","Bearer ${settings.token}")
            if(body!=null) {
                c.doOutput=true; c.setRequestProperty("Content-Type","application/json")
                c.outputStream.use { it.write(body.toByteArray()) }
            }
            val code=c.responseCode
            val text=(if(code<400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            return Reply(code,runCatching { JSONObject(text.take(16000)) }.getOrDefault(JSONObject()))
        } finally { c.disconnect() }
    }
}
