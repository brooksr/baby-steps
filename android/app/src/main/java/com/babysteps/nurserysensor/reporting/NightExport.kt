package com.babysteps.nurserysensor.reporting

import com.babysteps.nurserysensor.audio.AudioStatistics
import com.babysteps.nurserysensor.classification.DetectionDefaults
import java.time.Instant
import java.io.Writer
import java.io.StringWriter
import org.json.JSONArray
import org.json.JSONObject

/** Schema v2. Streaming avoids a huge overnight JSONObject tree. Metadata only, no PCM. */
object NightExport {
    fun json(report: NightReport): String = StringWriter().also { writeJson(report,it) }.toString()
    fun writeJson(report: NightReport, writer: Writer) {
        val s = report.session
        val header = JSONObject().put("schemaVersion",2).put("appVersion","0.4.0")
            .put("exportedAt",utc(System.currentTimeMillis()))
            .put("units",JSONObject().put("soundLevel","dBFS (uncalibrated)").put("duration","milliseconds")
                .put("meanSquare","normalized PCM amplitude squared").put("timestamps","UTC ISO-8601").put("modelScores","uncalibrated 0..1"))
            .put("capture",JSONObject().put("sampleRateHz",16000).put("channels",1).put("pcmBits",16)
                .put("measurementWindowMs",250).put("summaryBucketMs",1000).put("audioSource","MIC"))
            .put("classification",JSONObject().put("enabled",s.classificationRequested).put("status",s.modelStatus)
                .put("model",s.modelName ?: JSONObject.NULL).put("sha256",s.modelSha256 ?: JSONObject.NULL)
                .put("error",s.modelError ?: JSONObject.NULL).put("experimental",true)
                .put("inputSamples",DetectionDefaults.INPUT_SAMPLES).put("hopSamples",DetectionDefaults.HOP_SAMPLES)
                .put("detectorVersion",s.detectorVersion ?: JSONObject.NULL)
                .put("inferenceCount",s.inferenceCount).put("meanInferenceMs",if(s.inferenceCount==0L) JSONObject.NULL else s.inferenceTotalMs.toDouble()/s.inferenceCount)
                .put("maxInferenceMs",s.inferenceMaxMs).put("droppedWindows",s.droppedWindows)
                .put("policies",if(s.detectorVersion==DetectionDefaults.VERSION) JSONArray().apply {
                    DetectionDefaults.policies.forEach { p -> put(JSONObject().put("label",p.label.eventName).put("startThreshold",p.startThreshold)
                        .put("endThreshold",p.endThreshold).put("confirmationFrames",p.confirmationFrames).put("releaseFrames",p.releaseFrames)) }
                } else JSONObject.NULL))
            .put("session",JSONObject().put("id",s.id).put("startedAt",utc(s.startedAtMs)).put("endedAt",s.endedAtMs?.let(::utc) ?: JSONObject.NULL)
                .put("status",s.status).put("timezone",s.zoneId).put("device",s.device).put("appVersion",s.appVersion).put("error",s.error ?: JSONObject.NULL))
            .put("summary",JSONObject().put("elapsedMs",s.elapsedMs).put("capturedMs",s.capturedMs).put("validMs",s.validMs)
                .put("silencedMs",s.silencedMs).put("unobservedMs",s.unobservedMs).put("coveragePercent",s.coveragePercent)
                .put("bucketCount",s.binCount).put("wallClockDriftMs",s.endedAtMs?.let { it-s.startedAtMs-s.elapsedMs } ?: JSONObject.NULL)
                .put("meanSquare",s.meanSquare ?: JSONObject.NULL).put("averageDbfs",s.meanSquare?.let(AudioStatistics::powerDbfs) ?: JSONObject.NULL)
                .put("peakDbfs",s.peakDbfs ?: JSONObject.NULL).put("clippedWindows",s.clippedWindows).put("manualMarkerCount",s.markerCount)
                .put("episodeCount",report.episodes.size))
        writer.write(header.toString(2).dropLast(1))
        fun <T> array(name: String, items: List<T>, convert: (T)->JSONObject) {
            writer.write(",\n  \"$name\": [")
            items.forEachIndexed { index,item -> if(index>0) writer.write(","); writer.write("\n"); writer.write(convert(item).toString()) }
            writer.write("\n  ]")
        }
        array("observations",report.bins) { b -> JSONObject().put("timestamp",utc(b.timestampMs)).put("offsetMs",b.offsetMs)
            .put("windowCount",b.windowCount).put("capturedMs",b.capturedMs).put("validMs",b.validMs).put("silencedMs",b.silencedMs)
            .put("meanSquare",b.meanSquare ?: JSONObject.NULL).put("soundLevelDbfs",b.meanSquare?.let(AudioStatistics::powerDbfs) ?: JSONObject.NULL)
            .put("peakDbfs",b.peakDbfs ?: JSONObject.NULL).put("clippedWindows",b.clippedWindows) }
        array("markers",report.markers) { m -> JSONObject().put("timestamp",utc(m.timestampMs)).put("offsetMs",m.offsetMs)
            .put("label",m.label).put("source","manual").put("note",m.note) }
        array("predictions",report.predictions) { p -> JSONObject().put("timestamp",utc(p.timestampMs)).put("endOffsetMs",p.endOffsetMs)
            .put("label",p.result.label.eventName).put("score",p.result.confidence).put("inferenceMs",p.inferenceMs)
            .put("topModelLabel",p.result.topModelLabel ?: JSONObject.NULL).put("topModelScore",p.result.topModelScore ?: JSONObject.NULL)
            .put("scores",JSONObject().apply { p.result.scores.forEach { (label,score) -> put(label.eventName,score) } }) }
        array("episodes",report.episodes) { e -> JSONObject().put("label",e.label.eventName).put("source","model_experimental")
            .put("startedAt",utc(s.startedAtMs+e.startOffsetMs)).put("endedAt",utc(s.startedAtMs+e.endOffsetMs))
            .put("startOffsetMs",e.startOffsetMs).put("endOffsetMs",e.endOffsetMs).put("durationMs",e.durationMs).put("maxScore",e.maxScore) }
        writer.write("\n}\n")
    }
    /** Numeric CSV retains its v1 shape; event CSV and full JSON have their own v2 schema. */
    fun csv(report: NightReport): String = StringWriter().also { writeCsv(report,it) }.toString()
    fun writeCsv(report: NightReport, writer: Writer) {
        writer.write("schema_version,session_id,session_status,timestamp_utc,offset_ms,window_count,captured_ms,valid_ms,silenced_ms,mean_square,sound_level_dbfs,peak_dbfs,clipped_windows\r\n")
        report.bins.forEach { b -> writer.write(listOf(1,report.session.id,report.session.status,utc(b.timestampMs),b.offsetMs,b.windowCount,
            b.capturedMs,b.validMs,b.silencedMs,b.meanSquare,b.meanSquare?.let(AudioStatistics::powerDbfs),b.peakDbfs,b.clippedWindows).joinToString(",") { field(it) }+"\r\n") }
    }
    fun writeEventsCsv(report: NightReport, writer: Writer) {
        writer.write("schema_version,session_id,source,label,start_utc,end_utc,start_offset_ms,end_offset_ms,duration_ms,max_model_score,note\r\n")
        val start = report.session.startedAtMs
        report.episodes.forEach { e -> writer.write(listOf(2,report.session.id,"model_experimental",e.label.eventName,utc(start+e.startOffsetMs),utc(start+e.endOffsetMs),e.startOffsetMs,e.endOffsetMs,e.durationMs,e.maxScore,"").joinToString(",") { field(it) }+"\r\n") }
        report.markers.forEach { m -> writer.write(listOf(2,report.session.id,"manual",m.label,utc(m.timestampMs),"",m.offsetMs,"","","",m.note).joinToString(",") { field(it) }+"\r\n") }
    }
    private fun field(value: Any?): String {
        val text=value?.toString() ?: ""
        return if(text.any { it==',' || it=='"' || it=='\r' || it=='\n' }) "\"${text.replace("\"","\"\"")}\"" else text
    }
    private fun utc(ms: Long) = Instant.ofEpochMilli(ms).toString()
}
