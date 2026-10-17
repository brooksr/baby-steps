package com.babysteps.nurserysensor

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import com.babysteps.nurserysensor.care.model.Profile
import com.babysteps.nurserysensor.care.model.CareEvent
import com.babysteps.nurserysensor.care.ui.BabystepsTheme
import com.babysteps.nurserysensor.care.ui.GrowthStandards
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.time.Instant
import java.time.LocalDate

/** Synthetic cache only, explicitly guarded against running on household hardware. */
@RunWith(AndroidJUnit4::class)
class CareParityDeviceTest {
    @Test fun recentWebDisplayChangesWorkOffline() {
        check(Build.MODEL.contains("sdk_gphone") || Build.FINGERPRINT.contains("emulator")) { "Test emulator required; never seed a household device" }
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val context=instrumentation.targetContext
        check(!context.getSharedPreferences("phone-internal",Context.MODE_PRIVATE).contains("family")) { "Use a fresh test emulator" }
        val now=Instant.now()
        val birth=LocalDate.now().minusDays(90)
        val profile=JSONObject().put("id","parity-child").put("name","Test Baby").put("kind","child").put("birthDate",birth.toString()).put("dueDate",birth.plusDays(28).toString()).put("gender","girl").put("timezone","America/Los_Angeles")
        val parent=JSONObject().put("id","parity-parent").put("kind","parent").put("name","Test Parent").put("createdAt",now.toString())
        val events=JSONArray()
        fun event(id: String,type: String,time: Instant)=JSONObject().put("id",id).put("babyId","parity-child").put("type",type).put("startedAt",time.toString()).put("createdAt",time.toString()).put("updatedAt",now.toString())
        for(i in 0..7) events.put(event("diaper-$i","diaper",now.minusSeconds(3600+i*3L*3600)).put("kind","wet"))
        events.put(event("feed","feed",now.minusSeconds(2*3600)).put("method","bottle").put("amountOz",3))
        events.put(event("bath","bath",now.minusSeconds(60*3600)))
        events.put(event("growth","growth",now).put("weightOz",220).put("lengthIn",24).put("headCircumferenceIn",15))
        val tracker=JSONObject().put("profiles",JSONArray().put(profile).put(parent)).put("events",events)
        context.getSharedPreferences("babysteps-app",Context.MODE_PRIVATE).edit().remove("token").commit()
        File(context.filesDir,"babysteps-tracker.json").writeText(tracker.toString())
        val device=UiDevice.getInstance(instrumentation)
        device.wakeUp()
        // A cold API-37 emulator can leave a System UI ANR over the app.
        device.findObject(By.text("Close app"))?.click()
        device.pressHome()
        context.startActivity(Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        assertTrue(device.wait(Until.hasObject(By.desc("Sync now")),15000))
        assertTrue(device.wait(Until.hasObject(By.textContains("LAST BATH")),5000))
        device.takeScreenshot(File(context.getExternalFilesDir(null),"parity-home.png"))
        device.findObject(By.textContains("LAST BATH")).click()
        assertTrue(device.wait(Until.hasObject(By.textContains("Only: Bath")),5000))
        fun tab(name: String) { device.findObject(By.desc(name)).click(); device.waitForIdle() }
        tab("Home")
        device.swipe(device.displayWidth/2,device.displayHeight*4/5,device.displayWidth/2,device.displayHeight/3,20)
        assertTrue(device.wait(Until.hasObject(By.text("What to expect")),5000))
        assertFalse(device.hasObject(By.textContains("Born at")))
        tab("Settings")
        assertTrue(device.wait(Until.hasObject(By.text("Sign-in & account")),5000))
        device.findObject(By.text("Sign-in & account")).click()
        assertTrue(device.wait(Until.hasObject(By.text("Sign-in & security")),5000))
        assertTrue(device.hasObject(By.text("Connect or reconnect this device")))
        assertFalse(device.hasObject(By.text("App token")))
        device.takeScreenshot(File(context.getExternalFilesDir(null),"parity-account.png"))
        // Focused Growth rendering avoids depending on the size of preceding report charts.
        instrumentation.runOnMainSync {
            val activity=ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<MainActivity>().single()
            activity.setContent { BabystepsTheme("light") {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    GrowthStandards(Profile(profile),(0 until events.length()).map { CareEvent(events.getJSONObject(it)) })
                }
            } }
        }
        assertTrue(device.wait(Until.hasObject(By.textContains("Age comparison")),5000))
        assertFalse(device.hasObject(By.textContains("Born at")))
        assertTrue(device.hasObject(By.textContains(" · P")))
        device.takeScreenshot(File(context.getExternalFilesDir(null),"parity-growth.png"))

    }
}
