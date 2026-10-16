package com.babysteps.watch

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme

/**
 * The Babysteps app's dark theme (`babysteps/src/styles.css`, `:root[data-theme='dark']`), so a
 * feed on the watch is the same blue as a feed on the phone. Each kind of care keeps the app's
 * `--event-tint` for its mark and `--event-fill` behind it.
 */
object Care {
    // [data-event='feed']
    val feed=Color(0xFF7CC0F5); val feedContainer=Color(0xFF1F3245)
    /** Text on a filled tint: the page color, as `.primary-button` uses it in the dark theme. */
    val onFeed=Color(0xFF0F1620)
    // [data-event='diaper']
    val diaper=Color(0xFFE2B360); val diaperContainer=Color(0xFF372C17)
    // [data-event='sleep']
    val sleep=Color(0xFFA79BF0); val sleepContainer=Color(0xFF262147)
    // --ink, --muted, --line-strong, --page, --panel, --panel-blue, --accent, --danger
    val text=Color(0xFFE6EEF5); val dim=Color(0xFF9FB2C4); val faint=Color(0xFF5E7184)
    val page=Color(0xFF0F1620); val surface=Color(0xFF18222E); val surfaceHigh=Color(0xFF1C2836); val line=Color(0xFF2B3A4B)
    val accent=Color(0xFFC7A4EA)
    val warn=Color(0xFFFF9B8F)
}

@Composable
fun BabystepsTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme=ColorScheme(
            primary=Care.feed, primaryDim=Care.feed, primaryContainer=Care.feedContainer, onPrimary=Care.onFeed, onPrimaryContainer=Care.feed,
            secondary=Care.diaper, secondaryContainer=Care.diaperContainer, onSecondaryContainer=Care.diaper,
            tertiary=Care.sleep, tertiaryContainer=Care.sleepContainer, onTertiaryContainer=Care.sleep,
            surfaceContainerLow=Care.surface, surfaceContainer=Care.surface, surfaceContainerHigh=Care.surfaceHigh,
            onSurface=Care.text, onSurfaceVariant=Care.dim, outline=Care.faint, outlineVariant=Care.line,
            background=Care.page, onBackground=Care.text, error=Care.warn,
        ),
        content=content,
    )
}

/** Digits stay put as they tick: tabular figures everywhere a number changes. */
val TextStyle.tabular get()=copy(fontFeatureSettings="tnum")

/** "1h 52m" with the digits large and the units small and dim, the way a watch face sets a duration. */
fun duration(text: String,unitSize: TextUnit,unitColor: Color)=buildAnnotatedString {
    for(ch in text) if(ch.isLetter()) withStyle(SpanStyle(fontSize=unitSize,color=unitColor)) { append(ch) } else append(ch)
}

/**
 * The Lucide icons the Babysteps app draws (lucide-react 0.468, ISC): milk for a feed, wind for a
 * diaper, droplet, bed and moon as in its Timeline. Strokes, 2 wide with round ends, as Lucide draws them.
 */
object CareIcons {
    private fun icon(name: String,vararg paths: String)=ImageVector.Builder(name,24.dp,24.dp,24f,24f).apply {
        for(d in paths) addPath(PathParser().parsePathString(d).toNodes(),fill=null,stroke=SolidColor(Color.White),
            strokeLineWidth=2f,strokeLineCap=StrokeCap.Round,strokeLineJoin=StrokeJoin.Round)
    }.build()

    val milk=icon("milk","M8 2h8","M9 2v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 7 10.212V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9.789a4 4 0 0 0-.672-2.219l-.656-.984A4 4 0 0 1 15 4.788V2","M7 15a6.472 6.472 0 0 1 5 0 6.47 6.47 0 0 0 5 0")
    val wind=icon("wind","M12.8 19.6A2 2 0 1 0 14 16H2","M17.5 8a2.5 2.5 0 1 1 2 4H2","M9.8 4.4A2 2 0 1 1 11 8H2")
    val bed=icon("bed","M2 4v16","M2 8h18a2 2 0 0 1 2 2v10","M2 17h20","M6 8v9")
    val moon=icon("moon","M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z")
    val droplet=icon("droplet","M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z")
    val pause=icon("pause","M15 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1z","M7 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1z")
    val play=icon("play","M6 3L20 12L6 21z")
    val plus=icon("plus","M5 12h14","M12 5v14")
    val minus=icon("minus","M5 12h14")
    val settings=icon("settings","M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z","M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0")
    val cloudOff=icon("cloudOff","m2 2 20 20","M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193","M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07")
}
