package com.babysteps.nurserysensor.monitoring

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import com.babysteps.nurserysensor.MainActivity
import com.babysteps.nurserysensor.R

class RecoveryReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context,intent: Intent) {
        if(intent.action !in setOf(Intent.ACTION_BOOT_COMPLETED,Intent.ACTION_MY_PACKAGE_REPLACED)) return
        if(!MonitoringPreferences(context).wanted) return
        // Android 10 nursery phone: existing consent permits boot recovery. Do NOT
        // start a background microphone on newer Android with while-in-use rules.
        if(Build.VERSION.SDK_INT<30) {
            try { context.startForegroundService(Intent(context,MonitoringService::class.java).setAction(MonitoringService.ACTION_RESUME)); return }
            catch(e: RuntimeException) { SensorLog.event("recovery_needs_user","exception" to e.javaClass.simpleName) }
        }
        val manager=context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("nursery_recovery","Monitoring recovery",NotificationManager.IMPORTANCE_DEFAULT))
        val open=PendingIntent.getActivity(context,20,Intent(context,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        manager.notify(20,Notification.Builder(context,"nursery_recovery").setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Resume Babysteps monitoring").setContentText("Tap to resume microphone monitoring after restart.")
            .setContentIntent(open).setAutoCancel(true).build())
    }
}
