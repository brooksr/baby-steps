package com.babysteps.nurserysensor.care.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.babysteps.nurserysensor.care.domain.DateRange
import com.babysteps.nurserysensor.care.domain.EventText
import com.babysteps.nurserysensor.care.domain.FirstYear
import com.babysteps.nurserysensor.care.domain.inRange
import com.babysteps.nurserysensor.care.model.EventType

private const val PAGE=20

/** Groups first, then any one type — the web Log's filter select. */
private val GROUPS=listOf(
    "all" to ("All types" to null),
    "feeds" to ("Feeds" to setOf(EventType.FEED,EventType.PUMP)),
    "diapers" to ("Diapers" to setOf(EventType.DIAPER)),
    "sleep" to ("Sleep" to setOf(EventType.SLEEP)),
    "health" to ("Health" to setOf(EventType.MEDICATION,EventType.TEMPERATURE,EventType.VACCINE)),
    "growth" to ("Growth" to setOf(EventType.BIRTH,EventType.GROWTH,EventType.MILESTONE,EventType.TUMMYTIME)),
    "io" to ("In & out" to setOf(EventType.INTAKE,EventType.OUTPUT)),
    "other" to ("Other" to setOf(EventType.APPOINTMENT,EventType.BATH,EventType.MENSES,EventType.MOOD,EventType.NOTE)))

@Composable
fun LogScreen(ui: Ui,initialType: EventType?) {
    var scope by rememberSaveable { mutableStateOf("all") }
    var filter by remember(initialType) { mutableStateOf(initialType?.let { "type:${it.key}" } ?: "all") }
    var range by remember { mutableStateOf(DateRange.ALL) }
    var search by rememberSaveable { mutableStateOf("") }
    var visible by remember(filter,range,search,scope) { mutableIntStateOf(PAGE) }

    val scoped=remember(ui.events,scope) { if(scope=="all") ui.events else FirstYear.events(ui.profile,ui.events) }
    val filtered=remember(scoped,filter,range,search) {
        var result=scoped.inRange(range)
        if(filter.startsWith("type:")) { val t=EventType.of(filter.removePrefix("type:")); result=result.filter { it.type==t } }
        else GROUPS.find { it.first==filter }?.second?.second?.let { allowed -> result=result.filter { it.type in allowed } }
        val q=search.trim().lowercase()
        if(q.isNotEmpty()) result=result.filter { EventText.search(it).contains(q) }
        result
    }

    Panel {
        Heading("Log","${filtered.size} of ${scoped.size}",level=1)
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            Segmented(listOf("all" to "All","first-year" to "First year"),scope,Modifier.weight(1f)) { scope=it }
        }
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            if(ui.profile.birthDate==null && ui.profile.isChild) SecondaryButton("Log birth",Modifier.weight(1f)) { ui.onAdd(EventType.BIRTH) }
            PrimaryButton("Add note",Modifier.weight(1f),icon=Lucide.plus) { ui.onAdd(EventType.NOTE) }
        }
        TextInput("Search",search,{ search=it },placeholder="Search entries…")
        Select("Type",GROUPS.map { it.first to it.second.first }+EventType.entries.map { "type:${it.key}" to "Only: ${it.label}" },filter) { filter=it }
        DateRangeFilter(range,"${filtered.size} entr${if(filtered.size==1) "y" else "ies"}") { range=it }
        Timeline(filtered.take(visible),ui.profile,ui.profiles,if(search.isNotBlank() || filter!="all" || range.active) "No matching entries." else "No entries yet.",ui.onEdit,ui.onDelete)
        val remaining=filtered.size-visible
        if(remaining>0) SecondaryButton("Load ${minOf(PAGE,remaining)} more · $remaining remaining",Modifier.fillMaxWidth()) { visible+=PAGE }
    }
}
