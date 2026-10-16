package com.babysteps.nurserysensor.monitoring

import com.babysteps.nurserysensor.audio.ObservationHistory
import com.babysteps.nurserysensor.audio.SoundObservation
import java.time.Instant
import com.babysteps.nurserysensor.classification.Prediction
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class ServiceStatus { STOPPED, STARTING, RUNNING, STOPPING, ERROR }
data class MonitoringState(
    val status: ServiceStatus = ServiceStatus.STOPPED,
    val startedAt: Instant? = null,
    val latest: SoundObservation? = null,
    val history: List<SoundObservation> = emptyList(),
    val error: String? = null,
    val sessionId: Long? = null,
    val startedElapsedMs: Long? = null,
    val modelStatus: String = "Off", val prediction: Prediction? = null,
    val classificationDropped: Long = 0, val classificationError: String? = null,
) {
    val active: Boolean get() = status in setOf(ServiceStatus.STARTING, ServiceStatus.RUNNING, ServiceStatus.STOPPING)
}

/** One Android process, no database/DI framework. No audio ever enters this store.
 * All writes run on Main; Compose collects immutable snapshots. Survives activity recreation,
 * not process death. New sessions clear the previous session's numeric history.
 */
object MonitoringStore {
    private val history = ObservationHistory()
    private val mutable = MutableStateFlow(MonitoringState())
    val state = mutable.asStateFlow()
    fun starting() {
        history.clear()
        mutable.value = MonitoringState(status = ServiceStatus.STARTING)
    }
    fun running(sessionId: Long, startedAt: Instant, startedElapsedMs: Long) {
        mutable.value = mutable.value.copy(status = ServiceStatus.RUNNING, startedAt = startedAt,
            sessionId = sessionId, startedElapsedMs = startedElapsedMs)
    }
    fun observation(value: SoundObservation) {
        history.add(value)
        mutable.value = mutable.value.copy(latest = value, history = history.snapshot())
    }
    fun model(status: String, prediction: Prediction?, dropped: Long, error: String?) {
        mutable.value = mutable.value.copy(modelStatus=status,prediction=prediction ?: mutable.value.prediction,
            classificationDropped=dropped,classificationError=error)
    }
    fun stopping() { mutable.value = mutable.value.copy(status = ServiceStatus.STOPPING) }
    fun finished(error: String? = null) {
        mutable.value = mutable.value.copy(status = if (error == null) ServiceStatus.STOPPED else ServiceStatus.ERROR, error = error)
    }
}
