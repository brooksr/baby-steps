package com.babysteps.nurserysensor.care.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.babysteps.nurserysensor.care.data.CareRepository
import com.babysteps.nurserysensor.care.data.DevicePrefs
import com.babysteps.nurserysensor.care.domain.Dates
import com.babysteps.nurserysensor.care.domain.DiaperDetails
import com.babysteps.nurserysensor.care.domain.Family
import com.babysteps.nurserysensor.care.domain.IntakeOutput
import com.babysteps.nurserysensor.care.domain.Reference
import com.babysteps.nurserysensor.care.domain.TIMER_TYPES
import com.babysteps.nurserysensor.care.domain.Units
import com.babysteps.nurserysensor.care.model.CareEvent
import com.babysteps.nurserysensor.care.model.EventType
import com.babysteps.nurserysensor.care.model.INTAKE_KIND_LABELS
import com.babysteps.nurserysensor.care.model.MENSES_FLOW_LABELS
import com.babysteps.nurserysensor.care.model.OUTPUT_KIND_LABELS
import com.babysteps.nurserysensor.care.model.PORTION_LABELS
import com.babysteps.nurserysensor.care.model.isoString
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt

private fun num(text: String)=text.trim().replace(',','.').takeIf { it.isNotEmpty() }?.toDoubleOrNull()
private fun rounded(value: Double,digits: Int)=Units.number(value,digits).replace(Regex("[,\\s\\u00A0]"),"")

/** `components/QuickAddDialog.tsx`: add or edit one entry of any type, with a timer for the timed ones. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuickAddSheet(ui: Ui,type: EventType,edit: CareEvent?,preset: Pair<Instant,Instant?>?,onClose: () -> Unit) {
    val context=LocalContext.current
    val prefs=remember { DevicePrefs(context) }
    val p=LocalPalette.current
    val profile=ui.profile
    val metric=profile.metric
    val ouncesOnly=profile.ouncesOnly
    val editing=edit!=null
    val timer=if(!editing && type in TIMER_TYPES) ui.timers[type] else null
    val bottleDefault={ profile.careInfo.optDouble("bottleAmountOz").takeIf { !it.isNaN() }?.let { rounded(Units.toVolume(it,metric),if(metric) 0 else 2) } ?: rounded(Units.toVolume(2.0,metric),0) }
    val openingMethod=prefs.feedMethod
    val bottleFeed=type==EventType.FEED && openingMethod=="bottle"

    var startedAt by remember { mutableStateOf(edit?.start ?: preset?.first ?: timer ?: Instant.now()) }
    var endedAt by remember { mutableStateOf(edit?.end ?: preset?.second) }
    var notes by remember { mutableStateOf(edit?.notes ?: "") }
    var duration by remember { mutableStateOf(when(type) { EventType.SLEEP -> "60"; EventType.TUMMYTIME -> "5"; else -> if(bottleFeed) "" else "15" }) }
    var side by remember { mutableStateOf("left") }
    var amount by remember { mutableStateOf(if(type==EventType.PUMP) rounded(Units.toVolume(3.0,metric),0) else if(bottleFeed) bottleDefault() else "") }
    var contents by remember { mutableStateOf("breastmilk") }
    var method by remember { mutableStateOf(if(type==EventType.FEED) openingMethod else "nursing") }
    var diaperKind by remember { mutableStateOf("wet") }
    var diaperColor by remember { mutableStateOf("") }
    var poopSize by remember { mutableStateOf("") }
    var medName by remember { mutableStateOf("") }
    var dose by remember { mutableStateOf("") }
    var medStatus by remember { mutableStateOf("given") }
    var provider by remember { mutableStateOf("") }
    var location by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("Checkup") }
    var weight by remember { mutableStateOf("") }
    var pounds by remember { mutableStateOf("") }
    var length by remember { mutableStateOf("") }
    var head by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var temperature by remember { mutableStateOf(if(metric) "37" else "98.6") }
    var tempUnit by remember { mutableStateOf(if(metric) "c" else "f") }
    var mood by remember { mutableStateOf("2") }
    var flow by remember { mutableStateOf("medium") }
    var intakeKind by remember { mutableStateOf("food") }
    var items by remember { mutableStateOf("") }
    var tags by remember { mutableStateOf(listOf<String>()) }
    var portion by remember { mutableStateOf("medium") }
    var caffeine by remember { mutableStateOf("") }
    var outputKind by remember { mutableStateOf("pee") }
    var severity by remember { mutableStateOf("2") }
    var bristol by remember { mutableStateOf("4") }
    var outputColor by remember { mutableStateOf(DiaperDetails.DEFAULT_COLOR) }
    // An edit keeps whoever was recorded — including nobody. A new entry opens on this phone's caregiver.
    var caregiverId by remember { mutableStateOf(if(ui.caregiver) ui.actorId.orEmpty() else edit?.caregiverId ?: if(editing) "" else prefs.caregiverId) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(edit?.id) {
        val e=edit ?: return@LaunchedEffect
        when(e.type) {
            EventType.FEED -> { amount=e.amountOz?.let { rounded(Units.toVolume(it,metric),if(metric) 0 else 2) } ?: ""; contents=e.contents ?: "breastmilk"
                duration=e.durationMinutes?.let { rounded(it,0) } ?: ""; method=e.method ?: "nursing"; side=e.side ?: "left" }
            EventType.PUMP -> { amount=rounded(Units.toVolume(e.amountOz ?: 0.0,metric),if(metric) 0 else 2); side=e.side ?: "both" }
            EventType.DIAPER -> { diaperKind=e.kind ?: "wet"; diaperColor=DiaperDetails.color(e) ?: if(e.kind=="wet") "" else DiaperDetails.DEFAULT_COLOR; poopSize=DiaperDetails.size(e) ?: "" }
            EventType.MEDICATION -> { medName=e.medicationName; dose=e.dose; medStatus=e.status ?: "given" }
            EventType.APPOINTMENT -> { reason=e.reason; provider=e.provider ?: ""; location=e.location ?: "" }
            EventType.BIRTH, EventType.GROWTH -> {
                e.weightOz?.let { w -> if(!metric && !ouncesOnly) { val lb=floor(w/16).toInt(); pounds=lb.toString(); weight=rounded(w-lb*16,1) }
                    else weight=rounded(Units.toWeight(w,metric),if(metric) 3 else 1) }
                length=e.lengthIn?.let { rounded(Units.toLength(it,metric),1) } ?: ""; head=e.headCircumferenceIn?.let { rounded(Units.toLength(it,metric),1) } ?: ""
            }
            EventType.NOTE -> title=e.title ?: ""
            EventType.TEMPERATURE -> { temperature=rounded(if(metric) e.celsius else Units.celsiusToF(e.celsius),1); tempUnit=if(metric) "c" else "f" }
            EventType.TUMMYTIME -> duration=rounded(e.durationMinutes ?: 0.0,0)
            EventType.MOOD -> mood=e.level.toString()
            EventType.MENSES -> flow=e.flow
            EventType.INTAKE -> { intakeKind=e.kind ?: "food"; items=e.items ?: ""; tags=e.tags; portion=e.portion ?: "medium"
                amount=e.amountOz?.let { rounded(Units.toVolume(it,metric),if(metric) 0 else 2) } ?: ""; caffeine=e.caffeineMg?.let { rounded(it,0) } ?: "" }
            EventType.OUTPUT -> { outputKind=e.kind ?: "pee"; severity=e.severity?.toString() ?: "2"; bristol=e.bristol?.toString() ?: "4"; outputColor=e.color ?: DiaperDetails.DEFAULT_COLOR }
            else -> {}
        }
    }

    val caregivers=remember(ui.profiles) { Family.parents(ui.profiles)+Family.caregiverAccounts(ui.profiles) }
    // Only a child's entry has a caregiver worth recording: a parent logging their own sleep is not doing it for someone else.
    val accountMode=com.babysteps.nurserysensor.care.data.AppSettings(context).internal.selected
    val showCaregiver=caregivers.isNotEmpty() && !profile.isParent && !ui.caregiver && !(accountMode && !editing)
    val moodLevels=remember { Reference.moodScale }; val stoolColors=remember { Reference.stoolColors }
    val bristolScale=remember { Reference.bristolScale }; val foodTriggers=remember { Reference.foodTriggers }

    fun storedWeight(): Double? {
        if(!metric && !ouncesOnly) { if(pounds.isBlank() && weight.isBlank()) return null; return (num(pounds) ?: 0.0)*16+(num(weight) ?: 0.0) }
        return num(weight)?.let { Units.fromWeight(it,metric) }
    }

    fun save() {
        val start=startedAt
        val trimmed=notes.trim().ifEmpty { null }
        val f=LinkedHashMap<String,Any?>()
        // A legacy `breastfeed` or `bottle` row is written back as the feed it is now read as.
        f["type"]=type.key
        f["startedAt"]=isoString(start); f["notes"]=trimmed
        when(type) {
            EventType.FEED -> { val d=num(duration); val nursing=method=="nursing"
                f["amountOz"]=if(nursing) null else num(amount)?.let { Units.fromVolume(it,metric) }
                f["contents"]=if(nursing) null else contents; f["durationMinutes"]=d
                f["endedAt"]=d?.let { isoString(start.plusSeconds((it*60).roundToInt().toLong())) } ?: endedAt?.let(::isoString)
                f["method"]=method; f["side"]=if(nursing) side else null }
            EventType.BIRTH, EventType.GROWTH -> { f["headCircumferenceIn"]=num(head)?.let { Units.fromLength(it,metric) }; f["lengthIn"]=num(length)?.let { Units.fromLength(it,metric) }; f["weightOz"]=storedWeight() }
            EventType.PUMP -> { val a=num(amount) ?: run { error="Enter how much was pumped."; return }
                f["amountOz"]=Units.fromVolume(a,metric); f["endedAt"]=endedAt?.let(::isoString); f["side"]=side }
            EventType.DIAPER -> { f["color"]=if(diaperKind=="wet") null else diaperColor.ifEmpty { null }; f["kind"]=diaperKind; f["poopSize"]=if(diaperKind=="wet") null else poopSize.ifEmpty { null } }
            EventType.BATH -> {}
            EventType.SLEEP -> f["endedAt"]=endedAt?.let(::isoString)
            EventType.MEDICATION -> { if(medName.isBlank() || dose.isBlank()) { error="Enter the medication and the dose."; return }
                f["dose"]=dose.trim(); f["givenAt"]=if(medStatus=="given") isoString(start) else null; f["medicationName"]=medName.trim(); f["scheduledAt"]=isoString(start); f["status"]=medStatus }
            EventType.APPOINTMENT -> { f["location"]=location.trim().ifEmpty { null }; f["provider"]=provider.trim().ifEmpty { null }; f["reason"]=reason.trim().ifEmpty { "Appointment" } }
            EventType.NOTE -> f["title"]=title.trim().ifEmpty { null }
            EventType.TEMPERATURE -> { val t=num(temperature) ?: run { error="Enter the temperature."; return }
                f["celsius"]=Math.round((if(tempUnit=="f") (t-32)*5/9 else t)*10)/10.0 }
            EventType.TUMMYTIME -> { val d=num(duration) ?: run { error="Enter the minutes."; return }; f["durationMinutes"]=d; f["endedAt"]=isoString(start.plusSeconds((d*60).roundToInt().toLong())) }
            EventType.MOOD -> f["level"]=mood.toInt()
            EventType.MENSES -> f["flow"]=flow
            EventType.INTAKE -> { val drink=intakeKind=="drink"
                f["amountOz"]=if(drink) num(amount)?.let { Units.fromVolume(it,metric) } else null
                f["caffeineMg"]=if(IntakeOutput.CAFFEINE_TAG in tags) num(caffeine) else null; f["items"]=items.trim().ifEmpty { null }; f["kind"]=intakeKind
                f["portion"]=if(drink) null else portion; f["tags"]=tags.takeIf { it.isNotEmpty() }?.let { JSONArray(it) } }
            EventType.OUTPUT -> { val stool=outputKind=="poo"
                f["bristol"]=if(stool) bristol.toInt() else null; f["color"]=if(stool) outputColor.ifEmpty { null } else null; f["kind"]=outputKind; f["severity"]=num(severity)?.toInt() }
            // Milestones and vaccines are ticked from Care; an existing one can still be re-timed or annotated.
            EventType.MILESTONE, EventType.VACCINE -> if(edit==null) return
        }
        if(accountMode && !editing && !profile.isParent) f["caregiverId"]=ui.actorId
        if(showCaregiver) { f["caregiverId"]=caregiverId.ifEmpty { null }; prefs.caregiverId=caregiverId }
        if(type==EventType.FEED && !editing) prefs.feedMethod=method

        if(edit!=null) {
            // An edit keeps the person it was logged against and every field this form does not show.
            val merged=JSONObject(edit.json.toString())
            for((k,v) in f) if(v==null) merged.remove(k) else merged.put(k,v)
            CareRepository.updateEvent(context,merged)
        } else {
            val input=JSONObject().put("babyId",profile.id)
            for((k,v) in f) if(v!=null) input.put(k,v)
            CareRepository.addEvent(context,input)
            if(type in TIMER_TYPES && ui.timers.containsKey(type)) prefs.setTimer(profile.id,type,null)
        }
        if(type==EventType.BIRTH && !com.babysteps.nurserysensor.care.data.AppSettings(context).internal.selected) CareRepository.saveProfile(context,JSONObject().put("id",profile.id).put("birthDate",isoString(start)))
        onClose()
    }

    val sheet=rememberModalBottomSheetState(skipPartiallyExpanded=true)
    ModalBottomSheet(onDismissRequest=onClose,sheetState=sheet,containerColor=p.page) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal=18.dp).padding(bottom=28.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically) {
                EventChip(type,40.dp); Spacer(Modifier.width(12.dp))
                Text("${if(editing) "Edit" else "Add"} ${type.label}",Modifier.weight(1f),style=display(22),color=p.ink)
                IconAction(Lucide.x,"Close",onClick=onClose)
            }
            DateTimeInput("Time",startedAt,{ it?.let { v -> startedAt=v } })

            if(type in TIMER_TYPES && !editing && preset==null) {
                val now=rememberNow(timer!=null)
                Row(Modifier.fillMaxWidth().clip(Radius).background(p.blue100).padding(12.dp),verticalAlignment=Alignment.CenterVertically) {
                    if(timer!=null) {
                        Text(Dates.elapsed(Dates.elapsedSeconds(timer,now)),Modifier.weight(1f),style=display(28),color=p.blue700)
                        SecondaryButton("Stop",icon=Lucide.square) {
                            val stop=Instant.now(); endedAt=stop
                            if(type==EventType.FEED || type==EventType.TUMMYTIME) duration=max(1,Math.round(Dates.elapsedSeconds(timer,stop)/60.0).toInt()).toString()
                            prefs.setTimer(profile.id,type,null)
                        }
                    } else {
                        Muted("Running from when you tap start",Modifier.weight(1f))
                        PrimaryButton("Start timer",icon=Lucide.play) { prefs.setTimer(profile.id,type,Instant.now()); onClose() }
                    }
                }
            }

            when(type) {
                EventType.FEED -> {
                    Segmented(listOf("nursing" to "Nursing","bottle" to "Bottle"),method,Modifier.fillMaxWidth()) { next -> method=next
                        // Switching clears what the other method measures: no stray duration on a bottle.
                        if(next=="nursing") { amount=""; if(duration.isEmpty()) duration="15" } else { duration=""; if(amount.isEmpty()) amount=bottleDefault() } }
                    if(method=="nursing") Select("Side",listOf("left" to "Left","right" to "Right","both" to "Both"),side) { side=it }
                    else Select("Contents",listOf("breastmilk" to "Breast milk","formula" to "Formula","mixed" to "Mixed","other" to "Other"),contents) { contents=it }
                    Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                        TextInput("Minutes",duration,{ duration=it },Modifier.weight(1f),hint="optional",number=true)
                        TextInput(if(metric) "Milliliters" else "Ounces",amount,{ amount=it },Modifier.weight(1f),hint="optional",number=true)
                    }
                }
                EventType.PUMP -> Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                    TextInput(if(metric) "Milliliters" else "Ounces",amount,{ amount=it },Modifier.weight(1f),number=true)
                    Select("Side",listOf("left" to "Left","right" to "Right","both" to "Both"),side,Modifier.weight(1f)) { side=it }
                }
                EventType.DIAPER -> {
                    Select("Type",listOf("wet" to "Wet","dirty" to "Dirty","both" to "Both"),diaperKind) { next -> diaperKind=next
                        diaperColor=if(next=="wet") "" else diaperColor.ifEmpty { DiaperDetails.DEFAULT_COLOR }; poopSize=if(next=="wet") "" else poopSize.ifEmpty { "medium" } }
                    if(diaperKind!="wet") {
                        val options=stoolColors.map { it.id to it.label }+(if(diaperColor.isNotEmpty() && stoolColors.none { it.id==diaperColor }) listOf(diaperColor to diaperColor) else emptyList())
                        Select("Color",options,diaperColor) { diaperColor=it }
                        FieldLabel("Poop size")
                        Segmented(listOf("small" to "Small","medium" to "Medium","large" to "Large"),poopSize,Modifier.fillMaxWidth()) { poopSize=it }
                        // Read against the age on the day of the entry: black is meconium in the first week and something else after it.
                        Reference.stoolColor(diaperColor)?.let { c -> FieldNote(c.guidance,c.flagged(Dates.ageDays(profile,startedAt))) }
                    }
                }
                EventType.INTAKE -> {
                    Segmented(INTAKE_KIND_LABELS.toList(),intakeKind,Modifier.fillMaxWidth()) { intakeKind=it; amount="" }
                    TextInput(if(intakeKind=="drink") "What you drank" else "What you ate",items,{ items=it },placeholder=if(intakeKind=="drink") "Iced coffee, sparkling water" else "Toast and eggs, leftover curry")
                    // The edible half of the shopping list, so what the household buys is a tap rather than a retype.
                    val names=remember(ui.tracker.shopping) { com.babysteps.nurserysensor.care.domain.Shopping.foodNames(ui.tracker.shopping) }
                    val q=items.trim().lowercase()
                    if(q.length>=2) names.filter { it.lowercase().contains(q) && !it.equals(items.trim(),true) }.take(6).takeIf { it.isNotEmpty() }?.let { s -> ChipRow { s.forEach { n -> Chip(n) { items=n } } } }
                    if(intakeKind=="drink") TextInput(if(metric) "Milliliters" else "Ounces",amount,{ amount=it },hint="optional",number=true)
                    else { FieldLabel("Portion"); Segmented(PORTION_LABELS.toList(),portion,Modifier.fillMaxWidth()) { portion=it } }
                    if(IntakeOutput.CAFFEINE_TAG in tags) TextInput("Caffeine mg",caffeine,{ caffeine=it },hint="optional",number=true)
                    FieldLabel("Tags","optional")
                    ChipRow { foodTriggers.forEach { t -> Chip(t.label,t.id in tags) { tags=if(t.id in tags) tags-t.id else tags+t.id } } }
                }
                EventType.OUTPUT -> {
                    FieldLabel("Kind")
                    ChipRow { OUTPUT_KIND_LABELS.forEach { (k,l) -> Chip(l,outputKind==k) { outputKind=k } } }
                    Select("Severity",(1..5).map { "$it" to "$it" },severity,hint="1 slight – 5 severe") { severity=it }
                    if(outputKind=="poo") {
                        Select("Consistency",bristolScale.map { "${it.type}" to "Type ${it.type} · ${it.label}" },bristol) { bristol=it }
                        Select("Color",stoolColors.map { it.id to it.label },outputColor) { outputColor=it }
                        bristolScale.find { "${it.type}"==bristol }?.let { FieldNote(it.reading) }
                    }
                }
                EventType.SLEEP -> DateTimeInput("End time",endedAt,{ endedAt=it },clearable=true,hint="empty while still asleep")
                EventType.MEDICATION -> {
                    TextInput("Medication",medName,{ medName=it }); TextInput("Dose",dose,{ dose=it })
                    Select("Status",listOf("given" to "Given","scheduled" to "Scheduled","skipped" to "Skipped"),medStatus) { medStatus=it }
                }
                EventType.APPOINTMENT -> { TextInput("Reason",reason,{ reason=it }); TextInput("Provider",provider,{ provider=it }); TextInput("Location",location,{ location=it }) }
                EventType.BIRTH, EventType.GROWTH -> {
                    if(!metric && !ouncesOnly) Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                        TextInput("Weight lb",pounds,{ pounds=it },Modifier.weight(1f),number=true); TextInput("oz",weight,{ weight=it },Modifier.weight(1f),number=true)
                    } else TextInput("Weight ${if(metric) "kg" else "oz"}",weight,{ weight=it },number=true)
                    Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                        TextInput("Length ${if(metric) "cm" else "in"}",length,{ length=it },Modifier.weight(1f),number=true)
                        TextInput("Head ${if(metric) "cm" else "in"}",head,{ head=it },Modifier.weight(1f),number=true)
                    }
                }
                EventType.NOTE -> TextInput("Title",title,{ title=it })
                EventType.TEMPERATURE -> Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                    TextInput("Temperature",temperature,{ temperature=it },Modifier.weight(1f),number=true)
                    Select("Unit",listOf("f" to "°F","c" to "°C"),tempUnit,Modifier.weight(1f)) { tempUnit=it }
                }
                EventType.TUMMYTIME -> TextInput("Minutes",duration,{ duration=it },number=true)
                EventType.MENSES -> Select("Flow",MENSES_FLOW_LABELS.toList(),flow) { flow=it }
                EventType.MOOD -> Select("Mood",moodLevels.map { "${it.level}" to "${it.level} · ${it.label}" },mood) { mood=it }
                else -> {}
            }

            if(showCaregiver) Select("Logged by",listOf("" to "Not recorded")+caregivers.map { it.id to it.name },caregiverId) { caregiverId=it }
            TextInput("Notes",notes,{ notes=it },singleLine=false,minLines=3)
            error?.let { FieldNote(it,flagged=true) }
            Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                SecondaryButton("Cancel",Modifier.weight(1f),onClick=onClose)
                PrimaryButton("Save",Modifier.weight(1f)) { error=null; save() }
            }
        }
    }
}
