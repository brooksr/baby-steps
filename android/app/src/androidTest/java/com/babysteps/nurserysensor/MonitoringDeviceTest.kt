package com.babysteps.nurserysensor

import android.Manifest
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.SystemClock
import android.os.Build
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiScrollable
import androidx.test.uiautomator.UiSelector
import androidx.test.uiautomator.UiObjectNotFoundException
import androidx.test.uiautomator.Until
import com.babysteps.nurserysensor.monitoring.MonitoringStore
import com.babysteps.nurserysensor.monitoring.MonitoringService
import com.babysteps.nurserysensor.monitoring.ServiceStatus
import java.io.File
import java.util.regex.Pattern
import com.babysteps.nurserysensor.reporting.NightRepository
import com.babysteps.nurserysensor.reporting.NightExport
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Run on a device with a usable microphone, preferably API 34+.
 * Fresh installs exercise the real Android permission dialog; already granted installs skip it.
 * Denial/permanent denial is covered by the separate manual checklist in README.
 */
@RunWith(AndroidJUnit4::class)
class MonitoringDeviceTest {
    @Test fun permissionStartScreenOffStopAndPrivacy() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        // Never send instrumentation-test events to the real family sheet.
        context.getSharedPreferences("nursery-delivery",android.content.Context.MODE_PRIVATE).edit().putBoolean("enabled",false).commit()
        context.getSharedPreferences("nursery-settings",android.content.Context.MODE_PRIVATE).edit()
            .putBoolean("classification",true).putBoolean("monitoring-wanted",false).commit()
        val device = UiDevice.getInstance(instrumentation)
        device.wakeUp()
        // A fresh task starts on Monitor, independent of the user's last selected tab.
        // Compose merges navigation icon/label semantics, so don't treat its label
        // as a standalone button in the accessibility tree.
        context.startActivity(Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        assertTrue(device.wait(Until.hasObject(By.text("Babysteps Nursery Sensor")), 10_000))
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            fun granted() = context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            // Permission may be granted manually while UIAutomator waits for UI idle.
            // In that case the conditional Grant Permissions button disappears.
            tap(device, "Grant Permissions", skipIf = { granted() || device.findObject(allowPermission) != null })
            val deadline = SystemClock.elapsedRealtime() + 10_000
            while (!granted() && SystemClock.elapsedRealtime() < deadline) {
                device.findObject(allowPermission)?.click()
                SystemClock.sleep(100)
            }
            // No notification runtime prompt exists on the Android 10 OnePlus.
            if (Build.VERSION.SDK_INT >= 33) {
                device.wait(Until.findObject(allowPermission), 2000)?.click()
            }
        }
        assertEquals("Microphone permission was not granted by the Android dialog", PackageManager.PERMISSION_GRANTED, context.checkSelfPermission(Manifest.permission.RECORD_AUDIO))
        // AndroidX asynchronously writes this numeric compilation-status cache after launch.
        // Exclude only this exact path (not arbitrary .dat/cache files or recordings).
        val profileCache = File(context.filesDir, "profileInstalled").absolutePath
        // MediaPipe extracts the APK's bundled model to this exact cache path.
        // Exempt only this file, and verify its content below; never ignore the
        // entire cache directory, which could conceal an unintended recording.
        val modelCache = File(context.cacheDir, "drishti_asset_cache/yamnet.tflite")
        val permittedCaches = setOf(profileCache, modelCache.absolutePath)
        val filesBefore = appDataFiles(context.filesDir, context.cacheDir, context.noBackupFilesDir) - permittedCaches
        val testSessions = mutableListOf<Long>()
        try {
            tap(device, "Start Monitoring")
            eventually { MonitoringStore.state.value.status == ServiceStatus.RUNNING && MonitoringStore.state.value.latest != null }
            testSessions += MonitoringStore.state.value.sessionId!!
            eventually("Local classifier did not produce a prediction") {
                MonitoringStore.state.value.prediction!=null || MonitoringStore.state.value.classificationError!=null
            }
            assertNull("Classifier must load and run on this device",MonitoringStore.state.value.classificationError)
            val manager = context.getSystemService(NotificationManager::class.java)
            assertTrue(manager.activeNotifications.any { it.id == MonitoringService.NOTIFICATION_ID })
            // Verify the dashboard Stop while the activity is still unlocked and visible.
            tap(device, "Stop Monitoring")
            assertStopped(context, manager)

            // Start a second session for screen-off and notification Stop verification.
            // wakeUp() does not dismiss a PIN lock screen, so don't try to find app UI after sleep.
            tap(device, "Start Monitoring")
            eventually { MonitoringStore.state.value.status == ServiceStatus.RUNNING && MonitoringStore.state.value.latest != null }
            val notification = manager.activeNotifications.single { it.id == MonitoringService.NOTIFICATION_ID }.notification
            val stopAction = notification.actions.single { it.title.toString() == "Stop Monitoring" }.actionIntent
            val timestamp = MonitoringStore.state.value.latest!!.timestamp
            val nightId = MonitoringStore.state.value.sessionId!!
            testSessions += nightId
            val repository = NightRepository.get(context)
            repository.mark(nightId, System.currentTimeMillis(), 0, "ambient_noise", "Test marker, with \"quotes\" and Unicode: café")
            device.sleep()
            SystemClock.sleep(2000)
            assertTrue("Observations must continue with screen off", MonitoringStore.state.value.latest!!.timestamp > timestamp)
            // Exercise the actual notification PendingIntent while locked. No PIN bypass.
            stopAction.send()
            assertStopped(context, manager)
            val report = repository.report(nightId)
            assertEquals("completed", report.session.status)
            assertTrue("Overnight numeric summaries must be persisted", report.bins.isNotEmpty())
            assertTrue(report.session.capturedMs > 0)
            assertTrue("Model predictions must be persisted",report.predictions.isNotEmpty())
            assertEquals("completed",report.session.modelStatus)
            assertTrue(report.session.modelSha256!!.matches(Regex("[0-9a-f]{64}")))
            assertEquals(1, report.markers.size)
            val exported = JSONObject(NightExport.json(report))
            assertEquals(2, exported.getInt("schemaVersion"))
            assertTrue(exported.getJSONObject("classification").getBoolean("enabled"))
            assertEquals(report.predictions.size,exported.getJSONArray("predictions").length())
            assertEquals(report.bins.size, exported.getJSONArray("observations").length())
            assertEquals(report.markers.first().note, exported.getJSONArray("markers").getJSONObject(0).getString("note"))
            assertEquals(report.bins.size + 1, NightExport.csv(report).trimEnd().lines().size)
            // Read through a separate SQLite connection, rather than trusting in-memory UI state.
            android.database.sqlite.SQLiteDatabase.openDatabase(context.getDatabasePath("nursery-nights.db").path,
                null, android.database.sqlite.SQLiteDatabase.OPEN_READONLY).use { db ->
                db.rawQuery("SELECT COUNT(*) FROM bins WHERE session_id=?", arrayOf(nightId.toString())).use { c ->
                    assertTrue(c.moveToFirst()); assertEquals(report.bins.size, c.getInt(0))
                }
            }
            if (modelCache.exists()) {
                val bundledHash = context.assets.open("yamnet.tflite").use { sha256(it) }
                val cachedHash = modelCache.inputStream().use { sha256(it) }
                assertArrayEquals("MediaPipe's cache must contain only the unchanged bundled model", bundledHash, cachedHash)
            }
            assertEquals("No new files except the verified model and AndroidX compilation-status caches", filesBefore,
                appDataFiles(context.filesDir, context.cacheDir, context.noBackupFilesDir) - permittedCaches)
        } finally {
            com.babysteps.nurserysensor.monitoring.MonitoringPreferences(context).wanted=false
            context.stopService(Intent(context, MonitoringService::class.java))
            device.wakeUp()
            eventually("Service did not stop before test cleanup") { MonitoringStore.state.value.status == ServiceStatus.STOPPED }
            discardSessions(NightRepository.get(context), testSessions)
        }
    }
    @Test fun bundledModelProcessesSilenceWithoutMicrophoneOrNetwork() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        com.babysteps.nurserysensor.classification.YamnetClassifier(context).use { model ->
            val result=model.classify(com.babysteps.nurserysensor.audio.AudioWindow(ShortArray(15600),16000,java.time.Instant.EPOCH))
            assertTrue(result.scores.values.all { it.isFinite() && it in 0.0..1.0 })
            assertNotNull(result.topModelLabel)
        }
        val permissions=context.packageManager.getPackageInfo(context.packageName,PackageManager.GET_PERMISSIONS).requestedPermissions ?: emptyArray()
        assertTrue("Metadata delivery declares networking separately from local inference",permissions.contains(Manifest.permission.INTERNET))
    }
    @Test fun migrationPreservesExistingNumericReportsAndCareMarkers() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val name="migration-fixture-${java.util.UUID.randomUUID()}.db"
        try {
            context.openOrCreateDatabase(name,android.content.Context.MODE_PRIVATE,null).use { db ->
                db.execSQL("CREATE TABLE sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,started_ms INTEGER NOT NULL,ended_ms INTEGER,status TEXT NOT NULL,elapsed_ms INTEGER NOT NULL DEFAULT 0,heartbeat_ms INTEGER NOT NULL,error TEXT,zone_id TEXT NOT NULL,device TEXT NOT NULL,app_version TEXT NOT NULL)")
                db.execSQL("CREATE TABLE bins(session_id INTEGER NOT NULL REFERENCES sessions(id),offset_ms INTEGER NOT NULL,timestamp_ms INTEGER NOT NULL,windows INTEGER NOT NULL,captured_ms INTEGER NOT NULL,valid_ms INTEGER NOT NULL,silenced_ms INTEGER NOT NULL,mean_square REAL,peak_dbfs REAL,clipped_windows INTEGER NOT NULL,PRIMARY KEY(session_id,offset_ms))")
                db.execSQL("CREATE TABLE markers(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id INTEGER NOT NULL REFERENCES sessions(id),timestamp_ms INTEGER NOT NULL,offset_ms INTEGER NOT NULL,label TEXT NOT NULL,note TEXT NOT NULL)")
                db.execSQL("INSERT INTO sessions VALUES(1,0,1000,'completed',1000,1000,NULL,'UTC','test device','0.2.0')")
                db.execSQL("INSERT INTO bins VALUES(1,0,0,4,1000,1000,0,0.25,-6.0,0)")
                db.execSQL("INSERT INTO markers VALUES(1,1,500,500,'feed','existing care note')")
                db.version=1
            }
            NightRepository(context,name).use { repository ->
                val report=repository.report(1)
                assertEquals("0.2.0",report.session.appVersion)
                assertEquals(1,report.bins.size); assertEquals("feed",report.markers.single().label)
                assertEquals("disabled",report.session.modelStatus); assertFalse(report.session.classificationRequested)
                assertTrue(report.predictions.isEmpty()); assertEquals(4,repository.readableDatabase.version)
            }
        } finally { context.deleteDatabase(name) }
    }
    @Test fun modelLoadFailureIsReportedAndDoesNotPreventNumericPersistence() = kotlinx.coroutines.runBlocking {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val name="model-failure-fixture-${java.util.UUID.randomUUID()}.db"
        try { NightRepository(context,name).use { repository ->
        val start=System.currentTimeMillis()
        val id=repository.start(start,true)
        val pipeline=com.babysteps.nurserysensor.classification.ClassificationPipeline(context,repository,id,start,SystemClock.elapsedRealtime(),
            classifierFactory={ error("intentional model-load failure") },onState={ _,_,_,_ -> })
        pipeline.stop()
        repository.saveBin(id,com.babysteps.nurserysensor.reporting.SoundBin(0,start,1,250,250,0,.25,-6.0,0),250,start+250)
        repository.finish(id,250,start+250,"completed",null)
        val report=repository.report(id)
        assertEquals("error",report.session.modelStatus)
        assertTrue(report.session.modelError!!.contains("intentional model-load failure"))
        assertEquals(1,report.bins.size); assertEquals("completed",report.session.status)
        } } finally { context.deleteDatabase(name) }
    }
    @Test fun deliveryQueueIsDurableAndStaleAcknowledgementCannotEraseNewerSummary() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val name="delivery-fixture-${java.util.UUID.randomUUID()}.db"
        try {
            var old: List<com.babysteps.nurserysensor.sync.DeliveryRecord> = emptyList()
            NightRepository(context,name).use { repository ->
                val id=repository.start(100000,false)
                repository.saveBin(id,com.babysteps.nurserysensor.reporting.SoundBin(0,100000,4,1000,1000,0,.01,-10.0,0),1000,101000)
                repository.mark(id,100500,500,"feed","private-care-note-not-for-upload")
                repository.finish(id,1000,101000,"completed",null)
                old=repository.pendingDelivery(100)
                assertEquals(setOf("interval","session"),old.map { JSONObject(it.payload).getString("kind") }.toSet())
                assertEquals(2,old.size)
                assertTrue(old.none { it.payload.contains("private-care-note") })
                repository.modelState(id,"error",error="fixture")
                repository.queueSessionSummaries()
                repository.acknowledgeDelivery(old)
                assertEquals(1,repository.pendingDelivery(100).size)
            }
            NightRepository(context,name).use { reopened ->
                val pending=reopened.pendingDelivery(100)
                assertEquals(1,pending.size)
                assertEquals("session",JSONObject(pending.single().payload).getString("kind"))
                reopened.acknowledgeDelivery(pending)
                assertTrue(reopened.pendingDelivery(100).isEmpty())
            }
        } finally { context.deleteDatabase(name) }
    }
    @Test fun sheetGetsNightlySummaryAndCareEpisodesNotAmbientOrPerMinuteRows() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val name="night-fixture-${java.util.UUID.randomUUID()}.db"
        val utc=java.time.ZoneId.of("UTC")
        val start=java.time.Instant.parse("2026-10-12T22:07:00Z").toEpochMilli()
        try {
            NightRepository(context,name).use { repository ->
                val id=repository.start(start,true)
                // 40 minutes of one-second bins: 4 quarter-hour rows (22:07-22:15 ... 22:45-22:47), not 40 minute rows.
                for(second in 0 until 2400L) repository.saveBin(id,com.babysteps.nurserysensor.reporting.SoundBin(second*1000,start+second*1000,4,1000,1000,0,1e-4,-30.0,0),(second+1)*1000,start+(second+1)*1000)
                repository.episodes(id,listOf(
                    com.babysteps.nurserysensor.classification.SoundEpisode(com.babysteps.nurserysensor.audio.AudioLabel.BABY_CRY,60000,180000,.8),
                    com.babysteps.nurserysensor.classification.SoundEpisode(com.babysteps.nurserysensor.audio.AudioLabel.BABY_CRY,600000,630000,.6),
                    com.babysteps.nurserysensor.classification.SoundEpisode(com.babysteps.nurserysensor.audio.AudioLabel.AMBIENT_NOISE,0,2400000,.9)))
                repository.finish(id,2400000,start+2400000,"completed",null)
                repository.queueNightlySummaries(start+3_600_000,utc)
                val records=repository.pendingDelivery(100).map { JSONObject(it.payload) }
                val byKind=records.groupBy { it.getString("kind") }
                assertTrue(records.all { it.getInt("schemaVersion")==NightRepository.DELIVERY_SCHEMA })
                assertEquals(listOf("2026-10-12T22:07:00Z","2026-10-12T22:15:00Z","2026-10-12T22:30:00Z","2026-10-12T22:45:00Z"),
                    byKind.getValue("interval").map { it.getJSONObject("data").getString("startUtc") })
                assertEquals("2026-10-12T22:47:00Z",byKind.getValue("interval").last().getJSONObject("data").getString("endUtc"))
                assertEquals(listOf("baby_cry","baby_cry"),byKind.getValue("episode").map { it.getJSONObject("data").getString("label") })
                val night=byKind.getValue("night").single().getJSONObject("data")
                assertEquals("2026-10-12",night.getString("nightOf"))
                assertEquals("in_progress",night.getString("status"))
                assertEquals(2,night.getInt("cryEpisodes")); assertEquals(150000,night.getLong("cryMs")); assertEquals(120000,night.getLong("longestCryMs"))
                assertEquals(2400000,night.getLong("ambientNoiseMs")); assertEquals(2400000,night.getLong("validMs"))
                assertEquals(-40.0,night.getDouble("soundLevelDbfs"),1e-6)
                assertTrue(records.none { it.toString().contains("minute") })
            }
        } finally { context.deleteDatabase(name) }
    }
    /** Real-database sessions created by UI tests must never reach the family sheet. */
    private fun discardSessions(repository: NightRepository, ids: List<Long>) {
        if(ids.isEmpty()) return
        val db=repository.writableDatabase
        db.beginTransaction()
        try {
            ids.forEach { id ->
                val started=db.rawQuery("SELECT started_ms FROM sessions WHERE id=?",arrayOf(id.toString())).use { if(it.moveToFirst()) it.getLong(0) else null } ?: return@forEach
                db.delete("delivery_queue","record_key LIKE ?",arrayOf("%:$started:$id:%"))
                listOf("predictions","episodes","markers","bins").forEach { table -> db.delete(table,"session_id=?",arrayOf(id.toString())) }
                db.delete("sessions","id=?",arrayOf(id.toString()))
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        repository.refresh()
    }
    private fun assertStopped(context: android.content.Context, manager: NotificationManager) {
        eventually("Service did not reach Stopped after Stop") { MonitoringStore.state.value.status == ServiceStatus.STOPPED }
        assertFalse("Explicit Stop must revoke automatic recovery",com.babysteps.nurserysensor.monitoring.MonitoringPreferences(context).wanted)
        // NotificationManager processes removal asynchronously on the system-server side.
        // Store status is not a synchronization barrier for that separate process.
        eventually("Foreground notification was not removed after Stop") {
            manager.activeNotifications.none { it.id == MonitoringService.NOTIFICATION_ID }
        }
        val audio = context.getSystemService(AudioManager::class.java)
        eventually("Microphone recording configuration remained active after Stop") { audio.activeRecordingConfigurations.isEmpty() }
        val stopped = MonitoringStore.state.value.latest!!.timestamp
        SystemClock.sleep(500)
        assertEquals(stopped, MonitoringStore.state.value.latest!!.timestamp)
    }
    private val allowPermission = By.res(Pattern.compile(
        "(?:com\\.android\\.permissioncontroller|com\\.google\\.android\\.permissioncontroller|com\\.android\\.packageinstaller):id/permission_allow_(?:foreground_only_)?button"))

    private fun tap(device: UiDevice, text: String, skipIf: () -> Boolean = { false }) {
        if (skipIf()) return
        if (clickAccessibleButton(text)) return
        if (device.findObject(By.text(text).enabled(true)) == null) {
            if (skipIf()) return
            try {
                UiScrollable(UiSelector().scrollable(true)).scrollTextIntoView(text)
            } catch (exception: UiObjectNotFoundException) {
                if (skipIf()) return
                throw exception
            }
        }
        val deadline = SystemClock.elapsedRealtime() + 5000
        while (SystemClock.elapsedRealtime() < deadline) {
            if (skipIf()) return
            if (clickAccessibleButton(text)) return
            SystemClock.sleep(100)
        }
        if (!skipIf()) fail("Expected enabled button: $text")
    }
    private fun clickAccessibleButton(text: String): Boolean {
        // Invoke the clickable parent's accessibility action, not the Text child's screen
        // coordinates. Compose can move a button as storage/permission status wraps lines.
        fun find(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
            if (node.text?.toString() == text && node.isVisibleToUser) return node
            for (i in 0 until node.childCount) node.getChild(i)?.let { child ->
                find(child)?.let { return it }
            }
            return null
        }
        val root = InstrumentationRegistry.getInstrumentation().uiAutomation.rootInActiveWindow ?: return false
        var node = find(root) ?: return false
        while (!node.isClickable) node = node.parent ?: return false
        return node.isEnabled && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }
    private fun appDataFiles(vararg roots: File): Set<String> = roots.flatMap { root ->
        if (root.exists()) root.walkTopDown().filter { it.isFile }.map { it.absolutePath }.toList() else emptyList()
    }.toSet()
    private fun sha256(input: java.io.InputStream): ByteArray {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(8192)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (count > 0) digest.update(buffer, 0, count)
        }
        return digest.digest()
    }
    private fun eventually(message: String = "Condition did not become true within 10 seconds", condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 10_000
        while (!condition() && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(50)
        assertTrue("$message (service=${MonitoringStore.state.value.status}, error=${MonitoringStore.state.value.error})", condition())
    }
}
