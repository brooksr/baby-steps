package com.babysteps.nurserysensor.monitoring

import java.util.concurrent.Executors
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class MonitoringCleanupTest {
    @Test fun cancelledCaptureStillFlushesAndReturnsToReleaseResources() = runBlocking {
        Executors.newSingleThreadExecutor().asCoroutineDispatcher().use { owner ->
            val started = CompletableDeferred<Unit>()
            val steps = java.util.Collections.synchronizedList(mutableListOf<String>())
            val capture = launch(owner) {
                try { started.complete(Unit); awaitCancellation() }
                finally {
                    finishMonitoring(flush = { delay(25); steps.add("flushed") }, release = { steps.add("released") })
                }
            }
            started.await()
            capture.cancel()
            capture.join()
            assertTrue(capture.isCancelled)
            assertEquals(listOf("flushed", "released"), steps.toList())
        }
    }
    @Test fun failedFlushStillReleasesResources() = runBlocking {
        var released = false
        try {
            finishMonitoring(flush = { error("disk failure") }, release = { released = true })
            fail("Flush failure should propagate")
        } catch (expected: IllegalStateException) {
            assertEquals("disk failure", expected.message)
        }
        assertTrue(released)
    }
}
