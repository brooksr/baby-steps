package com.babysteps.internal

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SecureCredentialsDeviceTest {
    @Test fun secretsSurviveReopenWithoutAppearingInPreferencesAndCorruptionFailsClosed() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val store=SecureCredentials(context,"test-account")
        val value="synthetic-test-token-12345678901234567890"
        store.set("token",value)
        assertEquals(value,SecureCredentials(context,"test-account").get("token"))
        val prefs=context.getSharedPreferences("test-account-secrets",Context.MODE_PRIVATE)
        assertFalse(prefs.all.values.any { it.toString().contains(value) })
        prefs.edit().putString("token","corrupt").commit()
        assertNull(store.get("token"))
        store.set("token",null)
    }
}
