package com.babysteps.nurserysensor.care.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.babysteps.nurserysensor.R
import com.babysteps.nurserysensor.care.model.EventType

/**
 * The Babysteps look (`babysteps/src/styles.css`): its light and dark tokens, the
 * per-entry-type tint and fill every surface codes by, and its two faces —
 * Quicksand for text, Fraunces for headings and numbers.
 */
@Immutable
data class Palette(
    val dark: Boolean,
    val ink: Color, val muted: Color, val page: Color, val panel: Color, val panelBlue: Color, val line: Color, val lineStrong: Color,
    val blue50: Color, val blue100: Color, val blue200: Color, val blue300: Color, val blue400: Color, val blue500: Color, val blue700: Color,
    val accent: Color, val accentStrong: Color, val onAccent: Color, val coral: Color, val danger: Color,
    /** The profile band's gradient, top-left to bottom-right. */
    val bandStart: Color, val bandEnd: Color, val bandBorder: Color,
    val onPrimary: Color,
) {
    /** `--event-tint` / `--event-fill` for one kind of entry. */
    fun event(type: EventType?): Pair<Color,Color> = if(dark) when(type) {
        EventType.FEED, EventType.PUMP -> Color(0xFF7CC0F5) to Color(0xFF1F3245)
        EventType.MENSES -> Color(0xFFE79DC6) to Color(0xFF3A1F30)
        EventType.MOOD -> Color(0xFFEDA2CC) to Color(0xFF38213A)
        EventType.DIAPER -> Color(0xFFE2B360) to Color(0xFF372C17)
        EventType.TUMMYTIME -> Color(0xFF6FD3B8) to Color(0xFF12332C)
        EventType.BATH -> Color(0xFF79C7E4) to Color(0xFF143039)
        EventType.SLEEP -> Color(0xFFA79BF0) to Color(0xFF262147)
        EventType.MEDICATION, EventType.TEMPERATURE, EventType.VACCINE -> Color(0xFFFF9B8F) to Color(0xFF3A201C)
        EventType.BIRTH, EventType.GROWTH, EventType.MILESTONE -> Color(0xFF86C98D) to Color(0xFF1C3320)
        EventType.APPOINTMENT, EventType.NOTE -> Color(0xFF9FB2C4) to Color(0xFF232F3C)
        EventType.INTAKE -> Color(0xFFB6C96D) to Color(0xFF2B331A)
        EventType.OUTPUT -> Color(0xFFD2AB6C) to Color(0xFF33291A)
        null -> blue700 to blue100
    } else when(type) {
        EventType.FEED, EventType.PUMP -> Color(0xFF2F80C4) to Color(0xFFD7ECFB)
        EventType.DIAPER -> Color(0xFF9A6912) to Color(0xFFF7E3BC)
        EventType.TUMMYTIME -> Color(0xFF1F8A76) to Color(0xFFC4ECE0)
        EventType.BATH -> Color(0xFF21789B) to Color(0xFFCBE9F4)
        EventType.SLEEP -> Color(0xFF6558BD) to Color(0xFFDCD8F6)
        EventType.MEDICATION, EventType.TEMPERATURE, EventType.VACCINE -> Color(0xFFC1543F) to Color(0xFFFBD9D2)
        EventType.BIRTH, EventType.GROWTH, EventType.MILESTONE -> Color(0xFF3D8046) to Color(0xFFD3EAD4)
        EventType.MOOD, EventType.MENSES -> Color(0xFFB0517F) to Color(0xFFF7D5E8)
        EventType.APPOINTMENT, EventType.NOTE -> Color(0xFF566E82) to Color(0xFFDBE4EC)
        EventType.INTAKE -> Color(0xFF61761F) to Color(0xFFE6ECC9)
        EventType.OUTPUT -> Color(0xFF856330) to Color(0xFFE7DCC8)
        null -> blue700 to blue100
    }
    fun tint(type: EventType?)=event(type).first
    fun fill(type: EventType?)=event(type).second

    /** The bottom bar's per-tab `--nav-tint`. */
    fun nav(tab: String): Color = if(dark) when(tab) {
        "home" -> Color(0xFFC9ABE6); "log" -> Color(0xFF7CC0F5); "reports" -> Color(0xFF6FD3B8); "care" -> Color(0xFFFF9B8F)
        "shopping" -> Color(0xFFE2B360); "todos" -> Color(0xFFB6C96D); "nursery" -> Color(0xFFA79BF0); else -> Color(0xFF9FB2C4)
    } else when(tab) {
        "home" -> Color(0xFF8F63C4); "log" -> Color(0xFF2F80C4); "reports" -> Color(0xFF1F8A76); "care" -> Color(0xFFCF5F4E)
        "shopping" -> Color(0xFF9A681B); "todos" -> Color(0xFF667D20); "nursery" -> Color(0xFF6558BD); else -> Color(0xFF5B7285)
    }

    /** `.hero-metric.past-due`: amber, the one loud surface on Home. */
    val pastDue=Color(0xFFF4C95D)
    val onPastDue=Color(0xFF49340A)

    companion object {
        val Light=Palette(false,
            ink=Color(0xFF20384B), muted=Color(0xFF64798B), page=Color(0xFFEFF8FF), panel=Color(0xFFFFFFFF), panelBlue=Color(0xFFF6FBFF), line=Color(0xFFCFE4F4), lineStrong=Color(0xFFA8D0EE),
            blue50=Color(0xFFEFF8FF), blue100=Color(0xFFDFF0FF), blue200=Color(0xFFC3E4FB), blue300=Color(0xFF9BD2F6), blue400=Color(0xFF74BDF2), blue500=Color(0xFF4F9FDD), blue700=Color(0xFF256B9D),
            accent=Color(0xFFC9ABE6), accentStrong=Color(0xFFA87FCE), onAccent=Color(0xFF2C1F43), coral=Color(0xFFFF8F80), danger=Color(0xFFA74B42),
            bandStart=Color(0xFF4F9FDD), bandEnd=Color(0xFF256B9D), bandBorder=Color(0xFF2B82BC), onPrimary=Color.White)
        val Dark=Palette(true,
            ink=Color(0xFFE6EEF5), muted=Color(0xFF9FB2C4), page=Color(0xFF0F1620), panel=Color(0xFF18222E), panelBlue=Color(0xFF1C2836), line=Color(0xFF2B3A4B), lineStrong=Color(0xFF3A4D63),
            blue50=Color(0xFF16212E), blue100=Color(0xFF1F3245), blue200=Color(0xFF274058), blue300=Color(0xFF3A5F80), blue400=Color(0xFF5AA0D6), blue500=Color(0xFF4F9FDD), blue700=Color(0xFF7CC0F5),
            accent=Color(0xFFC7A4EA), accentStrong=Color(0xFFB48FE0), onAccent=Color(0xFF2C1F43), coral=Color(0xFFFF8F80), danger=Color(0xFFFF9B8F),
            bandStart=Color(0xFF1F4A6B), bandEnd=Color(0xFF123048), bandBorder=Color(0xFF2B5474), onPrimary=Color(0xFF0F1620))
    }
}

val LocalPalette=staticCompositionLocalOf { Palette.Light }

@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
private fun variable(res: Int,weight: Int)=Font(res,FontWeight(weight),variationSettings=FontVariation.Settings(FontVariation.weight(weight)))

@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
val Quicksand=FontFamily(variable(R.font.quicksand,400),variable(R.font.quicksand,500),variable(R.font.quicksand,600),variable(R.font.quicksand,700))
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
val Fraunces=FontFamily(variable(R.font.fraunces,500),variable(R.font.fraunces,600),variable(R.font.fraunces,700))

/** Headings and numbers: Fraunces, as the web sets every h1–h3 and metric. */
fun display(size: Int,weight: Int=700)=TextStyle(fontFamily=Fraunces,fontWeight=FontWeight(weight),fontSize=size.sp,lineHeight=(size*1.15).sp)
/** Body text: Quicksand. */
fun body(size: Int,weight: Int=500)=TextStyle(fontFamily=Quicksand,fontWeight=FontWeight(weight),fontSize=size.sp,lineHeight=(size*1.45).sp)

@Composable
fun BabystepsTheme(theme: String,content: @Composable () -> Unit) {
    val dark=when(theme) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
    val p=if(dark) Palette.Dark else Palette.Light
    val scheme=if(dark) darkColorScheme(primary=p.blue700,onPrimary=p.onPrimary,primaryContainer=p.blue100,onPrimaryContainer=p.blue700,secondary=p.accent,
        onSecondary=p.onAccent,background=p.page,onBackground=p.ink,surface=p.panel,onSurface=p.ink,surfaceVariant=p.panelBlue,onSurfaceVariant=p.muted,
        outline=p.lineStrong,outlineVariant=p.line,error=p.danger,surfaceContainer=p.panel,surfaceContainerHigh=p.panelBlue,surfaceContainerLow=p.panel,surfaceContainerHighest=p.panelBlue)
    else lightColorScheme(primary=p.blue500,onPrimary=Color.White,primaryContainer=p.blue100,onPrimaryContainer=p.blue700,secondary=p.accentStrong,
        onSecondary=Color.White,background=p.page,onBackground=p.ink,surface=p.panel,onSurface=p.ink,surfaceVariant=p.panelBlue,onSurfaceVariant=p.muted,
        outline=p.lineStrong,outlineVariant=p.line,error=p.danger,surfaceContainer=p.panel,surfaceContainerHigh=p.panelBlue,surfaceContainerLow=p.panel,surfaceContainerHighest=p.panelBlue)
    val base=Typography()
    val type=Typography(
        displayLarge=base.displayLarge.copy(fontFamily=Fraunces), displayMedium=base.displayMedium.copy(fontFamily=Fraunces), displaySmall=base.displaySmall.copy(fontFamily=Fraunces),
        headlineLarge=base.headlineLarge.copy(fontFamily=Fraunces), headlineMedium=base.headlineMedium.copy(fontFamily=Fraunces), headlineSmall=base.headlineSmall.copy(fontFamily=Fraunces,fontWeight=FontWeight.Bold),
        titleLarge=base.titleLarge.copy(fontFamily=Fraunces,fontWeight=FontWeight.Bold), titleMedium=base.titleMedium.copy(fontFamily=Quicksand,fontWeight=FontWeight.Bold), titleSmall=base.titleSmall.copy(fontFamily=Quicksand,fontWeight=FontWeight.Bold),
        bodyLarge=base.bodyLarge.copy(fontFamily=Quicksand,fontWeight=FontWeight.Medium), bodyMedium=base.bodyMedium.copy(fontFamily=Quicksand,fontWeight=FontWeight.Medium), bodySmall=base.bodySmall.copy(fontFamily=Quicksand,fontWeight=FontWeight.Medium),
        labelLarge=base.labelLarge.copy(fontFamily=Quicksand,fontWeight=FontWeight.Bold), labelMedium=base.labelMedium.copy(fontFamily=Quicksand,fontWeight=FontWeight.Bold), labelSmall=base.labelSmall.copy(fontFamily=Quicksand,fontWeight=FontWeight.Bold),
    )
    CompositionLocalProvider(LocalPalette provides p) { MaterialTheme(colorScheme=scheme,typography=type,content=content) }
}
