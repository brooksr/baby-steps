package com.babysteps.nurserysensor.care.data

import android.content.Context
import com.babysteps.nurserysensor.care.model.EventType
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.time.Instant

/**
 * What belongs to this phone rather than to the family: who is on screen, who
 * logs from it, the feed tab it opens on, its theme, and the timers running on
 * it. The web app keeps the same things in the browser's localStorage.
 */
class DevicePrefs(context: Context) {
    private val prefs=context.applicationContext.getSharedPreferences("babysteps-device",Context.MODE_PRIVATE)

    var activeProfileId: String?
        get()=prefs.getString("activeProfile",null)
        set(value) { prefs.edit().putString("activeProfile",value).apply() }

    /** Who this phone logs as; "not recorded" is a choice, so empty clears it. */
    var caregiverId: String
        get()=prefs.getString("caregiver","")!!
        set(value) { prefs.edit().apply { if(value.isEmpty()) remove("caregiver") else putString("caregiver",value) }.apply() }

    var feedMethod: String
        get()=if(prefs.getString("feedMethod",null)=="bottle") "bottle" else "nursing"
        set(value) { prefs.edit().putString("feedMethod",value).apply() }

    /** "light", "dark", or "system". */
    var theme: String
        get()=prefs.getString("theme","system")!!
        set(value) { prefs.edit().putString("theme",value).apply(); themeFlow.value=value }

    /** Running timers, per child: type key → start. */
    fun timers(childId: String): Map<EventType,Instant> {
        val all=runCatching { JSONObject(prefs.getString("timers","{}")!!) }.getOrDefault(JSONObject())
        val mine=all.optJSONObject(childId) ?: return emptyMap()
        return mine.keys().asSequence().mapNotNull { k -> EventType.of(k)?.let { t -> runCatching { Instant.parse(mine.getString(k)) }.getOrNull()?.let { t to it } } }.toMap()
    }

    fun setTimer(childId: String,type: EventType,startedAt: Instant?) {
        val all=runCatching { JSONObject(prefs.getString("timers","{}")!!) }.getOrDefault(JSONObject())
        val mine=all.optJSONObject(childId) ?: JSONObject()
        if(startedAt==null) mine.remove(type.key) else mine.put(type.key,startedAt.toString())
        if(mine.length()==0) all.remove(childId) else all.put(childId,mine)
        prefs.edit().putString("timers",all.toString()).apply()
        timerRevision.value++
    }

    companion object {
        val themeFlow=MutableStateFlow<String?>(null)
        /** Bumped on every timer change so open screens re-read them. */
        val timerRevision=MutableStateFlow(0)
        val theme=themeFlow.asStateFlow()
    }
}
