package com.babysteps.nurserysensor.monitoring

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import com.babysteps.nurserysensor.MainActivity
import com.babysteps.nurserysensor.R
import com.babysteps.nurserysensor.audio.AudioCapture
import com.babysteps.nurserysensor.events.NoOpEventSink
import com.babysteps.nurserysensor.reporting.NightRepository
import com.babysteps.nurserysensor.reporting.NightAccumulator
import com.babysteps.nurserysensor.sync.CareStatusClient
import com.babysteps.nurserysensor.sync.CareStatusText
import java.time.Instant
import java.time.ZoneId
import com.babysteps.nurserysensor.classification.ClassificationPipeline
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

class MonitoringService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var captureJob: Job? = null
    private var destroyed = false

    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "Nursery monitoring", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shown while local microphone monitoring is active"
                setSound(null, null)
            })
        SensorLog.event("service_created")
        // Network work has its own coroutine; microphone processing never waits
        // for an endpoint. SQLite acknowledgements are compare-and-set.
        scope.launch(Dispatchers.IO) {
            while(isActive) {
                com.babysteps.nurserysensor.sync.DeliveryCoordinator.sync(this@MonitoringService)
                delay(300000)
            }
        }
        // Last feed/diaper/cry for the lock screen: read every 2 min, redrawn every
        // minute so "ago" stays true. Only while capture holds the foreground notification.
        scope.launch {
            var tick=0
            while(isActive) {
                if(tick%2==0) CareStatusClient.refresh(this@MonitoringService)
                if(captureJob!=null && CareStatusClient.status.value!=null)
                    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification())
                tick++
                delay(60000)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                MonitoringPreferences(this).wanted=false
                SensorLog.event("stop_requested")
                if (captureJob == null) { MonitoringStore.finished(); stopSelf() } else {
                    MonitoringStore.stopping()
                    captureJob?.cancel()
                }
            }
            ACTION_START -> {
                MonitoringPreferences(this).wanted=true
                startCapture(intent.getBooleanExtra(EXTRA_CLASSIFICATION, true))
            }
            ACTION_RESUME -> if(MonitoringPreferences(this).wanted) startCapture(MonitoringPreferences(this).classification) else stopSelf()
            null -> if(MonitoringPreferences(this).wanted && Build.VERSION.SDK_INT<30)
                startCapture(MonitoringPreferences(this).classification) else stopSelf()
            else -> if (captureJob == null) stopSelf()
        }
        // System-managed process recovery on the Android 10 nursery phone. Newer
        // versions resume only through a visible activity, not a background bypass.
        return if(MonitoringPreferences(this).wanted && Build.VERSION.SDK_INT<30) START_STICKY else START_NOT_STICKY
    }

    private fun startCapture(classification: Boolean) {
        if (captureJob != null) return // Rapid duplicate taps cannot open a second microphone.
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            MonitoringStore.finished("Microphone permission is required.")
            stopSelf()
            return
        }
        MonitoringStore.starting()
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            } else {
                startForeground(NOTIFICATION_ID, notification())
            }
        } catch (exception: RuntimeException) {
            MonitoringStore.finished("Android could not start monitoring. Return to the app and try again.")
            SensorLog.event("foreground_start_failed", "exception" to exception.javaClass.simpleName)
            stopSelf()
            return
        }
        // Enter try/finally immediately: even a Stop during IO dispatch must clean up.
        captureJob = scope.launch(start = CoroutineStart.UNDISPATCHED) {
            var failure: String? = null
            var repository: NightRepository? = null
            var sessionId: Long? = null
            var accumulator: NightAccumulator? = null
            var startedElapsed = 0L
            var pipeline: ClassificationPipeline? = null
            val wakeLock = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Babysteps:AudioMonitoring")
            try {
                // Scoped to capture, not the activity. Keeps CPU processing when screen is off.
                wakeLock.acquire()
                withContext(Dispatchers.IO) {
                    repository = NightRepository.get(this@MonitoringService)
                    AudioCapture(NoOpEventSink).run(
                        onStarted = {
                            val start = Instant.now()
                            startedElapsed = SystemClock.elapsedRealtime()
                            sessionId = repository!!.start(start.toEpochMilli(), classification)
                            accumulator = NightAccumulator(start.toEpochMilli())
                            SensorLog.event("night_session_started", "sessionId" to sessionId)
                            withContext(Dispatchers.Main.immediate) {
                                MonitoringStore.running(sessionId!!, start, startedElapsed)
                                MonitoringStore.model(if(classification) "Loading model…" else "Off",null,0,null)
                            }
                            if(classification) pipeline = ClassificationPipeline(this@MonitoringService,repository!!,
                                sessionId!!,start.toEpochMilli(),startedElapsed) { status,prediction,dropped,error ->
                                withContext(Dispatchers.Main.immediate) {
                                    if(MonitoringStore.state.value.sessionId==sessionId) MonitoringStore.model(status,prediction,dropped,error)
                                }
                            }
                        },
                        onObservation = { value ->
                            val elapsed = SystemClock.elapsedRealtime() - startedElapsed
                            accumulator!!.add(value, elapsed)?.let { bin ->
                                repository!!.saveBin(sessionId!!, bin, elapsed, System.currentTimeMillis())
                            }
                            withContext(Dispatchers.Main.immediate) { MonitoringStore.observation(value) }
                        }, onAudio = { samples, silenced -> pipeline?.offer(samples,silenced) })
                }
            } catch (_: CancellationException) {
                SensorLog.event("capture_cancelled")
            } catch (exception: Exception) {
                failure = exception.message ?: "Microphone capture failed. Try restarting monitoring."
                SensorLog.event("capture_failed", "exception" to exception.javaClass.simpleName, "message" to failure)
            } finally {
                // Capture has ended and AudioRecord is released. Model-drain/storage latency
                // must not inflate the report's monitoring duration or invent a coverage gap.
                val endedElapsed = (SystemClock.elapsedRealtime() - startedElapsed).coerceAtLeast(0)
                val endedWall = System.currentTimeMillis()
                // Persist the last partial numeric bucket on normal Stop/error. No PCM reaches disk.
                finishMonitoring(flush = {
                    try {
                        pipeline?.stop()
                        sessionId?.let { id ->
                            accumulator?.flush()?.let { repository!!.saveBin(id, it, endedElapsed, endedWall) }
                            repository!!.finish(id, endedElapsed, endedWall,
                                if (failure != null) "error" else if (destroyed) "interrupted" else "completed", failure)
                        }
                    } catch (exception: Exception) {
                        failure = "Could not save overnight data: ${exception.message}"
                        SensorLog.event("night_storage_failed", "message" to failure)
                    }
                }, release = {
                    if (wakeLock.isHeld) wakeLock.release()
                    captureJob = null
                    MonitoringStore.finished(failure)
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    SensorLog.event("monitoring_finished", "error" to failure)
                    if (!destroyed) {
                        if(failure!=null && MonitoringPreferences(this@MonitoringService).wanted && Build.VERSION.SDK_INT<30 &&
                            checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED) {
                            SensorLog.event("capture_retry_scheduled","delayMs" to 30000)
                            scope.launch { delay(30000)
                                if(MonitoringPreferences(this@MonitoringService).wanted) startCapture(MonitoringPreferences(this@MonitoringService).classification)
                                else stopSelf()
                            }
                        } else stopSelf()
                    }
                })
            }
        }
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 1, Intent(this, MonitoringService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val care = CareStatusClient.status.value?.let { CareStatusText.lines(it, Instant.now(), ZoneId.systemDefault()) }
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(care?.title ?: "Babysteps Nursery Sensor")
            .setContentText(care?.text ?: "Monitoring nursery sound locally • No audio saved")
            .apply { care?.let { setStyle(Notification.BigTextStyle().bigText(it.expanded + "\nMonitoring sound locally • No audio saved")) } }
            // The wall-mounted phone's lock screen is the point: show it in full there.
            .setVisibility(Notification.VISIBILITY_PUBLIC).setShowWhen(false)
            .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(Notification.Action.Builder(null, "Stop Monitoring", stop).build())
            .build()
    }

    override fun onDestroy() {
        destroyed = true
        if (captureJob != null) MonitoringStore.stopping()
        scope.cancel() // AudioCapture.finally releases recorder; then coroutine finally releases wake lock.
        SensorLog.event("service_destroyed")
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_START = "com.babysteps.nurserysensor.START"
        const val ACTION_STOP = "com.babysteps.nurserysensor.STOP"
        const val ACTION_RESUME = "com.babysteps.nurserysensor.RESUME"
        const val EXTRA_CLASSIFICATION = "classification"
        const val CHANNEL = "nursery_monitoring"
        const val NOTIFICATION_ID = 1
    }
}
