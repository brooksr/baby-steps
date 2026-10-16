package com.babysteps.nurserysensor.monitoring

import android.content.Context

/** Explicit Start consent persists; explicit Stop revokes it before cancelling capture. */
class MonitoringPreferences(context: Context) {
    private val preferences=context.getSharedPreferences("nursery-settings",Context.MODE_PRIVATE)
    var wanted: Boolean
        get()=preferences.getBoolean("monitoring-wanted",false)
        set(value) { check(preferences.edit().putBoolean("monitoring-wanted",value).commit()) }
    val classification get()=preferences.getBoolean("classification",true)
}
