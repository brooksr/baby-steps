package com.babysteps.nurserysensor.classification

import android.content.Context
import android.os.SystemClock
import com.babysteps.nurserysensor.audio.AudioWindow
import com.babysteps.nurserysensor.audio.AudioClassifier
import com.babysteps.nurserysensor.monitoring.SensorLog
import com.babysteps.nurserysensor.reporting.NightRepository
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel

/** One running window + one pending window + capture ring. No unbounded PCM accumulation. */
class ClassificationPipeline(private val context: Context, private val repository: NightRepository,
    private val sessionId: Long, private val startedAtMs: Long, private val startedElapsedMs: Long,
    private val classifierFactory: (Context) -> AudioClassifier = { YamnetClassifier(it) },
    private val onState: suspend (String, Prediction?, Long, String?) -> Unit) {
    private data class Pending(val samples: ShortArray, val endOffsetMs: Long)
    private val dispatcher = Executors.newSingleThreadExecutor { r -> Thread(r,"NurseryClassifier") }.asCoroutineDispatcher()
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)
    private val dropped = AtomicLong()
    private val queue = Channel<Pending>(1,BufferOverflow.DROP_OLDEST,onUndeliveredElement = {
        it.samples.fill(0); dropped.incrementAndGet()
    })
    private val assembler = PcmWindowAssembler()
    private var previousEnd = -1L
    @Volatile private var accepting = true
    private val job = scope.launch {
        var classifier: AudioClassifier? = null
        val detector = EpisodeDetector()
        var sha: String? = null
        var failure: String? = null
        var lastPrediction = -1L
        try {
            sha = context.assets.open("yamnet.sha256").bufferedReader().use { it.readText().trim() }
            check(sha.matches(Regex("[0-9a-f]{64}"))) { "Bundled model identity is missing or invalid" }
            classifier = classifierFactory(context)
            repository.modelState(sessionId,"running",sha)
            onState("Running locally",null,dropped.get(),null)
            SensorLog.event("classifier_ready","model" to "YAMNet v1","sha256" to sha)
            for(window in queue) {
                try {
                    currentCoroutineContext().ensureActive()
                    if(window.endOffsetMs <= lastPrediction) { dropped.incrementAndGet(); continue }
                    val before = SystemClock.elapsedRealtime()
                    val result = classifier.classify(AudioWindow(window.samples,16000,Instant.ofEpochMilli(startedAtMs+window.endOffsetMs)))
                        ?: error("Classifier returned no result")
                    currentCoroutineContext().ensureActive()
                    val prediction = Prediction(window.endOffsetMs,startedAtMs+window.endOffsetMs,result,SystemClock.elapsedRealtime()-before)
                    lastPrediction = window.endOffsetMs
                    val episodes = detector.accept(prediction)
                    repository.prediction(sessionId,prediction,episodes,dropped.get())
                    onState("Running locally",prediction,dropped.get(),null)
                    episodes.forEach { SensorLog.event("sound_episode","label" to it.label.eventName,"durationMs" to it.durationMs,"maxScore" to it.maxScore) }
                } finally { window.samples.fill(0) }
            }
        } catch (_: CancellationException) {
            failure = "Classification did not finish before Stop; queued inference was cancelled."
        } catch (error: Throwable) {
            if(error is VirtualMachineError) throw error
            failure = "Local classifier unavailable: ${error.message ?: error.javaClass.simpleName}"
            SensorLog.event("classifier_failed","message" to failure)
        } finally {
            accepting = false
            queue.cancel() // Erase any window still pending after an initialization/inference error.
            withContext(NonCancellable) {
                try {
                    repository.episodes(sessionId,detector.flush())
                    repository.modelState(sessionId,if(failure==null) "completed" else "error",sha,failure,dropped.get())
                    onState(if(failure==null) "Stopped" else "Unavailable",null,dropped.get(),failure)
                } catch(error: Exception) { SensorLog.event("classifier_cleanup_failed","message" to error.message) }
                finally {
                    try { classifier?.close() } finally { dispatcher.close(); scope.cancel() }
                }
            }
        }
    }
    /** Capture thread only. Callback receives a borrowed PCM array which is erased by AudioCapture. */
    fun offer(samples: ShortArray, silenced: Boolean) {
        val end = SystemClock.elapsedRealtime() - startedElapsedMs
        if(silenced || !accepting) { assembler.reset(); previousEnd = end; return }
        if(previousEnd >= 0 && end-previousEnd > 750) assembler.reset()
        previousEnd = end
        assembler.append(samples) { window, remaining ->
            val pending = Pending(window,(end - remaining*1000L/16000).coerceAtLeast(0))
            if(queue.trySend(pending).isFailure) { window.fill(0); dropped.incrementAndGet() }
        }
    }
    suspend fun stop() {
        accepting = false
        assembler.reset()
        queue.close()
        if(withTimeoutOrNull(5_000) { job.join(); true } != true) {
            job.cancel()
            repository.modelState(sessionId,"error",error="Classifier Stop timed out; numeric monitoring was stopped.",dropped=dropped.get())
            SensorLog.event("classifier_stop_timeout")
        }
    }
}
