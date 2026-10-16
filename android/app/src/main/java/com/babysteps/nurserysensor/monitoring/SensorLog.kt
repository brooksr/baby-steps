package com.babysteps.nurserysensor.monitoring

import android.util.Log
import org.json.JSONObject

/** Metadata only: never put PCM, recognized speech, or other sensitive content in logs. */
object SensorLog {
    const val TAG = "NurserySensor"
    fun event(name: String, vararg fields: Pair<String, Any?>) {
        val value = JSONObject().put("event", name)
        fields.forEach { (key, field) -> value.put(key, field ?: JSONObject.NULL) }
        Log.i(TAG, value.toString())
    }
}
