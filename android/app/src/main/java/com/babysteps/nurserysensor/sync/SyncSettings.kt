package com.babysteps.nurserysensor.sync

import android.content.Context
import java.net.URI
import java.util.UUID

class SyncSettings(context: Context) {
    val internal=com.babysteps.internal.InternalConnection(context,"nursery")
    private val secure=com.babysteps.internal.SecureCredentials(context,"nursery-legacy")
    private val prefs=context.getSharedPreferences("nursery-delivery",Context.MODE_PRIVATE)
    val deviceId: String = synchronized(SyncSettings::class.java) { prefs.getString("deviceId",null) ?: UUID.randomUUID().toString().also {
        check(prefs.edit().putString("deviceId",it).commit())
    } }
    val enabled get()=prefs.getBoolean("enabled",false)
    val endpoint get()=prefs.getString("endpoint","")!!
    val token get(): String {
        secure.get("token")?.let { return it }
        val old=prefs.getString("token","")!!
        if(old.isNotEmpty()) { secure.set("token",old); prefs.edit().remove("token").commit() }
        return old
    }
    fun save(enabled: Boolean,endpoint: String,token: String) {
        if(enabled && !internal.selected) { require(validEndpoint(endpoint)) { "Use a valid HTTPS endpoint without credentials or query parameters." }; require(token.length in 32..128) { "Use a token with 32–128 characters." } }
        secure.set("token",token)
        check(prefs.edit().putBoolean("enabled",enabled).putString("endpoint",endpoint.trim()).commit())
    }
    companion object {
        fun validEndpoint(value: String): Boolean = try {
            val uri=URI(value.trim())
            uri.scheme=="https" && !uri.host.isNullOrBlank() && uri.userInfo==null && uri.query==null && uri.fragment==null
        } catch(_: Exception) { false }
    }
}
data class DeliveryRecord(val key: String,val payload: String)
