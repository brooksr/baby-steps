package com.babysteps.nurserysensor.care.data

import android.content.Context
import com.babysteps.internal.InternalConnection
import com.babysteps.internal.InternalProtocol
import com.babysteps.internal.SecureCredentials
import com.babysteps.nurserysensor.care.domain.Family
import com.babysteps.nurserysensor.care.domain.NurseryData
import com.babysteps.nurserysensor.care.model.CareEvent
import com.babysteps.nurserysensor.care.model.Profile
import com.babysteps.nurserysensor.care.model.ShoppingItem
import com.babysteps.nurserysensor.care.model.TaskItem
import com.babysteps.nurserysensor.care.model.Tracker
import com.babysteps.nurserysensor.care.model.isoString
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.time.Instant

/** Where the Pi is, and the app's own `APP_API_TOKEN`. Private prefs; app backup is off. */
class AppSettings(context: Context) {
    val internal=InternalConnection(context,"phone")
    private val secure=SecureCredentials(context,"phone-legacy")
    private val prefs=context.getSharedPreferences("babysteps-app",Context.MODE_PRIVATE)
    val endpoint get()=prefs.getString("endpoint",DEFAULT_ENDPOINT)!!
    val token get(): String {
        secure.get("token")?.let { return it }
        val old=prefs.getString("token","")!!
        if(old.isNotEmpty()) { secure.set("token",old); check(prefs.edit().remove("token").commit()) }
        return old
    }
    val configured get()=if(internal.selected) internal.configured else validEndpoint(endpoint) && token.length in 32..128

    fun save(endpoint: String,token: String) {
        require(validEndpoint(endpoint)) { "Use an https URL with no query." }
        require(token.trim().length in 32..128) { "The token is 32–128 characters." }
        secure.set("token",token.trim()); internal.useLegacy()
        check(prefs.edit().putString("endpoint",endpoint.trim().trimEnd('/')).commit())
    }

    companion object {
        const val DEFAULT_ENDPOINT="https://raspberrypi.tailc2b8e3.ts.net:8443/api/events/app"
        fun validEndpoint(value: String)=try {
            val uri=URI(value.trim())
            uri.scheme=="https" && !uri.host.isNullOrBlank() && uri.userInfo==null && uri.query==null && uri.fragment==null
        } catch(_: Exception) { false }
    }
}

/**
 * The family's tracker, read from and written to the shared sheet through the Pi.
 *
 * Every change goes into a durable outbox first and shows on screen at once, the
 * way the web app's local store does: a feed logged with no signal is kept, with
 * its own time, until the Pi takes it. The phone names its own ids, so a retry
 * after a reply that never arrived finds the row it already wrote.
 */
object CareRepository {
    data class State(
        val tracker: Tracker=Tracker.EMPTY,
        /** A read has landed (or the cache was loaded) — before that, there is nothing to show. */
        val loaded: Boolean=false,
        val fetchedAt: Instant?=null,
        val pending: Int=0,
        /** Why the last read or send failed, in words for the screen; null when all is well. */
        val problem: String?=null,
        val configured: Boolean=false,
        val caregiver: Boolean=false,
        val actorProfileId: String?=null,
    )

    private val mutable=MutableStateFlow(State())
    val state=mutable.asStateFlow()
    private val nurseryFlow=MutableStateFlow<NurseryData?>(null)
    val nursery=nurseryFlow.asStateFlow()
    /** A change refused for good (bad input, or deleted elsewhere): worth telling someone. */
    private val refusedFlow=MutableStateFlow<String?>(null)
    val refused=refusedFlow.asStateFlow()

    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main)
    private val sendLock=Mutex()
    private var server=Tracker.EMPTY
    private var outbox=JSONArray()
    /** Bumped on every local change, so a read that began before it cannot reinstate the old rows. */
    private var generation=0L
    private var loaded=false
    private var loadedScope=""
    private var internalMeta=JSONObject()

    private fun cacheFile(context: Context)=File(context.filesDir,if(AppSettings(context).internal.selected) "babysteps-tracker-${AppSettings(context).internal.scope}.json" else "babysteps-tracker.json")
    private fun prefs(context: Context)=context.getSharedPreferences(if(AppSettings(context).internal.selected) "babysteps-app-state-${AppSettings(context).internal.scope}" else "babysteps-app-state",Context.MODE_PRIVATE)

    fun load(context: Context) {
        val connection=AppSettings(context).internal
        if(connection.selected && !connection.configured) {
            server=Tracker.EMPTY; loaded=false
            mutable.value=State(problem="Sign in to open this account",configured=false); return
        }
        val scope=AppSettings(context).internal.scope
        if(loaded && loadedScope==scope) return
        loaded=true; loadedScope=scope
        internalMeta=runCatching { JSONObject(prefs(context).getString("internalMeta","{}")!!) }.getOrDefault(JSONObject())
        val app=context.applicationContext
        outbox=runCatching { JSONArray(prefs(app).getString("outbox","[]")) }.getOrDefault(JSONArray())
        val cached=runCatching { JSONObject(cacheFile(app).readText()) }.getOrNull()
        server=cached?.let(Tracker::parse) ?: Tracker.EMPTY
        nurseryFlow.value=runCatching { NurseryData.parse(JSONObject(prefs(app).getString("nursery","{}")!!)) }.getOrNull()
        publish(app,loaded=cached!=null,fetchedAt=cached?.optLong("fetchedAt")?.takeIf { it>0 }?.let(Instant::ofEpochMilli))
    }

    fun clearRefused() { refusedFlow.value=null }

    private fun publish(context: Context,loaded: Boolean=mutable.value.loaded,fetchedAt: Instant?=mutable.value.fetchedAt,problem: String?=mutable.value.problem) {
        mutable.value=State(applyOutbox(server,outbox),loaded,fetchedAt,outbox.length(),problem,AppSettings(context).configured,internalMeta.optString("role")=="caregiver",internalMeta.optString("actorProfileId").takeIf { it.isNotEmpty() })
    }

    // ── Reads ───────────────────────────────────────────────────────────────────

    suspend fun refresh(context: Context) = withContext(Dispatchers.IO) {
        val app=context.applicationContext
        withContext(Dispatchers.Main) { load(app) }
        val settings=AppSettings(app)
        if(settings.internal.selected) { refreshInternal(app,settings.internal); return@withContext }
        if(!settings.configured) { withContext(Dispatchers.Main) { publish(app,problem="Connect to the Babysteps Pi in Settings") }; return@withContext }
        val seen=generation
        try {
            val reply=send(settings,"GET",settings.endpoint,null)
            when {
                reply.code==401 -> withContext(Dispatchers.Main) { publish(app,problem="The Pi refused the app token · check Settings") }
                // The Pi answers the old shared-token route with 410 once it has moved to accounts.
                reply.code==410 -> withContext(Dispatchers.Main) { publish(app,problem="This Pi now uses BabySteps accounts · connect your account in Settings") }
                reply.code!in 200..299 -> withContext(Dispatchers.Main) { publish(app,problem="The Pi could not read the sheet (${reply.code}) · showing the last copy") }
                else -> {
                    val tracker=Tracker.parse(reply.body)
                    val now=Instant.now()
                    cacheFile(app).writeText(tracker.toJson().put("fetchedAt",now.toEpochMilli()).toString())
                    withContext(Dispatchers.Main) {
                        // A change made while this read was in flight wins; the next read picks it up.
                        if(generation==seen) server=tracker
                        publish(app,loaded=true,fetchedAt=now,problem=null)
                    }
                }
            }
        } catch(e: CancellationException) { throw e }
        catch(_: Exception) { withContext(Dispatchers.Main) { publish(app,problem="Offline · showing the last copy") } }
    }

    suspend fun refreshNursery(context: Context) = withContext(Dispatchers.IO) {
        val app=context.applicationContext; val settings=AppSettings(app)
        if(settings.internal.selected) {
            try {
                val reply=settings.internal.call(settings.internal.familyPath("nursery"))
                if(reply.code in 200..299) nurseryFlow.value=NurseryData.parse(reply.body.optJSONObject("nursery"))
            } catch(e: CancellationException) { throw e } catch(_: Exception) {}
            return@withContext
        }
        if(!settings.configured) return@withContext
        try {
            val reply=send(settings,"GET",settings.endpoint+"/nursery",null)
            if(reply.code in 200..299) {
                val data=reply.body.optJSONObject("nursery")
                prefs(app).edit().putString("nursery",data?.toString() ?: "{}").apply()
                nurseryFlow.value=NurseryData.parse(data)
            }
        } catch(e: CancellationException) { throw e } catch(_: Exception) {}
    }

    // ── Writes ──────────────────────────────────────────────────────────────────

    fun addEvent(context: Context,input: JSONObject) {
        val now=isoString(Instant.now())
        if(!input.has("id")) input.put("id",com.babysteps.nurserysensor.care.model.newId("event"))
        input.put("createdAt",input.optString("createdAt").ifEmpty { now }).put("updatedAt",now).put("syncState","synced")
        enqueue(context,JSONObject().put("op","addEvent").put("input",input))
    }
    fun updateEvent(context: Context,event: JSONObject)=enqueue(context,JSONObject().put("op","updateEvent").put("event",event.put("updatedAt",isoString(Instant.now()))))
    fun deleteEvent(context: Context,id: String)=enqueue(context,JSONObject().put("op","deleteEvent").put("id",id))
    fun saveProfile(context: Context,patch: JSONObject)=enqueue(context,JSONObject().put("op","saveProfile").put("profile",patch))
    fun addProfile(context: Context,input: JSONObject)=enqueue(context,JSONObject().put("op","addProfile").put("input",input))
    fun archiveProfile(context: Context,id: String)=enqueue(context,JSONObject().put("op","archiveProfile").put("id",id))
    fun restoreProfile(context: Context,id: String)=enqueue(context,JSONObject().put("op","restoreProfile").put("id",id))
    fun saveShoppingItem(context: Context,input: JSONObject)=enqueue(context,JSONObject().put("op","saveShoppingItem").put("input",input))
    fun removeShoppingItem(context: Context,id: String)=enqueue(context,JSONObject().put("op","removeShoppingItem").put("id",id))
    fun saveTask(context: Context,input: JSONObject)=enqueue(context,JSONObject().put("op","saveTask").put("input",input))
    fun removeTask(context: Context,id: String)=enqueue(context,JSONObject().put("op","removeTask").put("id",id))

    private fun enqueue(context: Context,op: JSONObject) {
        val app=context.applicationContext
        load(app)
        // A new list row is named here, so its retry patches the same row.
        when(op.optString("op")) {
            "saveShoppingItem" -> op.getJSONObject("input").let { if(!it.has("id")) it.put("id",com.babysteps.nurserysensor.care.model.newId("shop")) }
            "saveTask" -> op.getJSONObject("input").let { if(!it.has("id")) it.put("id",com.babysteps.nurserysensor.care.model.newId("task")) }
        }
        val connection=AppSettings(app).internal
        if(connection.selected) {
            op.put("_internalCommand",InternalProtocol.command(op,internalMeta,outbox))
            if(op.optString("op")=="addEvent" && internalMeta.optString("role")=="caregiver") op.getJSONObject("input").put("caregiverId",internalMeta.optString("actorProfileId"))
        }
        generation++
        outbox.put(op)
        saveOutbox(app)
        publish(app)
        scope.launch { flush(app); refresh(app) }
    }

    private fun saveOutbox(context: Context) { check(prefs(context).edit().putString("outbox",outbox.toString()).commit()) }

    /** Sends the outbox in order. Stops at the first change the Pi could not take yet. */
    suspend fun flush(context: Context) = sendLock.withLock {
        val app=context.applicationContext
        withContext(Dispatchers.Main) { load(app) }
        val settings=AppSettings(app)
        if(settings.internal.selected) { withContext(Dispatchers.IO) { flushInternal(app,settings.internal) }; return@withLock }
        if(!settings.configured) return@withLock
        withContext(Dispatchers.IO) {
            while(true) {
                val op=withContext(Dispatchers.Main) { if(outbox.length()>0) outbox.getJSONObject(0) else null } ?: break
                val result=try { send(settings,"POST",settings.endpoint,op.toString()) }
                    catch(e: CancellationException) { throw e }
                    catch(_: IOException) { withContext(Dispatchers.Main) { publish(app,problem="Offline · ${outbox.length()} change${if(outbox.length()==1) "" else "s"} saved to send") }; break }
                // 410 is the Pi having moved to accounts: keep the change for the export/connect path, never drop it.
                val retry=result.code==401 || result.code==410 || result.code==429 || result.code>=500
                if(retry) {
                    withContext(Dispatchers.Main) { publish(app,problem=when(result.code) { 401 -> "The Pi refused the app token · check Settings"
                        410 -> "This Pi now uses BabySteps accounts · connect your account in Settings"; else -> "The Pi is unavailable (${result.code}) · will retry" }) }
                    break
                }
                withContext(Dispatchers.Main) {
                    if(result.code !in 200..299) refusedFlow.value=result.body.optJSONArray("errors")?.optString(0) ?: "The Pi refused a change (${result.code})"
                    else applyResult(op,result.body.opt("result"))
                    outbox=JSONArray().also { next -> for(i in 1 until outbox.length()) next.put(outbox.get(i)) }
                    saveOutbox(app)
                    publish(app,problem=null)
                }
            }
        }
    }

    /** Folds what the Pi wrote into the last read, so the screen does not flicker back before the next one. */
    private fun applyResult(op: JSONObject,result: Any?) {
        server=applyOutbox(server,JSONArray().put(op))
        if(result is JSONObject && op.optString("op")=="addProfile") {
            server=server.copy(profiles=server.profiles.filter { it.id!=result.optString("id") && it.id!=op.optJSONObject("input")?.optString("pendingId") }+Profile(result))
        }
    }

    private suspend fun refreshInternal(app: Context,connection: InternalConnection) {
        val seen=generation
        try {
            val reply=connection.call(connection.familyPath("bootstrap"))
            if(reply.code !in 200..299) {
                withContext(Dispatchers.Main) {
                    if(reply.code==401 || reply.code==403) { server=Tracker.EMPTY; mutable.value=State(loaded=false,pending=outbox.length(),problem="Sign in again to continue. Queued changes are kept.",configured=false) }
                    else publish(app,problem="Could not sync (${reply.code}) · keeping the last copy")
                }; return
            }
            val tracker=Tracker.parse(reply.body.getJSONObject("data")); val meta=JSONObject(reply.body.toString()).apply { remove("data") }
            withContext(Dispatchers.Main) {
                if(loadedScope!=connection.scope) return@withContext
                internalMeta=meta; prefs(app).edit().putString("internalMeta",meta.toString()).commit()
                if(generation==seen) { server=tracker; cacheFile(app).writeText(tracker.toJson().toString()) }
                publish(app,loaded=true,fetchedAt=Instant.now(),problem=null)
            }
        } catch(e: CancellationException) { throw e }
        catch(_: Exception) { withContext(Dispatchers.Main) { publish(app,problem="Offline · changes stay on this phone") } }
    }
    private suspend fun flushInternal(app: Context,connection: InternalConnection) {
        while(true) {
            val op=withContext(Dispatchers.Main) { if(outbox.length()>0) outbox.getJSONObject(0) else null } ?: break
            val command=op.optJSONObject("_internalCommand") ?: break
            val reply=try { connection.call(connection.familyPath("mutations"),command) } catch(_: IOException) { break }
            if(reply.code !in 200..299) {
                withContext(Dispatchers.Main) { publish(app,problem=if(reply.code==409) "A queued change conflicts with another device. Export the queue before resolving it." else "A queued change was refused (${reply.code}); it is kept.") }; break
            }
            withContext(Dispatchers.Main) {
                val revisions=internalMeta.optJSONObject("revisions") ?: JSONObject()
                revisions.put(command.getString("collection")+":"+command.getString("id"),reply.body.getInt("revision"))
                reply.body.optJSONArray("related")?.let { related -> for(i in 0 until related.length()) { val r=related.getJSONObject(i); revisions.put(r.getString("collection")+":"+r.getString("id"),r.getInt("revision")) } }
                internalMeta.put("revisions",revisions)
                applyResult(op,reply.body.optJSONObject("payload"))
                outbox=JSONArray().also { next -> for(i in 1 until outbox.length()) next.put(outbox.get(i)) }
                saveOutbox(app); prefs(app).edit().putString("internalMeta",internalMeta.toString()).commit(); publish(app,problem=null)
            }
        }
    }
    fun pendingExport(context: Context): String { load(context); return outbox.toString(2) }
    fun pendingLabels(context: Context): List<String> {
        load(context)
        return (0 until outbox.length()).map { index ->
            when(outbox.getJSONObject(index).optString("op")) {
                "addEvent","updateEvent" -> "Care entry"
                "deleteEvent" -> "Entry removal"
                "saveTask","removeTask" -> "Task change"
                "saveShoppingItem","removeShoppingItem" -> "Shopping change"
                else -> "Family profile change"
            }
        }
    }
    suspend fun discardOldest(context: Context) = sendLock.withLock {
        load(context)
        if(outbox.length()>0) {
            outbox=JSONArray().also { next -> for(i in 1 until outbox.length()) next.put(outbox.get(i)) }
            saveOutbox(context); publish(context,problem=null)
        }
    }
    suspend fun retryOldest(context: Context) {
        val connection=AppSettings(context).internal
        check(connection.selected && connection.configured) { "Connect this account before retrying" }
        refresh(context)
        sendLock.withLock {
            val op=outbox.optJSONObject(0) ?: return@withLock
            val command=op.optJSONObject("_internalCommand") ?: return@withLock
            val key=command.getString("collection")+":"+command.getString("id")
            command.put("expectedRevision",internalMeta.optJSONObject("revisions")?.optInt(key,0) ?: 0).put("operationId",java.util.UUID.randomUUID().toString())
            saveOutbox(context)
        }
        flush(context)
    }

    // ── The outbox as it will land ──────────────────────────────────────────────

    /** What the sheet will hold once these changes land — the same merge each store op makes. */
    fun applyOutbox(base: Tracker,ops: JSONArray): Tracker {
        var profiles=base.profiles; var events=base.events; var shopping=base.shopping; var tasks=base.tasks
        fun merged(old: JSONObject?,patch: JSONObject)=JSONObject((old ?: JSONObject()).toString()).apply { for(k in patch.keys()) if(patch.isNull(k)) remove(k) else put(k,patch.get(k)) }
        for(i in 0 until ops.length()) {
            val op=ops.optJSONObject(i) ?: continue
            when(op.optString("op")) {
                "addEvent" -> { val e=CareEvent(op.getJSONObject("input")); if(events.none { it.id==e.id }) events=events+e
                    if(e.type==com.babysteps.nurserysensor.care.model.EventType.BIRTH) profiles=profiles.map { if(it.id==e.babyId) Profile(JSONObject(it.json.toString()).put("birthDate",e.json.optString("startedAt"))) else it }
                }
                "updateEvent" -> { val e=CareEvent(op.getJSONObject("event")); events=events.map { if(it.id==e.id) e else it } }
                "deleteEvent" -> { val id=op.optString("id"); events=events.filter { it.id!=id } }
                "saveProfile" -> { val patch=op.getJSONObject("profile"); val id=patch.optString("id")
                    profiles=if(profiles.any { it.id==id }) profiles.map { if(it.id==id) Profile(merged(it.json,patch)) else it } else profiles+Profile(patch) }
                "addProfile" -> { val input=op.getJSONObject("input")
                    val id=input.optString("pendingId").ifEmpty { Family.profileId(input.optString("name"),profiles.map { it.id }) }
                    if(profiles.none { it.id==id }) profiles=profiles+Profile(JSONObject(input.toString()).put("id",id).put("createdAt",input.optString("createdAt").ifEmpty { isoString(Instant.now()) })) }
                "archiveProfile" -> { val id=op.optString("id"); profiles=profiles.map { if(it.id==id) Profile(JSONObject(it.json.toString()).put("archivedAt",isoString(Instant.now()))) else it } }
                "restoreProfile" -> { val id=op.optString("id"); profiles=profiles.map { if(it.id==id) Profile(JSONObject(it.json.toString()).apply { remove("archivedAt") }) else it } }
                "saveShoppingItem" -> { val input=op.getJSONObject("input"); val id=input.optString("id")
                    val byName=input.optString("name").takeIf { it.isNotEmpty() }?.let { n -> com.babysteps.nurserysensor.care.domain.Shopping.find(shopping,n) }
                    val match=shopping.find { it.id==id } ?: byName
                    shopping=if(match!=null) shopping.map { if(it.id==match.id) ShoppingItem(merged(it.json,input).put("id",match.id)) else it }
                        else shopping+ShoppingItem(merged(JSONObject().put("category","pantry").put("isFood",false).put("status","need"),input)) }
                "removeShoppingItem" -> { val id=op.optString("id"); shopping=shopping.filter { it.id!=id } }
                "saveTask" -> { val input=op.getJSONObject("input"); val id=input.optString("id")
                    tasks=if(tasks.any { it.id==id }) tasks.map { if(it.id==id) TaskItem(merged(it.json,input)) else it } else tasks+TaskItem(merged(JSONObject().put("status","open"),input)) }
                "removeTask" -> { val id=op.optString("id"); tasks=tasks.filter { it.id!=id } }
            }
        }
        return Tracker(profiles,events,shopping,tasks)
    }

    // ── HTTP ────────────────────────────────────────────────────────────────────

    private class Reply(val code: Int,val body: JSONObject)

    private fun send(settings: AppSettings,method: String,url: String,body: String?): Reply {
        val c=URI(url).toURL().openConnection() as HttpURLConnection
        try {
            c.requestMethod=method; c.instanceFollowRedirects=false; c.connectTimeout=15_000; c.readTimeout=45_000
            c.setRequestProperty("Authorization","Bearer ${settings.token}")
            // HttpURLConnection asks for gzip and unpacks it on its own.
            if(body!=null) { c.doOutput=true; c.setRequestProperty("Content-Type","application/json"); c.outputStream.use { it.write(body.toByteArray()) } }
            val code=c.responseCode
            val text=(if(code<400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            return Reply(code,runCatching { JSONObject(text) }.getOrDefault(JSONObject()))
        } finally { c.disconnect() }
    }
}
