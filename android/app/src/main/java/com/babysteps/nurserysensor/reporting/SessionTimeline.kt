package com.babysteps.nurserysensor.reporting

import android.graphics.Paint
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.babysteps.nurserysensor.audio.AudioLabel
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun SessionTimeline(report: NightReport) {
    var hours by remember { mutableIntStateOf(12) }
    val plot=remember(report,hours) { TimelinePlot.build(report.bins,report.session.elapsedMs,hours*3600000L) }
    val colors=MaterialTheme.colorScheme
    val zone=ZoneId.of(report.session.zoneId)
    val clock=remember(zone) { DateTimeFormatter.ofPattern("HH:mm").withZone(zone) }
    Text("Sound timeline",style=MaterialTheme.typography.titleMedium)
    Row { listOf(1,12,24).forEach { h -> TextButton(onClick={ hours=h }) { Text("${if(hours==h) "✓ " else ""}${h}h") } } }
    Text("Sleep: unknown · Movement: not measured",style=MaterialTheme.typography.bodySmall)
    Text("Routine shows the usual 20:00–05:00 window, not measured sleep. Cry/speech/snore estimates are experimental.",style=MaterialTheme.typography.bodySmall)
    Canvas(Modifier.fillMaxWidth().height(300.dp).semantics { contentDescription="Routine, likely cry, speech, snoring, care markers and relative sound levels on the same time axis. Sleep and movement are not measured." }) {
        val left=68.dp.toPx(); val right=size.width-8.dp.toPx(); val width=(right-left).coerceAtLeast(1f)
        fun x(ms: Long)=left+((ms-plot.startMs).toDouble()/(plot.endMs-plot.startMs)).coerceIn(0.0,1.0).toFloat()*width
        val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize=11.dp.toPx(); color=colors.onSurfaceVariant.toArgb() }
        fun label(text: String,y: Float) { drawContext.canvas.nativeCanvas.drawText(text,0f,y+4.dp.toPx(),paint) }
        val ys=listOf(22f,55f,88f,121f,154f).map { it.dp.toPx() }
        listOf("Routine","Cry","Speech","Snore","Care").forEachIndexed { i,name ->
            label(name,ys[i]); drawLine(colors.outlineVariant,Offset(left,ys[i]),Offset(right,ys[i]))
        }
        plot.points.forEach { p ->
            val hour=Instant.ofEpochMilli(report.session.startedAtMs+p.offsetMs).atZone(zone).hour
            if(hour>=20 || hour<5) drawLine(colors.outline,Offset(x(p.offsetMs),ys[0]),Offset(x(minOf(plot.endMs,p.offsetMs+plot.stepMs)),ys[0]),strokeWidth=4.dp.toPx())
        }
        listOf(AudioLabel.BABY_CRY,AudioLabel.SPEECH,AudioLabel.SNORING).forEachIndexed { index,label ->
            report.episodes.filter { it.label==label && it.endOffsetMs>plot.startMs && it.startOffsetMs<plot.endMs }.forEach { e ->
                val a=x(e.startOffsetMs); val b=x(e.endOffsetMs)
                drawLine(if(index==0) colors.error else colors.primary,Offset(a,ys[index+1]),Offset(maxOf(a+2.dp.toPx(),b).coerceAtMost(right),ys[index+1]),strokeWidth=5.dp.toPx())
            }
        }
        report.markers.filter { it.label in setOf("feed","diaper") && it.offsetMs in plot.startMs..plot.endMs }.forEach {
            val xx=x(it.offsetMs); drawLine(colors.secondary,Offset(xx,ys[4]-7.dp.toPx()),Offset(xx,ys[4]+7.dp.toPx()),strokeWidth=2.dp.toPx())
        }
        val top=185.dp.toPx(); val bottom=255.dp.toPx()
        label("Noise",top)
        fun y(db: Double)=bottom-((db+100)/100).coerceIn(0.0,1.0).toFloat()*(bottom-top)
        for(i in 1 until plot.points.size) {
            val a=plot.points[i-1]; val b=plot.points[i]
            if(a.levelDbfs!=null && b.levelDbfs!=null) drawLine(colors.primary,Offset(x(a.offsetMs),y(a.levelDbfs)),Offset(x(b.offsetMs),y(b.levelDbfs)),strokeWidth=2.dp.toPx())
        }
        // A single valid point is still visible; gaps never become a quiet baseline.
        plot.points.filter { it.levelDbfs!=null }.forEach { drawCircle(colors.primary,1.dp.toPx(),Offset(x(it.offsetMs),y(it.levelDbfs!!))) }
        paint.textAlign=Paint.Align.LEFT
        drawContext.canvas.nativeCanvas.drawText(clock.format(Instant.ofEpochMilli(report.session.startedAtMs+plot.startMs)),left,280.dp.toPx(),paint)
        paint.textAlign=Paint.Align.RIGHT
        drawContext.canvas.nativeCanvas.drawText(clock.format(Instant.ofEpochMilli(report.session.startedAtMs+plot.endMs)),right,280.dp.toPx(),paint)
    }
    Text("Noise scale −100 to 0 dBFS, uncalibrated. Missing/silenced buckets are gaps. Feed/diaper ticks are local manual markers; no Google care data is downloaded yet.",style=MaterialTheme.typography.bodySmall)
}
