package com.babysteps.nurserysensor.care.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.babysteps.nurserysensor.care.data.CareRepository
import com.babysteps.nurserysensor.care.domain.Dates
import com.babysteps.nurserysensor.care.domain.Emergency
import com.babysteps.nurserysensor.care.domain.Family
import com.babysteps.nurserysensor.care.domain.Reference
import com.babysteps.nurserysensor.care.domain.Units
import com.babysteps.nurserysensor.care.model.EventType
import com.babysteps.nurserysensor.care.model.PARENT_ROLE_LABELS
import com.babysteps.nurserysensor.care.model.isoString
import com.babysteps.nurserysensor.care.model.str
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate

private fun dial(context: Context,phone: String)=runCatching { context.startActivity(Intent(Intent.ACTION_DIAL,Uri.parse("tel:"+phone.filter { it.isDigit() || it=='+' })).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
private fun open(context: Context,url: String)=runCatching { context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
private fun maps(to: String,from: String?)=if(!from.isNullOrBlank()) "https://www.google.com/maps/dir/?api=1&destination=${URLEncoder.encode(to,"UTF-8")}&origin=${URLEncoder.encode(from,"UTF-8")}&travelmode=driving"
    else "https://maps.google.com/?q=${URLEncoder.encode(to,"UTF-8")}"

@Composable
fun CareScreen(ui: Ui) {
    var tab by rememberSaveable { mutableStateOf("key-info") }
    val ageMonths=ui.profile.birthDate?.let { Dates.ageDays(ui.profile)/(365.25/12) }
    Panel {
        Heading("Care plan",ageMonths?.let { "${Units.number(it,1)} months old" } ?: "Log birth to anchor ages",level=1)
        Segmented((if(ui.caregiver) listOf("key-info" to "Key info","emergency" to "Emergency") else listOf("key-info" to "Key info","milestones" to "Milestones","vaccinations" to "Vaccines","emergency" to "Emergency")),tab,scroll=true) { tab=it }
    }
    when(tab) {
        "key-info" -> KeyInfo(ui)
        "milestones" -> Milestones(ui,ageMonths)
        "vaccinations" -> Vaccines(ui)
        "emergency" -> EmergencyGuide(ui)
    }
    if(tab=="milestones" || tab=="vaccinations") Muted("Milestones and the immunization schedule are general references — your pediatrician's guidance comes first.",size=12)
}

private fun toggle(context: Context,ui: Ui,type: EventType,refId: String,on: Boolean) {
    if(on) CareRepository.addEvent(context,JSONObject().put("babyId",ui.profile.id).put("type",type.key).put("refId",refId).put("startedAt",isoString(Instant.now())))
    else ui.events.find { it.type==type && it.refId==refId }?.let { CareRepository.deleteEvent(context,it.id) }
}

@Composable
private fun CheckRow(done: Boolean,title: String,detail: String,overdue: Boolean=false,icon: ImageVector?=null,onClick: () -> Unit,trailing: (@Composable () -> Unit)?=null) {
    val p=LocalPalette.current
    Row(Modifier.fillMaxWidth().clip(Radius).background(if(done) p.panelBlue else p.panel).border(1.dp,if(overdue) p.danger.copy(alpha=0.5f) else p.line,Radius)
        .clickable(onClick=onClick).padding(12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(26.dp).clip(RoundedCornerShape(6.dp)).background(if(done) p.blue500 else p.panel).border(1.5.dp,if(done) p.blue500 else p.lineStrong,RoundedCornerShape(6.dp)),contentAlignment=Alignment.Center) {
            if(done) Icon(Lucide.check,null,tint=if(p.dark) p.page else Color.White,modifier=Modifier.size(16.dp)) else icon?.let { Icon(it,null,tint=p.muted,modifier=Modifier.size(15.dp)) }
        }
        Column(Modifier.weight(1f)) { Ink(title,size=14); Text(detail,style=body(12,600),color=if(overdue) p.danger else p.muted) }
        trailing?.invoke()
    }
}

@Composable
private fun Milestones(ui: Ui,ageMonths: Double?) {
    val context=LocalContext.current
    val p=LocalPalette.current
    val achieved=ui.events.filter { it.type==EventType.MILESTONE }.associateBy { it.refId }
    val milestones=remember { Reference.milestones }
    Panel(event=EventType.MILESTONE) {
        Heading("Milestones","${milestones.count { achieved.containsKey(it.id) }} of ${milestones.size} marked")
        milestones.groupBy { it.ageMonths }.forEach { (month,items) ->
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                Text("$month months",style=display(16),color=p.ink)
                if(ageMonths!=null && month<=ageMonths) Text("age-appropriate",Modifier.clip(RoundedCornerShape(999.dp)).background(p.tint(EventType.MILESTONE).copy(alpha=0.14f)).padding(horizontal=8.dp,vertical=2.dp),
                    style=body(11,800),color=p.tint(EventType.MILESTONE))
            }
            items.forEach { m -> val e=achieved[m.id]
                CheckRow(e!=null,m.milestone,m.domain+(e?.let { " · ${Dates.fullDate(it.start)}" } ?: ""),onClick={ toggle(context,ui,EventType.MILESTONE,m.id,e==null) }) }
        }
    }
}

@Composable
private fun Vaccines(ui: Ui) {
    val context=LocalContext.current
    val given=ui.events.filter { it.type==EventType.VACCINE }.associateBy { it.refId }
    val birth=ui.profile.birthDate?.let { LocalDate.parse(Dates.key(it)) }
    val rows=remember(given,birth) { Reference.vaccinations.map { v -> val due=birth?.plusMonths(v.ageMonths.toLong()); val g=given[v.id]
        Triple(v,g,due) } }
    val next=rows.find { it.second==null }
    Panel(event=EventType.VACCINE) {
        Heading("Vaccinations",next?.let { "Next: ${it.first.age}" } ?: "All marked given")
        rows.forEach { (v,g,due) ->
            val overdue=due!=null && g==null && due.isBefore(LocalDate.now())
            CheckRow(g!=null,v.age,v.vaccines+"\n"+(g?.let { "Given ${Dates.fullDate(it.start)}" } ?: due?.let { "${if(overdue) "Was due" else "Due"} ${java.time.format.DateTimeFormatter.ofPattern("MMM d, yyyy").format(it)}" } ?: "Log birth to schedule"),
                overdue,Lucide.syringe,onClick={ toggle(context,ui,EventType.VACCINE,v.id,g==null) },
                trailing=g?.let { { IconAction(Lucide.pencil,"Edit ${v.vaccines}") { ui.onEdit(it) } } })
        }
    }
}

@Composable
private fun EmergencyGuide(ui: Ui) {
    val p=LocalPalette.current
    val context=LocalContext.current
    val ageDays=ui.profile.birthDate?.let { Dates.ageDays(ui.profile) }
    val own=Emergency.group(ageDays)
    var group by remember(ui.profile.id) { mutableStateOf(own) }
    val guides=Emergency.guides(group,ageDays)
    val name=ui.profile.firstName
    val ped=ui.profile.careInfo.optJSONObject("pediatrician")
    Panel {
        Heading("Emergency",if(group!=own) "Showing steps for ${if(group=="infant") "a baby under 1" else "a child over 1"}, not $name's age."
            else if(ageDays==null) "Showing steps for a baby under 1 — worth reading before the birth." else "Tailored to $name: ${Dates.ageSummary(ui.profile)} old.")
        Segmented(listOf("infant" to "Under 1","child" to "1 year +"),group,Modifier.fillMaxWidth()) { group=it }
        Emergency.LINES.forEach { (title,detail,tel) ->
            val primary=tel=="911"
            Row(Modifier.fillMaxWidth().clip(Radius).background(if(primary) p.danger else p.panel).border(1.dp,if(primary) p.danger else p.line,Radius).clickable { dial(context,tel) }.padding(14.dp),
                verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                Icon(if(primary) Lucide.siren else Lucide.phone,null,tint=if(primary) Color.White else p.danger,modifier=Modifier.size(22.dp))
                Column { Text(if(primary) "Call 911" else title,style=body(16,800),color=if(primary) Color.White else p.ink)
                    Text(if(primary) "Not breathing, choking, unresponsive" else detail,style=body(12,600),color=if(primary) Color.White.copy(alpha=0.9f) else p.muted) }
            }
        }
        ped?.str("phone")?.let { phone -> StatusRow(Lucide.phone,"Pediatrician","${ped.str("name") ?: ""} · $phone") { TextLink("Call") { dial(context,phone) } } }
        guides.forEach { g -> var open by remember(group,g.id) { mutableStateOf(g.id in Emergency.OPEN_BY_DEFAULT) }
            Column(Modifier.fillMaxWidth().clip(Radius).background(p.panel).border(1.dp,p.line,Radius)) {
                Row(Modifier.fillMaxWidth().clickable { open=!open }.padding(14.dp),verticalAlignment=Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Ink(g.title,size=15,weight=800); Muted(g.whenText,size=12) }
                    Icon(if(open) Lucide.chevronDown else Lucide.chevronRight,null,tint=p.muted,modifier=Modifier.size(18.dp))
                }
                if(open) Column(Modifier.padding(start=14.dp,end=14.dp,bottom=14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.fillMaxWidth().clip(Radius).background(p.danger.copy(alpha=0.1f)).padding(10.dp)) {
                        Text("Call 911 if",style=body(13,800),color=p.danger)
                        g.callWhen.forEach { Text("•  $it",style=body(13),color=p.ink) }
                    }
                    g.steps.forEachIndexed { i,s -> Row { Text("${i+1}.",Modifier.width(22.dp),style=body(14,800),color=p.blue700); Text(s,style=body(14),color=p.ink) } }
                    g.notes.forEach { Text("•  $it",style=body(13),color=p.muted) }
                }
            }
        }
        Muted("First-aid steps for a lay rescuer, following American Heart Association and Red Cross guidance. Reading them is not the same as practising them — a hands-on infant and child CPR class is the best preparation there is. When in doubt, call 911.",size=12)
    }
}

// ── Key info ────────────────────────────────────────────────────────────────────

private fun contact(info: JSONObject,key: String)=info.optJSONObject(key)?.let { Triple(it.str("name"),it.str("phone"),it.str("address")) }

@Composable
private fun ContactCard(role: String?,name: String,phone: String?,address: String?,home: String?,icon: ImageVector=Lucide.stethoscope,urgent: Boolean=false) {
    val context=LocalContext.current
    StatusRow(icon,name,address,if(urgent) "urgent" else "normal",role) {
        Spacer(Modifier.height(4.dp))
        ChipRow {
            if(!address.isNullOrBlank()) PrimaryButton("Directions",icon=Lucide.navigation) { open(context,maps(address,home)) }
            if(!phone.isNullOrBlank()) SecondaryButton(phone,icon=Lucide.phone) { dial(context,phone) }
        }
    }
}

@Composable
private fun KeyInfo(ui: Ui) {
    var editing by remember { mutableStateOf(false) }
    val info=ui.profile.careInfo
    if(editing) { KeyInfoForm(ui) { editing=false }; return }
    val metric=ui.profile.metric
    val home=info.str("homeAddress")
    val parents=Family.parents(ui.profiles)
    val guardians=if(parents.isNotEmpty()) parents.map { Triple(it.parentRole?.let { r -> "${it.name} · ${PARENT_ROLE_LABELS[r]}" } ?: it.name,it.phone,null as String?) }
        else info.optJSONArray("guardians")?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { Triple(it.optString("name"),it.str("phone"),it.str("address")) } }.orEmpty()
    val hospital=contact(info,"hospital") ?: Triple("Birth hospital",null,null)
    val ob=contact(info,"ob") ?: Triple("OB / Obstetrician",null,null)
    val ped=contact(info,"pediatrician")
    Panel {
        Heading("Key info","Have these ready before you need them") { if(!ui.caregiver) IconAction(Lucide.pencil,"Edit care info",LocalPalette.current.blue700) { editing=true } }
        guardians.forEach { (n,ph,ad) -> ContactCard(null,n,ph,ad,null,Lucide.phone) }
        ContactCard("ER / Hospital",hospital.first ?: "Birth hospital",hospital.second,hospital.third,home,urgent=true)
        ped?.let { ContactCard("Pediatrician",it.first ?: "",it.second,it.third,home) }
        ContactCard("OB / Midwife",ob.first ?: "",ob.second,ob.third,home)
        info.optJSONArray("emergencyContacts")?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) }.forEach { ContactCard("Backup emergency contact",it.optString("name"),it.str("phone"),null,null,Lucide.phone) } }
        info.str("feedingType")?.let { ft -> StatusRow(Lucide.milk,mapOf("breastmilk" to "Breast milk","formula" to "Formula","combination" to "Combination")[ft] ?: ft,
            listOfNotNull(info.str("formulaBrand")?.let { "Formula: $it" },info.optDouble("bottleAmountOz").takeIf { !it.isNaN() && it>0 }?.let { "${Units.volume(it,metric)} per feed" },info.str("feedingNotes")).joinToString("\n").ifEmpty { null }) }
        if(info.str("feedingType")==null) info.str("feedingNotes")?.let { StatusRow(Lucide.milk,"Feeding",it) }
        listOfNotNull(info.str("safeSleep"),info.str("sleepRoutine"),info.str("soothingMethods")).takeIf { it.isNotEmpty() }?.let { StatusRow(Lucide.bed,"Sleep & soothing",it.joinToString("\n")) }
        info.str("currentMedications")?.let { StatusRow(Lucide.pill,"Current medications",it) }
        info.str("skinNotes")?.let { StatusRow(Lucide.wind,"Skin & diapering",it) }
        info.optJSONObject("insurance")?.let { ins -> StatusRow(Lucide.stethoscope,ins.optString("plan"),listOfNotNull("Member ID: ${ins.optString("memberId")}",ins.str("phone")).joinToString("\n"),role="Health insurance") }
        if(info.str("babyBloodType")!=null || info.str("babyAllergies")!=null) StatusRow(Lucide.stethoscope,"Blood type: ${info.str("babyBloodType") ?: "not recorded"}",info.str("babyAllergies")?.let { "Allergies / conditions: $it" },role="Baby health")
        contact(info,"lactation")?.let { ContactCard("Lactation consultant",it.first ?: "",it.second,it.third,null) }
        contact(info,"pharmacy")?.let { ContactCard("Pharmacy",it.first ?: "",it.second,it.third,null) }
        if(guardians.isEmpty() && ped==null && info.str("feedingType")==null && info.str("safeSleep")==null && info.str("currentMedications")==null && info.str("skinNotes")==null)
            Muted("Tap the pencil to build a caregiver reference card — contacts, feeding, sleep, and medications all in one place.",size=12)
    }
}

@Composable
private fun KeyInfoForm(ui: Ui,onDone: () -> Unit) {
    val context=LocalContext.current
    val p=LocalPalette.current
    val info=ui.profile.careInfo
    val metric=ui.profile.metric
    fun c(key: String,field: String)=info.optJSONObject(key)?.str(field) ?: ""
    val d=remember { mutableStateMapOf(
        "homeAddress" to (info.str("homeAddress") ?: ""),"hospitalName" to (info.optJSONObject("hospital")?.str("name") ?: "Birth hospital"),"hospitalAddress" to c("hospital","address"),
        "obName" to (info.optJSONObject("ob")?.str("name") ?: "OB / Obstetrician"),"obPhone" to c("ob","phone"),"obAddress" to c("ob","address"),
        "pedName" to c("pediatrician","name"),"pedPhone" to c("pediatrician","phone"),"pedAddress" to c("pediatrician","address"),
        "lactName" to c("lactation","name"),"lactPhone" to c("lactation","phone"),"pharmName" to c("pharmacy","name"),"pharmPhone" to c("pharmacy","phone"),
        "ec1Name" to (info.optJSONArray("emergencyContacts")?.optJSONObject(0)?.str("name") ?: ""),"ec1Phone" to (info.optJSONArray("emergencyContacts")?.optJSONObject(0)?.str("phone") ?: ""),
        "ec2Name" to (info.optJSONArray("emergencyContacts")?.optJSONObject(1)?.str("name") ?: ""),"ec2Phone" to (info.optJSONArray("emergencyContacts")?.optJSONObject(1)?.str("phone") ?: ""),
        "insurancePlan" to c("insurance","plan"),"insuranceMemberId" to c("insurance","memberId"),"insurancePhone" to c("insurance","phone"),
        "babyBloodType" to (info.str("babyBloodType") ?: ""),"babyAllergies" to (info.str("babyAllergies") ?: ""),"feedingType" to (info.str("feedingType") ?: ""),
        "formulaBrand" to (info.str("formulaBrand") ?: ""),"bottleAmountOz" to (info.optDouble("bottleAmountOz").takeIf { !it.isNaN() }?.let { Units.number(Units.toVolume(it,metric),if(metric) 0 else 2) } ?: ""),
        "feedingNotes" to (info.str("feedingNotes") ?: ""),"safeSleep" to (info.str("safeSleep") ?: ""),"sleepRoutine" to (info.str("sleepRoutine") ?: ""),
        "soothingMethods" to (info.str("soothingMethods") ?: ""),"currentMedications" to (info.str("currentMedications") ?: ""),"skinNotes" to (info.str("skinNotes") ?: "")) }
    @Composable fun f(label: String,key: String,placeholder: String?=null,multi: Boolean=false,number: Boolean=false)=
        TextInput(label,d[key] ?: "",{ d[key]=it },placeholder=placeholder,singleLine=!multi,minLines=if(multi) 3 else 1,number=number)
    @Composable fun section(title: String)=Text(title,style=display(17),color=p.ink,modifier=Modifier.padding(top=8.dp))

    fun save() {
        fun v(k: String)=d[k]?.trim()?.ifEmpty { null }
        fun contactOf(vararg fields: Pair<String,String>)=JSONObject().apply { fields.forEach { (name,key) -> v(key)?.let { put(name,it) } } }
        // Carried through untouched: the guardians are the parent profiles now, but an old list is still someone's stored data.
        val out=JSONObject()
        info.optJSONArray("guardians")?.let { out.put("guardians",it) }
        v("homeAddress")?.let { out.put("homeAddress",it) }
        v("hospitalName")?.let { out.put("hospital",contactOf("name" to "hospitalName","address" to "hospitalAddress")) }
        v("obName")?.let { out.put("ob",contactOf("name" to "obName","phone" to "obPhone","address" to "obAddress")) }
        v("pedName")?.let { out.put("pediatrician",contactOf("name" to "pedName","phone" to "pedPhone","address" to "pedAddress")) }
        v("lactName")?.let { out.put("lactation",contactOf("name" to "lactName","phone" to "lactPhone")) }
        v("pharmName")?.let { out.put("pharmacy",contactOf("name" to "pharmName","phone" to "pharmPhone")) }
        val ec=JSONArray(); if(v("ec1Name")!=null) ec.put(contactOf("name" to "ec1Name","phone" to "ec1Phone")); if(v("ec2Name")!=null) ec.put(contactOf("name" to "ec2Name","phone" to "ec2Phone"))
        if(ec.length()>0) out.put("emergencyContacts",ec)
        v("insurancePlan")?.let { out.put("insurance",JSONObject().put("plan",it).put("memberId",d["insuranceMemberId"] ?: "").put("phone",d["insurancePhone"] ?: "")) }
        listOf("babyBloodType","babyAllergies","feedingType","formulaBrand","feedingNotes","safeSleep","sleepRoutine","soothingMethods","currentMedications","skinNotes").forEach { k -> v(k)?.let { out.put(k,it) } }
        v("bottleAmountOz")?.replace(',','.')?.toDoubleOrNull()?.let { out.put("bottleAmountOz",Units.fromVolume(it,metric)) }
        CareRepository.saveProfile(context,JSONObject().put("id",ui.profile.id).put("careInfo",out))
        onDone()
    }

    Panel {
        Heading("Key info") { IconAction(Lucide.x,"Cancel",onClick=onDone) }
        section("Home"); f("Home address","homeAddress","123 Main St, City, ST 00000")
        section("Parents / guardians")
        FieldNote("Parents are people the tracker knows — add them under Settings → Family, with a phone number, and they show here. That way one record covers the guardian list, the switcher, and the \"Logged by\" picker.")
        section("ER / Hospital"); f("Name","hospitalName"); f("Address","hospitalAddress")
        section("Pediatrician"); f("Name","pedName"); f("Phone","pedPhone","(000) 000-0000"); f("Address","pedAddress")
        section("OB / Midwife"); f("Name","obName"); f("Phone","obPhone","(000) 000-0000"); f("Address","obAddress")
        section("Lactation consultant"); f("Name","lactName"); f("Phone","lactPhone","(000) 000-0000")
        section("Pharmacy"); f("Name","pharmName"); f("Phone","pharmPhone","(000) 000-0000")
        section("Backup emergency contacts"); f("Contact 1 name","ec1Name"); f("Phone","ec1Phone","(000) 000-0000"); f("Contact 2 name","ec2Name"); f("Phone","ec2Phone","(000) 000-0000")
        section("Health insurance"); f("Plan name","insurancePlan"); f("Member ID","insuranceMemberId"); f("Member services phone","insurancePhone","(000) 000-0000")
        section("Baby health"); f("Blood type","babyBloodType","e.g. A+"); f("Allergies / conditions","babyAllergies")
        section("Feeding")
        Select("Feeding type",listOf("" to "— select —","breastmilk" to "Breast milk","formula" to "Formula","combination" to "Combination"),d["feedingType"] ?: "") { d["feedingType"]=it }
        if(d["feedingType"]=="formula" || d["feedingType"]=="combination") f("Formula brand / type","formulaBrand","e.g. Similac Pro-Advance")
        f("Typical bottle amount (${if(metric) "mL" else "oz"})","bottleAmountOz",if(metric) "e.g. 120" else "e.g. 4",number=true)
        f("Feeding notes","feedingNotes","Schedule, burping method, positions, reflux notes…",multi=true)
        section("Sleep & soothing")
        f("Safe sleep setup","safeSleep","Back to sleep, firm mattress, no loose bedding, room-share without bed-share…",multi=true)
        f("Bedtime routine","sleepRoutine","Bath at 7 pm, nurse, white noise, swaddle…",multi=true)
        f("Soothing methods","soothingMethods","Pacifier, rocking, specific song, walk in carrier…",multi=true)
        section("Current medications"); f("Standing medications","currentMedications","Vitamin D — 400 IU, 1 drop daily at 9 am",multi=true)
        section("Skin & diapering"); f("Diapering & skin notes","skinNotes","Size 1 diapers, Aquaphor for rash, fragrance-free wipes only…",multi=true)
        PrimaryButton("Save care info",Modifier.fillMaxWidth()) { save() }
    }
}
