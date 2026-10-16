package com.babysteps.internal

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest

/** Phone and watch use the same enrollment/rotation protocol, independent of Google. */
class InternalConnection(context: Context,private val namespace: String) {
    private val prefs=context.applicationContext.getSharedPreferences("$namespace-internal",Context.MODE_PRIVATE)
    private val secrets=SecureCredentials(context,"$namespace-internal")
    val api get()=prefs.getString("api","")!!
    val familyId get()=prefs.getString("family","")!!
    val accountId get()=prefs.getString("account","")!!
    val selected get()=api.isNotEmpty() && familyId.isNotEmpty()
    val configured get()=selected && secrets.get("tokens")!=null
    val scope get()=if(selected) MessageDigest.getInstance("SHA-256").digest("$api:$accountId:$familyId".toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) } else "legacy"
    data class Reply(val code: Int,val body: JSONObject)
    companion object {
        private val connectionLocks=java.util.concurrent.ConcurrentHashMap<String,Any>()
        fun validApi(value: String)=runCatching { val u=URI(value); u.scheme=="https" && !u.host.isNullOrBlank() && u.userInfo==null && u.query==null && u.fragment==null && u.path.trimEnd('/')=="/api/v1" }.getOrDefault(false)
        fun request(url: String,body: JSONObject?=null,token: String?=null): Reply {
            val c=URI(url).toURL().openConnection() as HttpURLConnection
            try {
                c.instanceFollowRedirects=false; c.connectTimeout=15_000; c.readTimeout=45_000
                if(token!=null) c.setRequestProperty("Authorization","Bearer $token")
                if(body!=null) { c.requestMethod="POST"; c.doOutput=true; c.setRequestProperty("Content-Type","application/json"); c.outputStream.use { it.write(body.toString().toByteArray()) } }
                val code=c.responseCode
                val text=(if(code<400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
                return Reply(code,runCatching { JSONObject(text) }.getOrDefault(JSONObject()))
            } finally { c.disconnect() }
        }
    }
    fun begin(base: String,purpose: String="phone",sourceDeviceId: String?=null): JSONObject {
        require(validApi(base)) { "Use the HTTPS Pi address ending /api/v1" }
        val device=sourceDeviceId ?: prefs.getString("device",null) ?: java.util.UUID.randomUUID().toString().also { check(prefs.edit().putString("device",it).commit()) }
        val result=request(base.trimEnd('/')+"/native/start",JSONObject().put("purpose",purpose).put("sourceDeviceId",device))
        check(result.code in 200..299) { "The Pi could not start sign-in (${result.code})" }
        check(prefs.edit().putString("pairApi",base.trimEnd('/')).putString("pairCode",result.body.getString("deviceCode")).commit())
        secrets.set("pairSecret",result.body.getString("deviceSecret"))
        return result.body
    }
    fun complete(): Boolean {
        val base=prefs.getString("pairApi",null) ?: error("Start sign-in first")
        val reply=request(base+"/native/exchange",JSONObject().put("deviceCode",prefs.getString("pairCode",null)).put("deviceSecret",secrets.get("pairSecret")))
        check(reply.code in 200..299) { "The connection code expired or was refused" }
        if(reply.body.optBoolean("pending")) return false
        // All tokens change together in one encrypted JSON value to survive process death.
        secrets.set("tokens",reply.body.toString())
        check(prefs.edit().putString("api",base).putString("account",reply.body.getString("accountId")).putString("family",reply.body.getString("familyId")).remove("pairApi").remove("pairCode").commit())
        secrets.set("pairSecret",null)
        return true
    }
    fun call(path: String,body: JSONObject?=null): Reply = synchronized(connectionLocks.getOrPut(namespace) { Any() }) {
        check(configured) { "Connect your account first" }
        val scopeAtStart=scope
        val base=api
        val original=secrets.get("tokens") ?: error("Sign in again")
        var tokens=JSONObject(original)
        check(tokens.optString("accountId")==accountId && tokens.optString("familyId")==familyId) { "Sign in again" }
        var result=request(base+path,body,tokens.getString("token"))
        check(scope==scopeAtStart && secrets.get("tokens")==original) { "Account changed; retry in the selected account" }
        if(result.code==401) {
            val refresh=request(base+"/native/refresh",JSONObject().put("refreshToken",tokens.getString("refreshToken")))
            if(refresh.code !in 200..299) return@synchronized refresh
            check(scope==scopeAtStart && secrets.get("tokens")==original) { "Account changed; sign in again" }
            tokens=refresh.body; secrets.set("tokens",tokens.toString())
            result=request(base+path,body,tokens.getString("token"))
            check(scope==scopeAtStart) { "Account changed; sign in again" }
        }
        result
    }
    fun disconnect() { secrets.set("tokens",null) }
    fun useLegacy() { disconnect(); check(prefs.edit().remove("api").remove("family").remove("account").commit()) }
    fun familyPath(suffix: String)="/families/$familyId/$suffix"
}
