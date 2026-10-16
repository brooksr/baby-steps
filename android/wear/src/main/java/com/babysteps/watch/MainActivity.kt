package com.babysteps.watch

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.NavHostController
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.FailureConfirmationDialog
import androidx.wear.compose.material3.SuccessConfirmationDialog
import androidx.wear.compose.material3.curvedText
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WatchRepository.load(applicationContext)
        requested.value=screenOf(intent) ?: "timer".takeIf { WatchRepository.timer.value!=null }
        setContent { BabystepsTheme { WatchApp(requested.value) { requested.value=null } } }
    }

    /** singleTask: a second launch (a Tile tap, the ongoing activity) arrives here, not in onCreate. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        requested.value=screenOf(intent) ?: "timer".takeIf { WatchRepository.timer.value!=null }
    }

    private val requested=mutableStateOf<String?>(null)
    private fun screenOf(intent: Intent?)=intent?.getStringExtra(EXTRA_SCREEN)?.takeIf { it in SCREENS }

    companion object {
        /** Opens one screen over Home: for a Tile or complication tap, and for checking a screen over adb. */
        const val EXTRA_SCREEN="screen"
        private val SCREENS=setOf("timer","bottle","diaper","settings")
    }
}

/**
 * Closes one screen, and only that one: a second close (a timer ending while its screen is
 * already leaving) is a no-op instead of popping Home and leaving the app blank.
 */
private fun NavHostController.close(route: String) { popBackStack(route,inclusive=true) }

@Composable
private fun WatchApp(screen: String?,onOpened: () -> Unit) {
    val context=LocalContext.current.applicationContext
    val nav=rememberSwipeDismissableNavController()
    val lifecycle=LocalLifecycleOwner.current.lifecycle
    val refused by WatchRepository.refused.collectAsState()
    // Confirmed the moment an entry is saved on the watch: it is durable from then on, and a
    // parent mid-feed should not wait on a network round trip to know the tap took.
    var saved by remember { mutableStateOf<String?>(null) }

    // A feed in progress is why the app was opened (from the launcher or the watch face's
    // ongoing activity), so it opens straight onto the timer, with Home one swipe behind it.
    LaunchedEffect(screen) {
        if(screen==null) return@LaunchedEffect
        // Not on the host's first frame: a jump made before it has laid Home out is undone a moment
        // later, and a cold launch with a feed running landed back on Home.
        snapshotFlow { nav.currentBackStackEntry }.first { it!=null }
        withFrameNanos { }; withFrameNanos { }
        nav.navigate(screen) { launchSingleTop=true; popUpTo("home") }; onOpened()
    }
    LaunchedEffect(Unit) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while(true) { WatchRepository.flush(context); WatchRepository.refresh(context); delay(60_000) }
        }
    }

    AppScaffold {
        SwipeDismissableNavHost(navController=nav,startDestination="home") {
            composable("home") { HomeScreen(
                onTimer={ nav.navigate("timer") },
                onBottle={ nav.navigate("bottle") },
                onDiaper={ nav.navigate("diaper") },
                onSettings={ nav.navigate("settings") }) }
            composable("timer") { TimerScreen(onDone={ text -> nav.close("timer"); if(text!=null) saved=text }) }
            composable("bottle") { BottleScreen(onDone={ text -> nav.close("bottle"); saved=text }) }
            composable("diaper") { DiaperScreen(onDone={ text -> nav.close("diaper"); saved=text }) }
            composable("settings") { SettingsScreen(onDone={ nav.close("settings") }) }
        }
        SuccessConfirmationDialog(visible=saved!=null,onDismissRequest={ saved=null },curvedText={ curvedText(saved.orEmpty()) })
        FailureConfirmationDialog(visible=refused!=null,onDismissRequest={ WatchRepository.clearRefused() },curvedText={ curvedText("Not logged") })
    }
}
