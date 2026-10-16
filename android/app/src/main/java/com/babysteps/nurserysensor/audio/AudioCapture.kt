package com.babysteps.nurserysensor.audio

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import com.babysteps.nurserysensor.events.EventSink
import com.babysteps.nurserysensor.events.NurseryEvent
import com.babysteps.nurserysensor.monitoring.SensorLog
import java.time.Instant
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive

/** Owns the mic on one IO coroutine. Cancellation is checked between nonblocking reads,
 * so Stop never waits on a blocking AudioRecord.read() or races release() against read().
 */
class AudioCapture(private val sink: EventSink, private val classifier: AudioClassifier? = null) {
    @SuppressLint("MissingPermission") // Activity + service both check RECORD_AUDIO before capture.
    suspend fun run(onStarted: suspend () -> Unit, onObservation: suspend (SoundObservation) -> Unit,
        onAudio: (ShortArray, Boolean) -> Unit = { _, _ -> }) {
        val minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        check(minimum > 0) { "16 kHz microphone capture is not supported on this phone." }
        val recorder = AudioRecord.Builder()
            // MIC is widely supported; device gain/processing may affect relative readings.
            .setAudioSource(MediaRecorder.AudioSource.MIC)
            .setAudioFormat(AudioFormat.Builder().setSampleRate(SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
            .setBufferSizeInBytes(maxOf(minimum * 2, WINDOW_SAMPLES * 4))
            .build()
        val samples = ShortArray(WINDOW_SAMPLES)
        val statistics = AudioStatistics()
        try {
            check(recorder.state == AudioRecord.STATE_INITIALIZED) { "Microphone initialization failed." }
            recorder.startRecording()
            check(recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Microphone could not start." }
            SensorLog.event("microphone_opened", "sampleRate" to SAMPLE_RATE, "windowMs" to 250)
            onStarted()
            var offset = 0
            var windows = 0
            var lastDataAt = SystemClock.elapsedRealtime()
            while (true) {
                currentCoroutineContext().ensureActive()
                val count = recorder.read(samples, offset, samples.size - offset, AudioRecord.READ_NON_BLOCKING)
                check(count >= 0) { "Microphone read failed (code $count). Stop and start monitoring again." }
                if (count == 0) {
                    check(SystemClock.elapsedRealtime() - lastDataAt < 10_000) { "Microphone stopped delivering data. Try restarting monitoring." }
                    delay(10)
                    continue
                }
                lastDataAt = SystemClock.elapsedRealtime()
                offset += count
                if (offset != samples.size) continue
                val timestamp = Instant.now()
                val silenced = Build.VERSION.SDK_INT >= 29 && recorder.activeRecordingConfiguration?.isClientSilenced == true
                val observation = statistics.observe(samples, timestamp, silenced)
                // Borrowed buffer: downstream must copy into a bounded RAM context before return.
                onAudio(samples, silenced)
                onObservation(observation)
                // V1 has no classifier installed. Never report 'unknown' as a fake inference.
                if (!silenced) classifier?.classify(AudioWindow(samples, SAMPLE_RATE, timestamp))?.let {
                    sink.send(NurseryEvent.Classification(timestamp, it))
                }
                sink.send(NurseryEvent.Observation(observation))
                if (++windows % 40 == 0) SensorLog.event("audio_statistics", "soundLevelDbfs" to observation.soundLevel,
                    "peakDbfs" to observation.sessionPeak, "silenced" to silenced)
                samples.fill(0) // Erase the borrowed window after local processing.
                offset = 0
            }
        } finally {
            samples.fill(0)
            try {
                if (recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) recorder.stop()
            } finally {
                recorder.release()
                classifier?.close()
                SensorLog.event("microphone_released")
            }
        }
    }
    companion object {
        const val SAMPLE_RATE = 16_000
        const val WINDOW_SAMPLES = 4_000
    }
}
