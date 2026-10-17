package com.babysteps.nurserysensor.care.ui

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.babysteps.nurserysensor.care.data.AppSettings
import com.babysteps.nurserysensor.care.data.CareRepository
import com.babysteps.nurserysensor.care.data.DevicePrefs
import com.babysteps.nurserysensor.care.domain.Csv
import com.babysteps.nurserysensor.care.domain.Dates
import com.babysteps.nurserysensor.care.domain.Family
import com.babysteps.nurserysensor.care.domain.Reference
import com.babysteps.nurserysensor.care.model.GENDER_LABELS
import com.babysteps.nurserysensor.care.model.PARENT_ROLE_LABELS
import com.babysteps.nurserysensor.care.model.Profile
import com.babysteps.nurserysensor.care.model.Tracker
import com.babysteps.nurserysensor.care.model.isoString
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

private fun write(context: Context,uri: Uri,text: String)=runCatching { context.contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) } }.isSuccess

private fun csv(value: Any?)="\""+(value?.toString() ?: "").replace("\"","\"\"")+"\""

/** This person's entries as the web app's CSV export writes them. */
private fun eventsCsv(ui: Ui): String {
    val skip=setOf("id","babyId","caregiverId","createdAt","updatedAt","syncState","startedAt","endedAt","notes","type")
    val rows=ui.events.map { e ->
        val details=JSONObject(); e.json.keys().forEach { if(it !in skip) details.put(it,e.json.get(it)) }
        listOf(csv(e.id),csv(e.json.optString("type")),csv(e.startedAt),csv(e.json.optString("endedAt").ifEmpty { null }),
            csv(ui.profiles.find { it.id==e.caregiverId }?.name),csv(e.notes),csv(details.toString())).joinToString(",")
    }
    return (listOf("id,type,startedAt,endedAt,loggedBy,notes,details")+rows).joinToString("\n")
}

/** The whole tracker, in the web app's `TrackerExport` shape. */
private fun exportJson(t: Tracker)=JSONObject().put("version",1).put("exportedAt",isoString(Instant.now()))
    .put("profile",t.profiles.firstOrNull()?.json ?: JSONObject()).put("profiles",JSONArray().apply { t.profiles.forEach { put(it.json) } })
    .put("events",JSONArray().apply { t.events.sortedBy { it.start }.forEach { put(it.json) } })
    .put("shopping",JSONArray().apply { t.shopping.forEach { put(it.json) } }).put("tasks",JSONArray().apply { t.tasks.forEach { put(it.json) } }).toString(2)

@Composable
fun SettingsScreen(ui: Ui,state: CareRepository.State) {
    val context=LocalContext.current
    val p=LocalPalette.current
    val profile=ui.profile
    val prefs=remember { DevicePrefs(context) }
    var status by remember { mutableStateOf<String?>(null) }

    // Moves with the switcher: keyed on the id alone, so a poll does not wipe what someone is typing.
    var name by remember(profile.id) { mutableStateOf(profile.name) }
    var dueDate by remember(profile.id) { mutableStateOf(profile.dueDate?.let(Dates::key) ?: "") }
    var birthDate by remember(profile.id) { mutableStateOf(profile.birthDate?.let(Dates::key) ?: "") }
    var gender by remember(profile.id) { mutableStateOf(profile.gender ?: "") }
    var role by remember(profile.id) { mutableStateOf(profile.parentRole ?: "mom") }
    var phone by remember(profile.id) { mutableStateOf(profile.phone ?: "") }
    var email by remember(profile.id) { mutableStateOf(profile.email ?: "") }
    var timezone by remember(profile.id) { mutableStateOf(profile.timezone) }
    var metric by remember(profile.id) { mutableStateOf(profile.metric) }
    var ouncesOnly by remember(profile.id) { mutableStateOf(profile.ouncesOnly) }
    val parentEdit=profile.isParent
    val internal=remember { AppSettings(context).internal.selected }

    Heading("Settings","Family profiles and app preferences.",level=1)
    SecondaryButton("Sign-in & account",icon=Lucide.userRound) { ui.navigate(Tab.ACCOUNT) }
    Panel {
        val theme by DevicePrefs.theme.collectAsState()
        Heading("Appearance")
        Segmented(listOf("system" to "Auto","light" to "Light","dark" to "Dark"),theme ?: prefs.theme,Modifier.fillMaxWidth()) { prefs.theme=it }
    }

    Panel {
        Heading("${profile.firstName}’s profile","Editing ${profile.name} · ${ui.events.size} entries")
        TextInput("Name",name,{ name=it })
        if(!parentEdit) DateKeyInput("Due date",dueDate,{ dueDate=it })
        if(parentEdit) {
            Select("Role",PARENT_ROLE_LABELS.toList(),role) { role=it }
            TextInput("Phone",phone,{ phone=it },placeholder="(000) 000-0000",keyboard=androidx.compose.ui.text.input.KeyboardType.Phone)
            TextInput(if(internal) "Contact email (optional)" else "Google account",email,{ email=it },placeholder="name@gmail.com",keyboard=androidx.compose.ui.text.input.KeyboardType.Email)
        }
        DateKeyInput("Birth date",birthDate,{ birthDate=it })
        if(!parentEdit) Select("Gender",listOf("" to "Not set")+GENDER_LABELS.toList(),gender) { gender=it }
        val zones=remember(profile.timezone) { (ZoneId.getAvailableZoneIds()+profile.timezone+ZoneId.systemDefault().id).filter { it.contains('/') || it=="UTC" }.toSortedSet().toList() }
        Select("Timezone",zones.map { it to it.replace('_',' ') },timezone) { timezone=it }
        Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            Select("Preferred units",listOf(false to "American (oz, in, °F)",true to "Metric (mL, cm, °C)"),metric,Modifier.weight(1f)) { metric=it }
            Select("Weight display",listOf(false to "Pounds & ounces",true to "Ounces only"),ouncesOnly,Modifier.weight(1f),enabled=!metric) { ouncesOnly=it }
        }
        PrimaryButton("Save profile",Modifier.fillMaxWidth(),enabled=name.isNotBlank()) {
            val units=JSONObject().put("system",if(metric) "metric" else "american").put("weightDisplay",if(ouncesOnly) "ounces" else "pounds-ounces")
            // A parent has no due date or baby gender, and a child no role: sending them would write blanks.
            val patch=JSONObject().put("id",profile.id).put("name",name.trim()).put("timezone",timezone).put("preferredUnits",units).put("birthDate",birthDate.ifEmpty { null } ?: JSONObject.NULL)
            if(parentEdit) patch.put("parentRole",role).put("phone",phone.trim().ifEmpty { null } ?: JSONObject.NULL).put("email",email.trim().lowercase().ifEmpty { null } ?: JSONObject.NULL)
            else patch.put("dueDate",dueDate.ifEmpty { null } ?: JSONObject.NULL).put("gender",gender.ifEmpty { null } ?: JSONObject.NULL)
            CareRepository.saveProfile(context,patch); status="Profile saved."
        }
    }

    FamilyPanel(ui,metric,ouncesOnly,timezone) { status=it }

    val saveJson=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri -> uri?.let { status=if(write(context,it,exportJson(ui.tracker))) "JSON exported." else "Could not write the file." } }
    val saveCsv=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri -> uri?.let { status=if(write(context,it,eventsCsv(ui))) "CSV exported." else "Could not write the file." } }
    val openJson=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let { status=importJson(context,ui.tracker,it) } }
    Panel {
        Heading("Data & backups","This device keeps an offline copy. Sync sends queued changes and refreshes your family log.")
        Muted("JSON backs up the family; CSV exports ${profile.firstName}’s log.")
        Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
            SecondaryButton("Family backup · JSON",Modifier.fillMaxWidth(),icon=Lucide.download) { saveJson.launch("babysteps-${Dates.today()}.json") }
            SecondaryButton("Current log · CSV",Modifier.fillMaxWidth(),icon=Lucide.download) { saveCsv.launch("babysteps-${profile.name.lowercase().replace(Regex("[^a-z0-9]+"),"-").trim('-').ifEmpty { "tracker" }}-events.csv") }
            SecondaryButton("Import backup",Modifier.fillMaxWidth(),icon=Lucide.upload) { openJson.launch(arrayOf("application/json","*/*")) }
        }
    }

    Panel {
        Heading("Learn","What BabySteps tracks, what it will not do, and the reference tables behind it.")
        SecondaryButton("Open the Learn page",Modifier.fillMaxWidth(),icon=Lucide.bookOpen) { ui.navigate(Tab.LEARN) }
    }

    status?.let { Text(it,Modifier.fillMaxWidth().clip(Radius).background(p.blue100).padding(12.dp),style=body(14,700),color=p.ink) }
}

/** Merge mode, like the web app's import: what the sheet does not have yet is added, nothing is overwritten. */
private fun importJson(context: Context,tracker: Tracker,uri: Uri): String {
    val data=runCatching { JSONObject(context.contentResolver.openInputStream(uri)!!.bufferedReader().use { it.readText() }) }.getOrNull()
        ?: return "The selected file is not a BabySteps export."
    if(data.optInt("version")!=1 || data.optJSONArray("events")==null) return "The selected file is not a BabySteps v1 export."
    val known=tracker.events.map { it.id }.toSet(); var added=0
    val events=data.getJSONArray("events")
    for(i in 0 until events.length()) { val e=events.optJSONObject(i) ?: continue; if(e.optString("id") in known) continue; CareRepository.addEvent(context,e); added++ }
    val people=tracker.profiles.map { it.id }.toSet()
    data.optJSONArray("profiles")?.let { a -> for(i in 0 until a.length()) a.optJSONObject(i)?.takeIf { it.optString("id").isNotEmpty() && it.optString("id") !in people }?.let { CareRepository.saveProfile(context,it) } }
    val shop=tracker.shopping.map { it.id }.toSet(); val tasks=tracker.tasks.map { it.id }.toSet()
    data.optJSONArray("shopping")?.let { a -> for(i in 0 until a.length()) a.optJSONObject(i)?.takeIf { it.optString("id") !in shop }?.let { CareRepository.saveShoppingItem(context,it) } }
    data.optJSONArray("tasks")?.let { a -> for(i in 0 until a.length()) a.optJSONObject(i)?.takeIf { it.optString("id") !in tasks }?.let { CareRepository.saveTask(context,it) } }
    return "Import complete · $added new entr${if(added==1) "y" else "ies"}."
}

@Composable
private fun FamilyPanel(ui: Ui,metric: Boolean,ouncesOnly: Boolean,timezone: String,onStatus: (String) -> Unit) {
    val context=LocalContext.current
    val p=LocalPalette.current
    val internal=remember { AppSettings(context).internal.selected }
    val active=Family.active(ui.profiles); val helpers=Family.caregiverAccounts(ui.profiles); val archived=Family.archived(ui.profiles)
    val parentCount=active.count { it.isParent }; val childCount=active.size-parentCount
    var confirming by remember { mutableStateOf("") }
    var adding by remember { mutableStateOf<String?>(null) }
    val units=JSONObject().put("system",if(metric) "metric" else "american").put("weightDisplay",if(ouncesOnly) "ounces" else "pounds-ounces")

    fun archive(person: Profile) {
        if(confirming!=person.id) { confirming=person.id; return }
        confirming=""; CareRepository.archiveProfile(context,person.id)
        if(person.id==ui.profile.id) Family.active(ui.profiles).firstOrNull { it.id!=person.id }?.let { ui.selectProfile(it.id) }
        onStatus("${person.firstName} is archived. Everything logged is kept, and they can come back any time.")
    }

    @Composable fun row(person: Profile,icon: ImageVector,caption: String,canArchive: Boolean,onPick: (() -> Unit)?) {
        val showing=person.id==ui.profile.id
        Row(Modifier.fillMaxWidth().clip(Radius).background(if(showing) p.blue100 else p.panel).border(1.dp,if(showing) p.blue400 else p.line,Radius)
            .then(if(onPick!=null) Modifier.clickable(onClick=onPick) else Modifier).padding(horizontal=12.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            Icon(icon,null,tint=p.blue700,modifier=Modifier.size(20.dp))
            Column(Modifier.weight(1f)) { Ink(person.name,size=15); Muted(caption+if(showing) " · showing now" else "",size=12) }
            if(canArchive) {
                if(confirming==person.id) SecondaryButton("Archive?",icon=Lucide.archive) { archive(person) }
                else IconAction(Lucide.archive,"Archive ${person.name}") { archive(person) }
            }
        }
    }

    Panel {
        Heading("Family",(if(childCount==1) "1 child" else "$childCount children")+if(parentCount>0) " · $parentCount parent${if(parentCount==1) "" else "s"}" else "")
        if(internal) {
            Muted("Add people here, then send an invitation from Settings → Family on the website. Contact email alone does not grant access.")
            SecondaryButton("Manage family invitations",icon=Lucide.navigation) { openAccountWebsite(context) }
        }
        active.forEach { person ->
            row(person,if(person.isParent) Lucide.userRound else Lucide.baby,
                if(person.isParent) listOfNotNull(PARENT_ROLE_LABELS[person.parentRole ?: "parent"],person.phone).joinToString(" · ") else Dates.dueStatus(person),
                active.size>1) { ui.selectProfile(person.id) }
        }
        if(helpers.isNotEmpty()) { Text("Caregivers",style=display(16),color=p.ink); helpers.forEach { row(it,Lucide.heartHandshake,listOfNotNull(it.email,it.phone).joinToString(" · "),true,null) } }
        if(archived.isNotEmpty()) {
            Text("Archived",style=display(16),color=p.ink)
            archived.forEach { person ->
                Row(Modifier.fillMaxWidth().clip(Radius).background(p.panelBlue).padding(horizontal=12.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                    Icon(if(person.isCaregiver) Lucide.heartHandshake else if(person.isParent) Lucide.userRound else Lucide.baby,null,tint=p.muted,modifier=Modifier.size(20.dp))
                    Column(Modifier.weight(1f)) { Ink(person.name,size=15); Muted("every entry kept",size=12) }
                    SecondaryButton("Bring back",icon=Lucide.archiveRestore) { CareRepository.restoreProfile(context,person.id); onStatus("${person.firstName} is back in the switcher.") }
                }
            }
        }
        when(adding) {
            null -> Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
                SecondaryButton("Add a child",Modifier.fillMaxWidth(),icon=Lucide.plus) { adding="child" }
                SecondaryButton("Add a parent",Modifier.fillMaxWidth(),icon=Lucide.plus) { adding="parent" }
                SecondaryButton("Add a caregiver",Modifier.fillMaxWidth(),icon=Lucide.plus) { adding="caregiver" }
            }
            else -> AddPersonForm(adding!!,ui,units,timezone,onDone={ adding=null },onStatus=onStatus)
        }
        Disclosure("Profiles, access & archiving") {
        FieldNote("Everyone keeps their own entries and reports — a child's growth and milestones, a parent's sleep and, for a mom, her cycle. Parents are also the guardian list on the Care page and the names an entry can be logged under. Archiving takes someone out of the switcher and keeps everything they have: every entry stays exactly as it is, and you can bring them back whenever you like. Nothing here is ever deleted.")
        Muted(if(internal) "Caregivers sign in with their own BabySteps account. The server limits them to the children’s Home, Key info and Emergency." else "Caregivers use their own Google account on the legacy web app. Sheet sharing is managed there.")
        }
    }
}

@Composable
private fun AddPersonForm(kind: String,ui: Ui,units: JSONObject,timezone: String,onDone: () -> Unit,onStatus: (String) -> Unit) {
    val context=LocalContext.current
    val internal=remember { AppSettings(context).internal.selected }
    var name by remember { mutableStateOf("") }
    var due by remember { mutableStateOf("") }
    var birth by remember { mutableStateOf("") }
    var gender by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("mom") }
    var phone by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    Column(verticalArrangement=Arrangement.spacedBy(10.dp)) {
        TextInput(when(kind) { "child" -> "Child's name"; "parent" -> "Parent's name"; else -> "Caregiver's name" },name,{ name=it },placeholder=if(kind=="caregiver") "Grandma" else null)
        when(kind) {
            "child" -> { Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) { DateKeyInput("Due date",due,{ due=it },Modifier.weight(1f)); DateKeyInput("Birth date",birth,{ birth=it },Modifier.weight(1f)) }
                Select("Gender",listOf("" to "Not set")+GENDER_LABELS.toList(),gender) { gender=it } }
            "parent" -> { Select("Role",PARENT_ROLE_LABELS.toList(),role) { role=it }; DateKeyInput("Birth date",birth,{ birth=it })
                TextInput("Phone",phone,{ phone=it },placeholder="(000) 000-0000"); TextInput(if(internal) "Contact email (optional)" else "Google account",email,{ email=it },placeholder="name@gmail.com") }
            else -> { TextInput(if(internal) "Contact email (optional)" else "Google account",email,{ email=it },placeholder="name@gmail.com"); TextInput("Phone",phone,{ phone=it },placeholder="(000) 000-0000") }
        }
        val valid=name.isNotBlank() && (kind!="child" || due.isNotEmpty() || birth.isNotEmpty()) && (internal || kind!="caregiver" || email.contains('@'))
        Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            PrimaryButton("Add $kind",Modifier.weight(1f),enabled=valid) {
                val input=JSONObject().put("name",name.trim()).put("preferredUnits",units).put("timezone",timezone)
                    .put("pendingId",Family.profileId(name,ui.profiles.map { it.id }))
                when(kind) {
                    // A child already born needs no due date: the birth date stands in for it.
                    "child" -> { input.put("kind","child").put("dueDate",due.ifEmpty { birth }); birth.takeIf { it.isNotEmpty() }?.let { input.put("birthDate",it) }; gender.takeIf { it.isNotEmpty() }?.let { input.put("gender",it) } }
                    "parent" -> { input.put("kind","parent").put("parentRole",role); birth.takeIf { it.isNotEmpty() }?.let { input.put("birthDate",it) }
                        phone.trim().takeIf { it.isNotEmpty() }?.let { input.put("phone",it) }; email.trim().lowercase().takeIf { it.isNotEmpty() }?.let { input.put("email",it) } }
                    else -> { input.put("kind","caregiver").put("email",email.trim().lowercase()); phone.trim().takeIf { it.isNotEmpty() }?.let { input.put("phone",it) } }
                }
                CareRepository.addProfile(context,input)
                onStatus(if(internal) "${name.trim().split(" ").first()} added. Send an invitation from the account website to give them access." else if(kind=="caregiver") "${name.trim().split(" ").first()} can now sign in with ${email.trim().lowercase()}. Share the Google Sheet with that account too." else "${name.trim().split(" ").first()} added.")
                onDone()
            }
            SecondaryButton("Cancel",Modifier.weight(1f),onClick=onDone)
        }
    }
}

private fun openAccountWebsite(context: Context) {
    val api=AppSettings(context).internal.api.ifEmpty { "https://raspberrypi.tailc2b8e3.ts.net:8443/api/v1" }
    context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW,Uri.parse(api.removeSuffix("/api/v1")+"/")))
}

/** Where the Pi is and the app token; what the last read and the outbox look like. */
@Composable
fun ConnectionCard(state: CareRepository.State=CareRepository.state.collectAsState().value,ui: Ui?=null) {
    val context=LocalContext.current
    val settings=remember { AppSettings(context) }
    val scope=rememberCoroutineScope()
    var endpoint by remember { mutableStateOf(settings.endpoint) }
    var token by remember { mutableStateOf(settings.token) }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var internalApi by remember { mutableStateOf(settings.internal.api.ifEmpty { "https://raspberrypi.tailc2b8e3.ts.net:8443/api/v1" }) }
    var pairingCode by remember { mutableStateOf("") }
    var exportedQueue by remember { mutableStateOf("") }
    Panel {
        Heading("Account",ui?.profiles?.find { it.id==ui.actorId }?.name,level=1)
        Ink(if(settings.internal.configured) "This device is connected" else "Connect this device")
        Muted("Use a passkey or linked Google account on the BabySteps website, then approve this device’s connection code.")
        Heading("Sign-in & security",level=3)
        Muted("Open Account on the website to manage passkeys, optional Google sign-in, recovery codes and connected devices.")
        SecondaryButton("Open account website",icon=Lucide.navigation) { openAccountWebsite(context) }
        Disclosure("Connect or reconnect this device") {
        TextInput("Account server",internalApi,{ internalApi=it.trim() })
        PrimaryButton("Connect account",enabled=!busy) {
            busy=true; scope.launch {
                try {
                    val reply=kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { settings.internal.begin(internalApi) }
                    pairingCode=reply.getString("userCode"); message="Approve code $pairingCode in the website’s Account page."
                    context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW,android.net.Uri.parse(internalApi.removeSuffix("/api/v1")+"/#device="+pairingCode)))
                } catch(e: Exception) { message=e.message } finally { busy=false }
            }
        }
        if(pairingCode.isNotEmpty() || settings.internal.pairing) PrimaryButton("I approved this phone",enabled=!busy) {
            busy=true; scope.launch {
                try {
                    val ready=kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { settings.internal.complete() }
                    if(ready) { CareRepository.load(context); CareRepository.refresh(context); pairingCode=""; message="Account connected." }
                    else message="The website has not approved this code yet."
                } catch(e: Exception) { message=e.message } finally { busy=false }
            }
        }
        }
        if(settings.internal.selected) Disclosure("Disconnect this device") {
            Muted("Signing out keeps offline changes for this account. Reconnect the same account to sync them.")
            SecondaryButton("Disconnect account") { settings.internal.disconnect(); CareRepository.load(context); scope.launch { CareRepository.refresh(context) } }
        }
        if(state.pending>0) {
            Heading("Queued changes")
            CareRepository.pendingLabels(context).forEachIndexed { index,label -> Muted("${index+1}. $label") }
            if(settings.internal.selected) {
                Muted("Retry applies your fields to the current version. Export first if you want to keep a separate copy.")
                SecondaryButton("Retry oldest with latest version") { scope.launch { try { CareRepository.retryOldest(context); message=CareRepository.state.value.problem ?: "Retry finished." } catch(e: Exception) { message=e.message } } }
            }
            SecondaryButton("Discard oldest queued change") { scope.launch { CareRepository.discardOldest(context) } }
            SecondaryButton("Show queued changes to copy") { exportedQueue=CareRepository.pendingExport(context) }
            if(exportedQueue.isNotEmpty()) androidx.compose.foundation.text.selection.SelectionContainer { Ink(exportedQueue,size=12) }
        }
        message?.let { FieldNote(it) }
    }
    Panel {
        Disclosure("Advanced · legacy connection") {
        Muted("For older deployments only. The internal account connection is preferred.")
        Muted(when {
            !state.configured -> "Not connected."
            state.fetchedAt!=null -> "Last read ${Dates.clock(state.fetchedAt)}"+(if(state.pending>0) " · ${state.pending} change${if(state.pending==1) "" else "s"} waiting to send" else " · everything sent")
            else -> "Connected; no read yet."
        })
        TextInput("Pi address",endpoint,{ endpoint=it.trim() },keyboard=androidx.compose.ui.text.input.KeyboardType.Uri)
        TextInput("App token",token,{ token=it },secret=true,hint="APP_API_TOKEN")
        if(busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            PrimaryButton("Save & connect",Modifier.weight(1f)) {
                try { settings.save(endpoint,token); message=null; busy=true
                    scope.launch { CareRepository.flush(context); CareRepository.refresh(context); busy=false
                        message=CareRepository.state.value.problem ?: "Connected · ${CareRepository.state.value.tracker.events.size} entries read." } }
                catch(e: IllegalArgumentException) { message=e.message }
            }
            SecondaryButton("Sync now",Modifier.weight(1f),icon=Lucide.refresh,enabled=state.configured) {
                busy=true; scope.launch { CareRepository.flush(context); CareRepository.refresh(context); busy=false; message=CareRepository.state.value.problem ?: "Up to date." }
            }
        }
        message?.let { FieldNote(it) }
        Muted("The token is APP_API_TOKEN in ~/babysteps/events.env on the Pi. It stays in this phone's private app storage; app backup is off.",size=12)
        }
    }
}

// ── Learn ───────────────────────────────────────────────────────────────────────

private val TRACKED=listOf(
    "Feeding" to "Nursing (side and duration) or bottle (volume and contents), as one feeding entry. Start a timer and it fills the duration in for you.",
    "Pumping" to "Pumping output in your preferred units, per side or both.",
    "Diapers" to "Wet, dirty, or both, and for anything dirty a poop size and a stool color — with the reference note for that color, flagged when it is one worth a call.",
    "Sleep" to "Sleep sessions, with a running timer for a nap in progress.",
    "Baths" to "Bath entries, counted in days rather than hours.",
    "Growth measurements" to "Weight, length, and head circumference, plus the birth measurements.",
    "Temperature" to "Temperature in °F or °C — stored once in °C, so both devices agree.",
    "Tummy time" to "Minutes per tummy-time session.",
    "Mood" to "A 1–5 mood / fussiness level per entry.",
    "Period days" to "For a parent tracked here: one entry per day of a period, with how heavy it was. Days are grouped back into periods on read, so missing one does not split a period in two.",
    "Medications" to "Scheduled, given, or skipped doses with the medication name and dose.",
    "Appointments" to "Upcoming visits with provider, location, and reason.",
    "Notes" to "Free-text notes with an optional title.",
    "Who logged it" to "Optionally, which parent logged a baby’s entry. The form remembers who this phone logs as, so it fills itself in; left blank, the entry simply says nobody.",
    "Milestones & vaccines" to "Tick off developmental milestones and immunisations from the bundled schedules.")
private val DERIVED=listOf(
    "Newborn daily check" to "In the first weeks, checks the day’s diapers and feeds against typical newborn minimums for that day of life — judged on pace while the day is still running, so a half-done day stays neutral rather than alarming.",
    "Growth charts" to "Plots weight, length and head circumference against the WHO curves for the baby’s sex (−2 SD to +2 SD), with a corrected-age view when the birth was preterm.",
    "What to expect" to "Before the birth, the week of the pregnancy; after it, what this day, week or month of life usually looks like — written through age two, in your baby’s name and pronouns, and read at corrected age once a preterm birth is past the newborn window.",
    "Next-diaper prediction" to "Learns the recent gap between changes — weighted so a changing routine shows up fast — and projects the next one with a window and a confidence. It stays quiet under four intervals rather than guessing.",
    "Feed → diaper timing" to "Average wait from a feed to the next wet and the next dirty diaper, ignoring pairs more than six hours apart.",
    "Gentle rhythm reminders" to "A quiet nudge when a feed is past about three hours or a bath is past about three days. Nothing fires while a timer is running or with no earlier entry to measure from.",
    "Emergency first aid" to "Care → Emergency: tap-to-call 911 and Poison Control, and step-by-step first aid for CPR, choking, breathing trouble, seizures, poisoning, drowning, falls, burns, bleeding and allergic reactions — infant technique under one year, child technique after, with the fever card tightened under three months. First aid for a lay rescuer, never a diagnosis; a hands-on CPR class is the real preparation.",
    "Fever flag" to "Flags a logged temperature in the fever band, and says so more urgently under three months old. Logging and comparison only — never a diagnosis.",
    "Reports & trends" to "Daily totals, first-year trend charts, and per-day averages for feeds, diapers, sleep and milk — by day, week, month, year, or a date range you pick.",
    "Night & Day" to "One night at a time — logged sleep, estimated sleep between wakes, and what the nursery sensor heard — and the naps of the day after it.",
    "Log filters" to "Search the log, filter by type, and narrow to a date range.",
    "Parent sleep & rest" to "For a parent: time in bed per night, less every wake-up and the time it takes to settle back down — so a broken night reads as the rest it actually was. Only a wake-up recorded against you counts.",
    "Cycle & fertility estimate" to "Averages the recent cycles (start to start), then estimates the next period, ovulation about 14 days before it, and the fertile window around that. It needs two cycles before it will say anything. An estimate from logged dates — never contraception, a fertility test, or a pregnancy test.")
private val STORAGE=listOf(
    "Shared Google Sheet" to "Every entry reads and writes one shared Google Sheet — this app through the Babysteps Pi, the web app directly — so every caregiver sees the same log.",
    "Live updates" to "The app re-reads the sheet in the background, so an entry logged on someone else’s phone appears here without a reload.",
    "Works offline" to "Logged with no signal, an entry is kept on this phone with its own time and sent when the Pi can be reached. Reference tables are bundled, not fetched.",
    "Your data, exportable" to "Download everything as JSON or CSV at any time, and import a JSON export back.",
    "Archive, never delete" to "Someone can be archived rather than deleted: they leave the switcher, every entry of theirs is kept exactly as it is, and one tap brings them back.")
private val NEVER=listOf(
    "Real-time vital signs" to "Heart rate, breathing rate, blood oxygen, or continuous temperature require regulated medical sensors — a phone log cannot measure them.",
    "Diagnosing illness" to "Deciding whether a symptom (jaundice, dehydration, fever, infection) is dangerous is a clinical judgment that only a licensed clinician can make.",
    "Medical advice & dosing" to "Recommending medications or doses is medical advice and must come from your pediatrician or pharmacist.",
    "Live baby monitoring" to "The Nursery tab measures sound levels and likely crying, with no audio kept. It is not a medical monitor and does not watch breathing or movement.",
    "Allergy diagnosis" to "Identifying allergies or interpreting reactions requires testing and clinical evaluation.",
    "Contraception & fertility advice" to "The cycle estimate is arithmetic on the dates you logged. It cannot confirm ovulation, prevent or achieve a pregnancy, or tell you whether an irregular cycle needs looking at.")

@Composable
fun LearnScreen() {
    val p=LocalPalette.current
    @Composable fun list(items: List<Pair<String,String>>,icon: ImageVector,tint: androidx.compose.ui.graphics.Color)=items.forEach { (t,d) ->
        Row(Modifier.fillMaxWidth().clip(Radius).background(p.panelBlue).padding(12.dp),horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            Icon(icon,null,tint=tint,modifier=Modifier.size(18.dp)); Column { Ink(t,size=14,weight=800); Muted(d) }
        }
    }
    Panel {
        Heading("Learn","What BabySteps does — and what it deliberately leaves to your care team.",level=1)
        Ink("BabySteps is a shared care log. It records what you enter and surfaces simple, well-established patterns. It is not a medical device and does not diagnose, monitor vitals, or give medical advice.",size=14,weight=500)
    }
    Panel { Heading("What you can log","Entries you make yourself, from Home or the Log."); list(TRACKED,Lucide.check,p.blue700) }
    Panel { Heading("What it works out for you","Derived from the entries above — nothing extra to log."); list(DERIVED,Lucide.sparkles,p.accentStrong) }
    Panel { Heading("Where your data lives"); list(STORAGE,Lucide.cloud,p.blue700) }
    Panel { Heading("What it does not monitor","Things baby apps are often expected to do, but BabySteps will never support."); list(NEVER,Lucide.circleSlash,p.danger) }
    Panel {
        Heading("Reference data","The exact tables BabySteps uses.")
        listOf("growth" to "Growth standards","newborn" to "Newborn expectations","expect" to "What to expect","feature" to "Feature reference data").forEach { (cat,title) ->
            Text(title,style=display(16),color=p.ink)
            Reference.SHEETS.filter { it.category==cat }.forEach { sheet -> var open by remember { mutableStateOf(false) }
                Column(Modifier.fillMaxWidth().clip(Radius).border(1.dp,p.line,Radius)) {
                    Row(Modifier.fillMaxWidth().clickable { open=!open }.padding(12.dp),verticalAlignment=Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Ink(sheet.title,size=14); Muted(sheet.description,size=12) }
                        Icon(if(open) Lucide.chevronDown else Lucide.chevronRight,null,tint=p.muted,modifier=Modifier.size(18.dp))
                    }
                    if(open) CsvTable(Reference.text(sheet.filename))
                }
            }
        }
    }
    Muted("Growth standards come from the WHO Child Growth Standards (2006) — the girls’ curves for a girl, the boys’ otherwise, and the card says so when no sex is set. Newborn diaper/feed ranges are general lactation guidelines. Always defer to your pediatrician.",size=12)
}

@Composable
private fun CsvTable(text: String) {
    val p=LocalPalette.current
    val (headers,rows)=remember(text) { Csv.parse(text) }
    // A long text column gets room to wrap; numbers stay narrow.
    val widths=headers.indices.map { i -> if(rows.any { (it.getOrNull(i)?.length ?: 0)>24 }) 220.dp else 96.dp }
    Column(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(8.dp)) {
        (listOf(headers.map { h -> h.replace('_',' ').split(' ').joinToString(" ") { it.replaceFirstChar(Char::uppercase) } })+rows).forEachIndexed { r,row ->
            Row(Modifier.then(if(r==0) Modifier.background(p.panelBlue) else Modifier).padding(vertical=4.dp)) {
                headers.indices.forEach { i -> Text(row.getOrElse(i) { "" },Modifier.width(widths[i]).padding(end=10.dp),style=body(12,if(r==0) 800 else 500),color=p.ink) }
            }
        }
    }
}
