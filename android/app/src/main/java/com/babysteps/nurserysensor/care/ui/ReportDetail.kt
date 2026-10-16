package com.babysteps.nurserysensor.care.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/** `components/ReportExplorer.tsx`: how to read a card, by its title. */
fun explanationFor(title: String): String {
    val exact=mapOf(
        "Asleep" to "Sleep across the night shown, 7pm to 7am. Logged sleep is used as written; elsewhere it is estimated as the time between wakes, less 15 minutes to settle.",
        "Avg feed gap" to "The mean time between consecutive feeds in the selected period. Gaps longer than eight hours are treated as overnight breaks and left out.",
        "Bedtime" to "The start of the first logged sleep of the night. Without one, the night is measured from 7pm and entries before 9pm count as the bedtime routine.",
        "Bottle" to "Milk recorded from bottle feeds on the selected day. Nursing volume is not estimated.",
        "Cycle day" to "Days are counted from the first logged day of the current period.",
        "Cycle length" to "Measured start to start across recent counted cycles. Very short or long gaps are shown in history but excluded from predictions.",
        "Dirty" to "Dirty changes on the selected day. When sizes were logged, the weighted poop total keeps a small change from counting the same as a large one.",
        "Feeds" to "The number of feeds recorded in the selected period, including nursing and bottles.",
        "In bed" to "Average elapsed time from going to bed to getting up. Rest is lower because recorded wake-ups and settling time are subtracted.",
        "Inputs" to "Food and drinks logged in the selected period. Structured tags make entries comparable later; free text remains useful context.",
        "Longest sleep" to "The longest unbroken stretch of sleep in the night shown, logged or estimated.",
        "Longest stretch" to "The average longest uninterrupted rest stretch per night. The supporting best value is the strongest single night in the period.",
        "Meds" to "Medication entries marked as given on the selected day.",
        "Night duty" to "Baby-care entries attributed to this parent between 10pm and 6am. Unattributed entries are not assigned to either parent.",
        "Night sleep" to "Average sleep per finished night in the selected period, 7pm to 7am. Nights with nothing logged are left out rather than counted as perfect nights.",
        "Nights logged" to "Nights with a usable parent sleep entry in the selected period.",
        "Nursing" to "Total recorded nursing time on the selected day. Sessions without a duration do not add minutes.",
        "Nursing L/R" to "The share of single-side nursing sessions recorded on the left and right. Sessions marked both are not forced onto either side.",
        "Outputs" to "Symptoms and body outputs logged in the selected period. Counts describe the log; they do not establish that an input caused an output.",
        "Period length" to "Average number of logged bleeding days in recent periods. Missed logging can make this look shorter.",
        "Pumped" to "Milk volume recorded from pumping sessions on the selected day.",
        "Ready to compare" to "The share of outputs with an input logged during the prior comparison window. This measures data coverage, not causation.",
        "Wake-ups/night" to "Average recorded care interruptions during parent sleep. Nearby baby-care entries are grouped into one wake-up.",
        "Wakes" to "Night feeds, changes and meds logged within 30 minutes of each other count as one wake. Going down and getting up for the day are not wakes, and crying the sensor heard never adds one.",
        "Wakes/night" to "Average wakes per finished night in the selected period, from logged night care entries.",
        "Weight gain" to "The weekly rate between consecutive weight measurements. Closely spaced readings can vary with timing, feeding, and scale conditions.",
        "Wet" to "Wet changes recorded on the selected day. A change marked both wet and dirty contributes to both details.")
    exact[title]?.let { return it }
    return when {
        title.startsWith("Feed →") -> "Average wait from a feed to the next matching diaper. Pairs more than six hours apart are treated as unrelated and excluded."
        title.contains("/day") -> "A per-day average for the selected span. Today is adjusted for how much of the day has elapsed, so an unfinished day does not drag the average down."
        title.contains("Sleep") -> "Sleep totals use completed logged sessions. Open timers and missing end times are not counted as completed sleep."
        title.contains("Diaper") || title.contains("Poops") -> "Diaper figures come from the changes logged in the selected period. Wet and dirty details may overlap when one change was both."
        else -> "This expands the values calculated for the current report selection. Change the period or date on the Reports screen to recalculate it."
    }
}

@Composable
fun ReportDetailDialog(metric: Metric,onClose: () -> Unit) {
    val p=LocalPalette.current
    Dialog(onClose,DialogProperties(usePlatformDefaultWidth=false)) {
        Column(Modifier.fillMaxWidth().padding(16.dp).clip(Radius).background(p.page).padding(18.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment=Alignment.Top) {
                Column(Modifier.weight(1f)) { Muted("REPORT DETAIL",size=11); Text(metric.title,style=display(22),color=p.ink) }
                IconAction(Lucide.x,"Close report detail",onClick=onClose)
            }
            Panel(event=metric.event) { Muted(metric.title); Text(metric.value.ifEmpty { "—" },style=display(30),color=p.ink) }
            if(metric.notes.isNotEmpty()) Column(verticalArrangement=Arrangement.spacedBy(6.dp)) {
                Text("In this report",style=display(16),color=p.ink)
                metric.notes.distinct().filter { it!=metric.value }.forEach { Row { Muted("•  "); Ink(it,size=14,weight=500) } }
            }
            Column(verticalArrangement=Arrangement.spacedBy(6.dp)) {
                Text("How to read it",style=display(16),color=p.ink)
                Ink(explanationFor(metric.title),size=14,weight=500)
            }
        }
    }
}
