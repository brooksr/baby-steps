package com.babysteps.nurserysensor.monitoring

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

/** Protect the entire cleanup, including return from IO to the caller's dispatcher.
 * A standalone withContext(NonCancellable + IO) would re-enter a cancelled caller and
 * throw before subsequent resource release/status updates could execute.
 */
internal suspend fun finishMonitoring(flush: suspend () -> Unit, release: () -> Unit) {
    withContext(NonCancellable) {
        try { withContext(Dispatchers.IO) { flush() } }
        finally { release() }
    }
}
