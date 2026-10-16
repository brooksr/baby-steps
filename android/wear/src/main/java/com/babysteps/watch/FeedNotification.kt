package com.babysteps.watch

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status

/** A running feed timer as an ongoing activity: its icon and count-up sit on the watch face and in Recents. */
object FeedNotification {
    private const val CHANNEL="feed-timer"
    private const val ID=1

    fun update(context: Context,timer: FeedTimer?) {
        val manager=NotificationManagerCompat.from(context)
        if(timer==null) { manager.cancel(ID); return }
        if(ContextCompat.checkSelfPermission(context,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) return
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL,"Feed timer",NotificationManager.IMPORTANCE_DEFAULT).apply { setSound(null,null); enableVibration(false) })
        val open=PendingIntent.getActivity(context,0,Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val side=CareText.sideLetter(timer.side)
        val now=java.time.Instant.now()
        val total=timer.totalMs(now)
        // Ongoing status counts on the elapsedRealtime clock, not wall time; a pause freezes it.
        val elapsedNow=SystemClock.elapsedRealtime()
        val stopwatch=if(timer.paused) Status.StopwatchPart(elapsedNow-total,elapsedNow) else Status.StopwatchPart(elapsedNow-total)
        val builder=NotificationCompat.Builder(context,CHANNEL)
            .setSmallIcon(R.drawable.ic_feed)
            .setContentTitle(if(timer.paused) "Paused · $side" else "Nursing $side")
            .setContentText(if(timer.paused) CareText.clock(total) else "Tap to switch sides or finish")
            .setWhen(System.currentTimeMillis()-total).setUsesChronometer(!timer.paused).setShowWhen(!timer.paused)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setOngoing(true).setOnlyAlertOnce(true).setSilent(true)
            .setContentIntent(open)
        OngoingActivity.Builder(context,ID,builder)
            .setStaticIcon(R.drawable.ic_feed)
            .setTouchIntent(open)
            .setStatus(Status.Builder().addTemplate("#side# #timer#")
                .addPart("side",Status.TextPart(side ?: ""))
                .addPart("timer",stopwatch)
                .build())
            .build().apply(context)
        manager.notify(ID,builder.build())
    }
}
