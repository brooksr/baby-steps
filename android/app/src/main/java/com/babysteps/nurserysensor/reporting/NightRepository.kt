package com.babysteps.nurserysensor.reporting

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.os.Build
import java.time.ZoneId
import com.babysteps.nurserysensor.audio.AudioLabel
import com.babysteps.nurserysensor.audio.ClassificationResult
import com.babysteps.nurserysensor.classification.Prediction
import com.babysteps.nurserysensor.classification.SoundEpisode
import com.babysteps.nurserysensor.classification.DetectionDefaults
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.time.Instant
import com.babysteps.nurserysensor.sync.DeliveryRecord
import com.babysteps.nurserysensor.sync.SyncSettings

/** Native SQLite; all calls run on IO. One repository per process, one capture owner.
 * FULL synchronous WAL commits preserve already-flushed numeric summaries on process death.
 */
class NightRepository internal constructor(context: Context, name: String = "nursery-nights.db") : SQLiteOpenHelper(context, name, null, 4) {
    private val sourceDeviceId=SyncSettings(context).deviceId
    private val lastInterval=mutableMapOf<Long,Long>()
    private val mutableSessions = MutableStateFlow<List<NightSession>>(emptyList())
    val sessions = mutableSessions.asStateFlow()
    init { setWriteAheadLoggingEnabled(true) }

    override fun onConfigure(db: SQLiteDatabase) {
        db.setForeignKeyConstraintsEnabled(true)
        db.execSQL("PRAGMA synchronous=FULL")
    }
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, started_ms INTEGER NOT NULL, ended_ms INTEGER,
            status TEXT NOT NULL, elapsed_ms INTEGER NOT NULL DEFAULT 0, heartbeat_ms INTEGER NOT NULL,
            error TEXT, zone_id TEXT NOT NULL, device TEXT NOT NULL, app_version TEXT NOT NULL)""")
        db.execSQL("""CREATE TABLE bins (
            session_id INTEGER NOT NULL REFERENCES sessions(id), offset_ms INTEGER NOT NULL,
            timestamp_ms INTEGER NOT NULL, windows INTEGER NOT NULL, captured_ms INTEGER NOT NULL,
            valid_ms INTEGER NOT NULL, silenced_ms INTEGER NOT NULL, mean_square REAL, peak_dbfs REAL,
            clipped_windows INTEGER NOT NULL, PRIMARY KEY(session_id, offset_ms))""")
        db.execSQL("""CREATE TABLE markers (
            id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES sessions(id),
            timestamp_ms INTEGER NOT NULL, offset_ms INTEGER NOT NULL, label TEXT NOT NULL, note TEXT NOT NULL)""")
        addClassificationSchema(db)
        addDeliverySchema(db)
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) addClassificationSchema(db)
        if (oldVersion < 3) addDeliverySchema(db)
        // Delivery schema 2 replaced per-minute rows. No receiver accepted schema 1,
        // so its unsent records are dropped; sessions/nights are re-derived from bins.
        if (oldVersion == 3) db.execSQL("DELETE FROM delivery_queue")
        check(newVersion <= 4) { "Unsupported database upgrade; preserve overnight data." }
    }
    private fun addDeliverySchema(db: SQLiteDatabase) {
        // Constant-time session totals: continuous capture must not scan months of
        // bins every five-second UI refresh. Upgrade computes existing totals once.
        listOf("numeric_captured INTEGER NOT NULL DEFAULT 0","numeric_valid INTEGER NOT NULL DEFAULT 0",
            "numeric_silenced INTEGER NOT NULL DEFAULT 0","numeric_bins INTEGER NOT NULL DEFAULT 0",
            "numeric_power_sum REAL NOT NULL DEFAULT 0","numeric_peak REAL","numeric_clipped INTEGER NOT NULL DEFAULT 0",
            "numeric_markers INTEGER NOT NULL DEFAULT 0").forEach { db.execSQL("ALTER TABLE sessions ADD COLUMN $it") }
        db.execSQL("""UPDATE sessions SET
            numeric_captured=COALESCE((SELECT SUM(captured_ms) FROM bins WHERE session_id=sessions.id),0),
            numeric_valid=COALESCE((SELECT SUM(valid_ms) FROM bins WHERE session_id=sessions.id),0),
            numeric_silenced=COALESCE((SELECT SUM(silenced_ms) FROM bins WHERE session_id=sessions.id),0),
            numeric_bins=(SELECT COUNT(*) FROM bins WHERE session_id=sessions.id),
            numeric_power_sum=COALESCE((SELECT SUM(mean_square*valid_ms) FROM bins WHERE session_id=sessions.id),0),
            numeric_peak=(SELECT MAX(peak_dbfs) FROM bins WHERE session_id=sessions.id),
            numeric_clipped=COALESCE((SELECT SUM(clipped_windows) FROM bins WHERE session_id=sessions.id),0),
            numeric_markers=(SELECT COUNT(*) FROM markers WHERE session_id=sessions.id)""")
        db.execSQL("CREATE TABLE delivery_queue(record_key TEXT PRIMARY KEY,payload TEXT NOT NULL,sent INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE INDEX delivery_pending ON delivery_queue(sent,record_key)")
    }
    private fun addClassificationSchema(db: SQLiteDatabase) {
        listOf("model_status TEXT NOT NULL DEFAULT 'disabled'", "model_name TEXT", "model_sha256 TEXT", "model_error TEXT",
            "inference_count INTEGER NOT NULL DEFAULT 0", "inference_total_ms INTEGER NOT NULL DEFAULT 0",
            "inference_max_ms INTEGER NOT NULL DEFAULT 0", "dropped_windows INTEGER NOT NULL DEFAULT 0",
            "classification_requested INTEGER NOT NULL DEFAULT 0", "detector_version TEXT").forEach {
            db.execSQL("ALTER TABLE sessions ADD COLUMN $it")
        }
        db.execSQL("""CREATE TABLE predictions (session_id INTEGER NOT NULL REFERENCES sessions(id),
            end_offset_ms INTEGER NOT NULL, timestamp_ms INTEGER NOT NULL, label TEXT NOT NULL, score REAL NOT NULL,
            cry REAL NOT NULL, speech REAL NOT NULL, snoring REAL NOT NULL, cough REAL NOT NULL, ambient REAL NOT NULL,
            top_label TEXT, top_score REAL, inference_ms INTEGER NOT NULL, PRIMARY KEY(session_id,end_offset_ms))""")
        db.execSQL("""CREATE TABLE episodes (id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL REFERENCES sessions(id), label TEXT NOT NULL, start_offset_ms INTEGER NOT NULL,
            end_offset_ms INTEGER NOT NULL, max_score REAL NOT NULL)""")
    }

    private fun initialize() {
        // Only called once on process initialization, before any new session can be created.
        writableDatabase.execSQL("""UPDATE sessions SET status='interrupted', ended_ms=heartbeat_ms,
            error='Previous process ended before a clean Stop; tail after the last heartbeat is unknown.'
            WHERE status='recording'""")
        writableDatabase.execSQL("UPDATE sessions SET model_status='interrupted' WHERE model_status IN ('loading','running')")
        // Finalize the recoverable partial interval of interrupted captures. Unknown
        // time after heartbeat is never synthesized as quiet data.
        readSessions().filter { it.status=="interrupted" }.forEach { queueLastInterval(writableDatabase,it.id,it.startedAtMs+it.elapsedMs) }
        refresh()
    }
    @Synchronized fun start(timestampMs: Long, classification: Boolean = false): Long {
        val values = ContentValues().apply {
            put("started_ms", timestampMs); put("heartbeat_ms", timestampMs); put("status", "recording")
            put("zone_id", ZoneId.systemDefault().id); put("device", "${Build.MANUFACTURER} ${Build.MODEL} / Android ${Build.VERSION.RELEASE}")
            put("app_version", "0.4.0")
            put("classification_requested", if(classification) 1 else 0)
            put("model_status", if(classification) "loading" else "disabled")
            if(classification) { put("model_name", "YAMNet float32 v1 / MediaPipe 1.0.0"); put("detector_version", DetectionDefaults.VERSION) }
        }
        val id = writableDatabase.insertOrThrow("sessions", null, values)
        refresh()
        return id
    }
    @Synchronized fun saveBin(id: Long, bin: SoundBin, elapsedMs: Long, wallMs: Long) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.insertOrThrow("bins", null, ContentValues().apply {
                put("session_id", id); put("offset_ms", bin.offsetMs); put("timestamp_ms", bin.timestampMs)
                put("windows", bin.windowCount); put("captured_ms", bin.capturedMs); put("valid_ms", bin.validMs)
                put("silenced_ms", bin.silencedMs); put("mean_square", bin.meanSquare); put("peak_dbfs", bin.peakDbfs)
                put("clipped_windows", bin.clippedWindows)
            })
            db.execSQL("""UPDATE sessions SET elapsed_ms=?,heartbeat_ms=?,numeric_captured=numeric_captured+?,
                numeric_valid=numeric_valid+?,numeric_silenced=numeric_silenced+?,numeric_bins=numeric_bins+1,
                numeric_power_sum=numeric_power_sum+?,numeric_clipped=numeric_clipped+?,
                numeric_peak=CASE WHEN ? IS NULL THEN numeric_peak WHEN numeric_peak IS NULL THEN ? ELSE MAX(numeric_peak,?) END WHERE id=?""",
                arrayOf<Any?>(elapsedMs,wallMs,bin.capturedMs,bin.validMs,bin.silencedMs,(bin.meanSquare?:0.0)*bin.validMs,
                    bin.clippedWindows,bin.peakDbfs,bin.peakDbfs,bin.peakDbfs,id))
            val interval=ReportWindows.intervalStart(bin.timestampMs)
            val previous=lastInterval.put(id,interval)
            if(previous!=null && previous<interval) queueInterval(db,id,previous,previous+ReportWindows.INTERVAL_MS)
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        // Avoid recomputing the entire report for every live measurement.
        if (bin.offsetMs % 5000 < 1000) refresh()
    }
    @Synchronized fun finish(id: Long, elapsedMs: Long, wallMs: Long, status: String, error: String?) {
        writableDatabase.update("sessions", ContentValues().apply {
            put("elapsed_ms", elapsedMs); put("ended_ms", wallMs); put("heartbeat_ms", wallMs)
            put("status", status); put("error", error)
        }, "id=?", arrayOf(id.toString()))
        queueLastInterval(writableDatabase,id,sessionStart(writableDatabase,id)+elapsedMs)
        queueSessionSummaries()
        lastInterval.remove(id)
        refresh()
    }
    @Synchronized fun mark(id: Long, timestampMs: Long, offsetMs: Long, label: String, note: String) {
        val db=writableDatabase
        db.beginTransaction()
        try {
        db.insertOrThrow("markers", null, ContentValues().apply {
            put("session_id", id); put("timestamp_ms", timestampMs); put("offset_ms", offsetMs)
            put("label", label); put("note", note.take(500))
        })
        db.execSQL("UPDATE sessions SET numeric_markers=numeric_markers+1 WHERE id=?",arrayOf(id))
        db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        refresh()
    }
    @Synchronized fun modelState(id: Long, status: String, sha256: String? = null, error: String? = null, dropped: Long = 0) {
        writableDatabase.update("sessions", ContentValues().apply {
            put("model_status", status); put("model_error", error); put("dropped_windows", dropped)
            if(sha256 != null) put("model_sha256", sha256)
        }, "id=?", arrayOf(id.toString()))
        refresh()
    }
    @Synchronized fun prediction(id: Long, value: Prediction, episodes: List<SoundEpisode>, dropped: Long) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.insertOrThrow("predictions", null, ContentValues().apply {
                put("session_id", id); put("end_offset_ms", value.endOffsetMs); put("timestamp_ms", value.timestampMs)
                put("label", value.result.label.eventName); put("score", value.result.confidence)
                put("cry", value.result.scores[AudioLabel.BABY_CRY] ?: 0.0); put("speech", value.result.scores[AudioLabel.SPEECH] ?: 0.0)
                put("snoring", value.result.scores[AudioLabel.SNORING] ?: 0.0); put("cough", value.result.scores[AudioLabel.COUGH] ?: 0.0)
                put("ambient", value.result.scores[AudioLabel.AMBIENT_NOISE] ?: 0.0)
                put("top_label", value.result.topModelLabel); put("top_score", value.result.topModelScore); put("inference_ms", value.inferenceMs)
            })
            db.execSQL("UPDATE sessions SET inference_count=inference_count+1,inference_total_ms=inference_total_ms+?,inference_max_ms=MAX(inference_max_ms,?),dropped_windows=? WHERE id=?",
                arrayOf(value.inferenceMs,value.inferenceMs,dropped,id))
            episodes.forEach { saveEpisode(db,id,it) }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    private fun saveEpisode(db: SQLiteDatabase, id: Long, value: SoundEpisode) {
        val episodeId=db.insertOrThrow("episodes",null,ContentValues().apply {
            put("session_id",id); put("label",value.label.eventName); put("start_offset_ms",value.startOffsetMs)
            put("end_offset_ms",value.endOffsetMs); put("max_score",value.maxScore)
        })
        // Ambient/unknown episodes stay local (and in nightly counts); they are room
        // context, not events Babysteps would suggest, and would dominate the tab.
        if(value.label !in SHEET_EPISODE_LABELS) return
        val start=sessionStart(db,id)
        enqueue(db,"$sourceDeviceId:$start:$id:episode:$episodeId","episode",JSONObject()
            .put("sourceDeviceId",sourceDeviceId).put("sessionId",id).put("episodeId",episodeId)
            .put("label",value.label.eventName).put("startUtc",utc(start+value.startOffsetMs))
            .put("endUtc",utc(start+value.endOffsetMs)).put("durationMs",value.durationMs).put("maxScore",value.maxScore)
            .put("source","model_experimental"))
    }
    @Synchronized fun episodes(id: Long, values: List<SoundEpisode>) { values.forEach { saveEpisode(writableDatabase,id,it) } }
    @Synchronized fun refresh() { mutableSessions.value = readSessions() }
    private fun readSessions(): List<NightSession> {
        val result = mutableListOf<NightSession>()
        readableDatabase.rawQuery("""SELECT s.id,s.started_ms,s.ended_ms,s.status,s.elapsed_ms,
            s.numeric_captured,s.numeric_valid,s.numeric_silenced,s.numeric_bins,
            s.numeric_power_sum/NULLIF(s.numeric_valid,0),s.numeric_peak,s.numeric_clipped,
            s.numeric_markers,s.error,s.zone_id,s.device,s.app_version,
            s.model_status,s.model_name,s.model_sha256,s.model_error,s.inference_count,s.inference_total_ms,s.inference_max_ms,
            s.dropped_windows,s.classification_requested,s.detector_version
            FROM sessions s ORDER BY s.id DESC""", null).use { c ->
            while (c.moveToNext()) result.add(NightSession(c.getLong(0),c.getLong(1),if(c.isNull(2)) null else c.getLong(2),c.getString(3),
                c.getLong(4),c.getLong(5),c.getLong(6),c.getLong(7),c.getLong(8),if(c.isNull(9)) null else c.getDouble(9),
                if(c.isNull(10)) null else c.getDouble(10),c.getLong(11),c.getLong(12),c.getString(13),c.getString(14),c.getString(15),c.getString(16),
                c.getString(17),c.getString(18),c.getString(19),c.getString(20),c.getLong(21),c.getLong(22),c.getLong(23),c.getLong(24),c.getInt(25)!=0,c.getString(26)))
        }
        return result
    }
    @Synchronized fun report(id: Long, includePredictions: Boolean = true, fromOffsetMs: Long = 0): NightReport {
        val session = readSessions().first { it.id == id }
        val bins = mutableListOf<SoundBin>()
        readableDatabase.rawQuery("SELECT offset_ms,timestamp_ms,windows,captured_ms,valid_ms,silenced_ms,mean_square,peak_dbfs,clipped_windows FROM bins WHERE session_id=? AND offset_ms>=? ORDER BY offset_ms", arrayOf(id.toString(),fromOffsetMs.toString())).use { c ->
            while(c.moveToNext()) bins.add(SoundBin(c.getLong(0),c.getLong(1),c.getInt(2),c.getLong(3),c.getLong(4),c.getLong(5),
                if(c.isNull(6)) null else c.getDouble(6),if(c.isNull(7)) null else c.getDouble(7),c.getInt(8)))
        }
        val markers = mutableListOf<NightMarker>()
        readableDatabase.rawQuery("SELECT timestamp_ms,offset_ms,label,note FROM markers WHERE session_id=? AND offset_ms>=? ORDER BY offset_ms,id", arrayOf(id.toString(),fromOffsetMs.toString())).use { c ->
            while(c.moveToNext()) markers.add(NightMarker(c.getLong(0),c.getLong(1),c.getString(2),c.getString(3)))
        }
        val predictions = mutableListOf<Prediction>()
        if(includePredictions) readableDatabase.rawQuery("SELECT end_offset_ms,timestamp_ms,label,score,cry,speech,snoring,cough,ambient,top_label,top_score,inference_ms FROM predictions WHERE session_id=? ORDER BY end_offset_ms",arrayOf(id.toString())).use { c ->
            while(c.moveToNext()) predictions.add(Prediction(c.getLong(0),c.getLong(1),ClassificationResult(label(c.getString(2)),c.getDouble(3),
                mapOf(AudioLabel.BABY_CRY to c.getDouble(4),AudioLabel.SPEECH to c.getDouble(5),AudioLabel.SNORING to c.getDouble(6),AudioLabel.COUGH to c.getDouble(7),AudioLabel.AMBIENT_NOISE to c.getDouble(8)),
                c.getString(9),if(c.isNull(10)) null else c.getDouble(10)),c.getLong(11)))
        }
        val episodes = mutableListOf<SoundEpisode>()
        readableDatabase.rawQuery("SELECT label,start_offset_ms,end_offset_ms,max_score FROM episodes WHERE session_id=? AND end_offset_ms>=? ORDER BY start_offset_ms,id",arrayOf(id.toString(),fromOffsetMs.toString())).use { c ->
            while(c.moveToNext()) episodes.add(SoundEpisode(label(c.getString(0)),c.getLong(1),c.getLong(2),c.getDouble(3)))
        }
        return NightReport(session,bins,markers,predictions,episodes)
    }
    private fun label(value: String) = AudioLabel.entries.firstOrNull { it.eventName == value } ?: AudioLabel.UNKNOWN
    private fun utc(ms: Long)=Instant.ofEpochMilli(ms).toString()
    private fun sessionStart(db: SQLiteDatabase,id: Long): Long = db.rawQuery("SELECT started_ms FROM sessions WHERE id=?",arrayOf(id.toString())).use { check(it.moveToFirst()); it.getLong(0) }
    private fun enqueue(db: SQLiteDatabase,key: String,kind: String,data: JSONObject) {
        val payload=JSONObject().put("schemaVersion",DELIVERY_SCHEMA).put("kind",kind).put("data",data).toString()
        val previous=db.rawQuery("SELECT payload FROM delivery_queue WHERE record_key=?",arrayOf(key)).use { if(it.moveToFirst()) it.getString(0) else null }
        if(previous==payload) return
        db.insertWithOnConflict("delivery_queue",null,ContentValues().apply { put("record_key",key);put("payload",payload);put("sent",0) },SQLiteDatabase.CONFLICT_REPLACE)
    }
    private fun queueLastInterval(db: SQLiteDatabase,id: Long,endMs: Long) {
        val last=db.rawQuery("SELECT MAX(timestamp_ms) FROM bins WHERE session_id=?",arrayOf(id.toString())).use {
            if(it.moveToFirst() && !it.isNull(0)) it.getLong(0) else null
        } ?: return
        queueInterval(db,id,ReportWindows.intervalStart(last),endMs)
    }
    /** One row per session per wall-clock quarter hour, clipped to the session's observed span. */
    private fun queueInterval(db: SQLiteDatabase,id: Long,intervalStartMs: Long,endMs: Long) {
        val start=sessionStart(db,id)
        val from=maxOf(intervalStartMs,start)
        val to=minOf(intervalStartMs+ReportWindows.INTERVAL_MS,endMs).coerceAtLeast(from+1)
        // bins.timestamp_ms = started_ms + offset_ms, so the primary key serves this range.
        db.rawQuery("""SELECT SUM(valid_ms),SUM(mean_square*valid_ms)/NULLIF(SUM(valid_ms),0),MAX(peak_dbfs),SUM(clipped_windows)
            FROM bins WHERE session_id=? AND offset_ms>=? AND offset_ms<?""",arrayOf(id.toString(),(from-start).toString(),(intervalStartMs+ReportWindows.INTERVAL_MS-start).toString())).use { c ->
            if(!c.moveToFirst() || c.isNull(0)) return
            val power=if(c.isNull(1)) null else c.getDouble(1)
            enqueue(db,"$sourceDeviceId:$start:$id:interval:$intervalStartMs","interval",JSONObject()
                .put("sourceDeviceId",sourceDeviceId).put("sessionId",id).put("startUtc",utc(from)).put("endUtc",utc(to))
                .put("durationMs",to-from).put("validMs",c.getLong(0))
                .put("coveragePercent",(100.0*c.getLong(0)/(to-from)).coerceIn(0.0,100.0))
                .put("soundLevelDbfs",power?.let(com.babysteps.nurserysensor.audio.AudioStatistics::powerDbfs) ?: JSONObject.NULL)
                .put("peakDbfs",if(c.isNull(2)) JSONObject.NULL else c.getDouble(2)).put("clippedWindows",c.getLong(3)))
        }
    }
    /** Upserts the current and previous night: the review/report row Babysteps reads first. */
    @Synchronized fun queueNightlySummaries(nowMs: Long, zone: ZoneId = ZoneId.systemDefault()) {
        val tonight=ReportWindows.nightOf(nowMs,zone)
        listOf(tonight.minusDays(1),tonight).forEach { queueNight(writableDatabase,it,zone,nowMs) }
    }
    // rawQuery binds TEXT: arithmetic expressions have no column affinity, so cast explicitly.
    private fun queueNight(db: SQLiteDatabase,night: java.time.LocalDate,zone: ZoneId,nowMs: Long) {
        val window=ReportWindows.nightBounds(night,zone)
        val a=window.first; val b=window.last+1
        val sessions=db.rawQuery("SELECT id,started_ms FROM sessions WHERE started_ms<CAST(? AS INTEGER) AND started_ms+elapsed_ms>CAST(? AS INTEGER)",arrayOf(b.toString(),a.toString())).use { c ->
            buildList { while(c.moveToNext()) add(c.getLong(0) to c.getLong(1)) }
        }
        if(sessions.isEmpty()) return
        var captured=0L; var valid=0L; var power=0.0; var peak: Double?=null
        sessions.forEach { (id,start) ->
            db.rawQuery("SELECT SUM(captured_ms),SUM(valid_ms),SUM(mean_square*valid_ms),MAX(peak_dbfs) FROM bins WHERE session_id=? AND offset_ms>=? AND offset_ms<?",
                arrayOf(id.toString(),(a-start).coerceAtLeast(0).toString(),(b-start).toString())).use { c ->
                if(c.moveToFirst() && !c.isNull(0)) {
                    captured+=c.getLong(0); valid+=c.getLong(1); power+=c.getDouble(2)
                    if(!c.isNull(3)) peak=maxOf(peak ?: c.getDouble(3),c.getDouble(3))
                }
            }
        }
        val counts=mutableMapOf<String,Triple<Long,Long,Long>>()
        db.rawQuery("""SELECT e.label,COUNT(*),SUM(e.end_offset_ms-e.start_offset_ms),MAX(e.end_offset_ms-e.start_offset_ms)
            FROM episodes e JOIN sessions s ON s.id=e.session_id
            WHERE s.started_ms<CAST(? AS INTEGER) AND s.started_ms+s.elapsed_ms>CAST(? AS INTEGER)
            AND s.started_ms+e.start_offset_ms>=CAST(? AS INTEGER) AND s.started_ms+e.start_offset_ms<CAST(? AS INTEGER)
            GROUP BY e.label""",arrayOf(b.toString(),a.toString(),a.toString(),b.toString())).use { c ->
            while(c.moveToNext()) counts[c.getString(0)]=Triple(c.getLong(1),c.getLong(2),c.getLong(3))
        }
        fun count(label: AudioLabel)=counts[label.eventName]?.first ?: 0L
        fun total(label: AudioLabel)=counts[label.eventName]?.second ?: 0L
        val expected=(minOf(b,nowMs)-a).coerceAtLeast(1)
        enqueue(db,"$sourceDeviceId:night:$night","night",JSONObject()
            .put("sourceDeviceId",sourceDeviceId).put("nightOf",night.toString()).put("timezone",zone.id)
            .put("windowStartUtc",utc(a)).put("windowEndUtc",utc(b)).put("status",if(nowMs>=b) "complete" else "in_progress")
            .put("observedThroughUtc",utc(minOf(b,nowMs))).put("expectedMs",expected).put("capturedMs",captured).put("validMs",valid)
            .put("coveragePercent",(100.0*valid/expected).coerceIn(0.0,100.0)).put("sessions",sessions.size)
            .put("soundLevelDbfs",if(valid==0L) JSONObject.NULL else com.babysteps.nurserysensor.audio.AudioStatistics.powerDbfs(power/valid))
            .put("peakDbfs",peak ?: JSONObject.NULL)
            .put("cryEpisodes",count(AudioLabel.BABY_CRY)).put("cryMs",total(AudioLabel.BABY_CRY))
            .put("longestCryMs",counts[AudioLabel.BABY_CRY.eventName]?.third ?: 0L)
            .put("speechEpisodes",count(AudioLabel.SPEECH)).put("speechMs",total(AudioLabel.SPEECH))
            .put("snoringEpisodes",count(AudioLabel.SNORING)).put("snoringMs",total(AudioLabel.SNORING))
            .put("coughEpisodes",count(AudioLabel.COUGH)).put("ambientNoiseMs",total(AudioLabel.AMBIENT_NOISE)))
    }
    @Synchronized fun queueSessionSummaries() {
        readSessions().take(24).forEach { s ->
            enqueue(writableDatabase,"$sourceDeviceId:${s.startedAtMs}:${s.id}:session","session",JSONObject()
                .put("sourceDeviceId",sourceDeviceId).put("sessionId",s.id).put("startUtc",utc(s.startedAtMs))
                .put("endUtc",s.endedAtMs?.let(::utc) ?: JSONObject.NULL).put("status",s.status)
                .put("elapsedMs",s.elapsedMs).put("validMs",s.validMs).put("coveragePercent",s.coveragePercent)
                .put("capturedMs",s.capturedMs).put("silencedMs",s.silencedMs).put("observedThroughUtc",utc(s.startedAtMs+s.elapsedMs))
                .put("soundLevelDbfs",s.meanSquare?.let(com.babysteps.nurserysensor.audio.AudioStatistics::powerDbfs) ?: JSONObject.NULL)
                .put("peakDbfs",s.peakDbfs ?: JSONObject.NULL).put("error",s.error?.take(256) ?: JSONObject.NULL)
                .put("model",s.modelName ?: JSONObject.NULL).put("modelSha256",s.modelSha256 ?: JSONObject.NULL)
                .put("modelError",s.modelError?.take(256) ?: JSONObject.NULL)
                .put("modelStatus",s.modelStatus).put("predictions",s.inferenceCount).put("droppedWindows",s.droppedWindows)
                .put("meanInferenceMs",if(s.inferenceCount==0L) JSONObject.NULL else s.inferenceTotalMs.toDouble()/s.inferenceCount)
                .put("maxInferenceMs",s.inferenceMaxMs)
                .put("appVersion",s.appVersion).put("timezone",s.zoneId).put("sleepState","unknown").put("movementState","not_measured"))
        }
    }
    @Synchronized fun pendingDelivery(limit: Int): List<DeliveryRecord> {
        require(limit in 1..100)
        return readableDatabase.rawQuery("SELECT record_key,payload FROM delivery_queue WHERE sent=0 ORDER BY rowid LIMIT ?",arrayOf(limit.toString())).use { c ->
            buildList { while(c.moveToNext()) add(DeliveryRecord(c.getString(0),c.getString(1))) }
        }
    }
    @Synchronized fun acknowledgeDelivery(records: List<DeliveryRecord>) {
        val db=writableDatabase
        db.beginTransaction()
        try {
            records.forEach { db.update("delivery_queue",ContentValues().apply { put("sent",1) },"record_key=? AND payload=?",arrayOf(it.key,it.payload)) }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    companion object {
        const val DELIVERY_SCHEMA = 2
        private val SHEET_EPISODE_LABELS = setOf(AudioLabel.BABY_CRY,AudioLabel.SPEECH,AudioLabel.SNORING,AudioLabel.COUGH)
        @Volatile private var instance: NightRepository? = null
        fun get(context: Context): NightRepository = instance ?: synchronized(this) {
            instance ?: NightRepository(context.applicationContext).also { it.initialize(); instance = it }
        }
    }
}
