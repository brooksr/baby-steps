package com.babysteps.nurserysensor.events

import com.babysteps.nurserysensor.audio.ClassificationResult
import com.babysteps.nurserysensor.audio.SoundObservation
import java.time.Instant

/** Only metadata crosses this boundary. There is deliberately no audio payload field. */
sealed interface NurseryEvent {
    val timestamp: Instant
    data class Observation(val value: SoundObservation) : NurseryEvent {
        override val timestamp: Instant get() = value.timestamp
    }
    data class Classification(override val timestamp: Instant, val result: ClassificationResult) : NurseryEvent
}
interface EventSink { suspend fun send(event: NurseryEvent) }
object NoOpEventSink : EventSink { override suspend fun send(event: NurseryEvent) {} }
