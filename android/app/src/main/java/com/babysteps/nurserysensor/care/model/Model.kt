package com.babysteps.nurserysensor.care.model

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.OffsetDateTime
import java.util.UUID

/**
 * The Babysteps data model (`babysteps/src/domain/types.ts`), read from the Pi's
 * `GET /api/events/app`. Each record keeps the JSON it arrived as and reads its
 * fields from it, so an edit made here writes back every field this app does not
 * know about rather than dropping it — the sheet is shared with the web app, and
 * history is never rewritten by accident.
 */

internal fun JSONObject.str(name: String): String? = if(isNull(name)) null else optString(name).takeIf { it.isNotEmpty() }
internal fun JSONObject.num(name: String): Double? = if(!has(name) || isNull(name)) null else when(val value=opt(name)) {
    is Number -> value.toDouble()
    is String -> value.toDoubleOrNull()
    else -> null
}

/** ISO instants as the sheet holds them: `2026-10-12T21:00:00.000Z`, or with an offset. */
fun parseInstant(value: String?): Instant? {
    if(value.isNullOrBlank()) return null
    return runCatching { Instant.parse(value) }.recoverCatching { OffsetDateTime.parse(value).toInstant() }.getOrNull()
}

/** `2026-10-12T21:00:00.000Z` — the shape the web app writes, millis included. */
fun isoString(instant: Instant): String = java.time.format.DateTimeFormatter.ISO_INSTANT.format(instant.truncatedTo(java.time.temporal.ChronoUnit.MILLIS))
    .let { if(it.length==20) it.dropLast(1)+".000Z" else it }

/** `event_<uuid>`, as `createId('event')` makes them. */
fun newId(prefix: String)="${prefix}_${UUID.randomUUID()}"

enum class EventType(val key: String,val label: String) {
    APPOINTMENT("appointment","Appointment"), BATH("bath","Bath"), BIRTH("birth","Birth"), DIAPER("diaper","Diaper"),
    FEED("feed","Feeding"), GROWTH("growth","Growth"), INTAKE("intake","Input"), MEDICATION("medication","Medication"),
    MENSES("menses","Period"), MILESTONE("milestone","Milestone"), MOOD("mood","Mood"), NOTE("note","Note"),
    OUTPUT("output","Output"), PUMP("pump","Pumping"), SLEEP("sleep","Sleep"), TEMPERATURE("temperature","Temperature"),
    TUMMYTIME("tummytime","Tummy time"), VACCINE("vaccine","Vaccine");
    companion object {
        private val byKey=entries.associateBy { it.key }
        fun of(key: String?)=byKey[key]
    }
}

/** One logged entry. Unknown types (a web build ahead of this one) are kept but never shown. */
class CareEvent(val json: JSONObject) {
    val id: String=json.optString("id")
    val babyId: String=json.optString("babyId")
    val type: EventType?=EventType.of(json.str("type")) ?: legacyType(json.str("type"))
    val start: Instant=parseInstant(json.str("startedAt")) ?: Instant.EPOCH
    val end: Instant?=parseInstant(json.str("endedAt"))
    val startedAt: String get()=json.optString("startedAt")
    val notes: String? get()=json.str("notes")
    val caregiverId: String? get()=json.str("caregiverId")
    val updatedAt: String? get()=json.str("updatedAt")

    // feed (and legacy `breastfeed` / `bottle` rows, read as feeds — see `legacyEvents.ts`)
    val method: String? get()=json.str("method") ?: when(json.str("type")) { "breastfeed" -> "nursing"; "bottle" -> "bottle"; else -> null }
    val durationMinutes: Double? get()=json.num("durationMinutes")
    val amountOz: Double? get()=json.num("amountOz")
    val side: String? get()=json.str("side") ?: if(json.str("type")=="breastfeed") "both" else null
    val contents: String? get()=json.str("contents") ?: if(json.str("type")=="bottle") "breastmilk" else null
    /** Diaper wet/dirty/both, intake food/drink, output pee/poo/… */
    val kind: String? get()=json.str("kind")
    val color: String? get()=json.str("color")
    val poopSize: String? get()=json.str("poopSize")?.lowercase()?.takeIf { it in setOf("small","medium","large") }
    val medicationName: String get()=json.optString("medicationName")
    val dose: String get()=json.optString("dose")
    val status: String? get()=json.str("status")
    val scheduledAt: String? get()=json.str("scheduledAt")
    val provider: String? get()=json.str("provider")
    val location: String? get()=json.str("location")
    val reason: String get()=json.optString("reason")
    val weightOz: Double? get()=json.num("weightOz")
    val lengthIn: Double? get()=json.num("lengthIn")
    val headCircumferenceIn: Double? get()=json.num("headCircumferenceIn")
    val title: String? get()=json.str("title")
    val celsius: Double get()=json.num("celsius") ?: 0.0
    val level: Int get()=json.num("level")?.toInt() ?: 0
    val flow: String get()=json.str("flow") ?: "medium"
    val items: String? get()=json.str("items")
    val tags: List<String> get()=when(val raw=json.opt("tags")) {
        is JSONArray -> (0 until raw.length()).map { raw.optString(it) }
        is String -> raw.split(',')
        else -> emptyList()
    }.map { it.trim().lowercase() }.filter { it.isNotEmpty() }.distinct()
    val portion: String? get()=json.str("portion")
    val caffeineMg: Double? get()=json.num("caffeineMg")
    val severity: Int? get()=json.num("severity")?.toInt()
    val bristol: Int? get()=json.num("bristol")?.toInt()
    val refId: String get()=json.optString("refId")

    val isNursing get()=type==EventType.FEED && method=="nursing"
    val coversWet get()=type==EventType.DIAPER && (kind=="wet" || kind=="both")
    val coversDirty get()=type==EventType.DIAPER && (kind=="dirty" || kind=="both")

    /** A copy with these fields changed; a null value removes the field. */
    fun with(vararg changes: Pair<String,Any?>)=CareEvent(JSONObject(json.toString()).apply { for((k,v) in changes) if(v==null) remove(k) else put(k,v) })

    override fun equals(other: Any?)=other is CareEvent && other.json.toString()==json.toString()
    override fun hashCode()=json.toString().hashCode()

    companion object {
        private fun legacyType(raw: String?)=if(raw=="breastfeed" || raw=="bottle") EventType.FEED else null
    }
}

enum class ProfileKind { CHILD, PARENT, CAREGIVER }

/** One tracked person — a child or a parent — or a caregiver sign-in. */
class Profile(val json: JSONObject) {
    val id: String=json.optString("id")
    val name: String get()=json.optString("name")
    val kind: ProfileKind get()=when(json.str("kind")) { "parent" -> ProfileKind.PARENT; "caregiver" -> ProfileKind.CAREGIVER; else -> ProfileKind.CHILD }
    val isChild get()=kind==ProfileKind.CHILD
    val isParent get()=kind==ProfileKind.PARENT
    val isCaregiver get()=kind==ProfileKind.CAREGIVER
    val archived get()=json.str("archivedAt")!=null
    val createdAt: String get()=json.optString("createdAt")
    val birthDate: String? get()=json.str("birthDate")
    val dueDate: String? get()=json.str("dueDate")
    val gender: String? get()=json.str("gender")
    val parentRole: String? get()=json.str("parentRole")
    val phone: String? get()=json.str("phone")
    val email: String? get()=json.str("email")
    val timezone: String get()=json.str("timezone") ?: java.time.ZoneId.systemDefault().id
    val careInfo: JSONObject get()=json.optJSONObject("careInfo") ?: JSONObject()
    val metric get()=json.optJSONObject("preferredUnits")?.str("system")=="metric"
    val ouncesOnly get()=json.optJSONObject("preferredUnits")?.str("weightDisplay")=="ounces"
    /** Cycle tracking is offered to a parent whose role is mom. */
    val tracksCycle get()=isParent && parentRole=="mom"
    val firstName: String get()=name.trim().split(Regex("\\s+")).firstOrNull()?.takeIf { it.isNotEmpty() } ?: "Baby"

    override fun equals(other: Any?)=other is Profile && other.json.toString()==json.toString()
    override fun hashCode()=json.toString().hashCode()
}

class ShoppingItem(val json: JSONObject) {
    val id: String=json.optString("id")
    val name: String get()=json.optString("name")
    val category: String get()=json.str("category")?.takeIf { it in SHOPPING_CATEGORIES } ?: "pantry"
    val isFood: Boolean get()=json.optBoolean("isFood",false)
    val status: String get()=json.str("status")?.takeIf { it in setOf("need","cart","done") } ?: "need"
    val quantity: String? get()=json.str("quantity")
    val addedBy: String? get()=json.str("addedBy")
    val completedAt: String? get()=json.str("completedAt")
}

class TaskItem(val json: JSONObject) {
    val id: String=json.optString("id")
    val title: String get()=json.optString("title")
    val notes: String? get()=json.str("notes")
    val status: String get()=if(json.str("status")=="done") "done" else "open"
    val dueAt: String? get()=json.str("dueAt")
    val due: Instant? get()=parseInstant(dueAt)
    val assigneeId: String? get()=json.str("assigneeId")
    val completedAt: String? get()=json.str("completedAt")
    val updatedAt: String get()=json.optString("updatedAt")
}

/** Store order, the way a trip actually happens. */
val SHOPPING_CATEGORIES=listOf("produce","bakery","meat","dairy","frozen","pantry","drinks","snacks","baby","health","household","cleaning","personal","pet")
val SHOPPING_CATEGORY_LABELS=mapOf("baby" to "Baby","bakery" to "Bakery","cleaning" to "Cleaning","dairy" to "Dairy & chilled","drinks" to "Drinks",
    "frozen" to "Frozen","health" to "Health","household" to "Household","meat" to "Meat & fish","pantry" to "Pantry","personal" to "Personal care",
    "pet" to "Pet","produce" to "Produce","snacks" to "Snacks")

val GENDER_LABELS=linkedMapOf("boy" to "Boy","girl" to "Girl","other" to "Prefer not to say")
val PARENT_ROLE_LABELS=linkedMapOf("mom" to "Mom","dad" to "Dad","parent" to "Parent")
val MENSES_FLOW_LABELS=linkedMapOf("spotting" to "Spotting","light" to "Light","medium" to "Medium","heavy" to "Heavy")
val INTAKE_KIND_LABELS=linkedMapOf("food" to "Food","drink" to "Drink")
val PORTION_LABELS=linkedMapOf("small" to "Small","medium" to "Medium","large" to "Large")
val OUTPUT_KIND_LABELS=linkedMapOf("pee" to "Pee","poo" to "Poo","fart" to "Gas","burp" to "Burp","vomit" to "Vomit","reflux" to "Reflux","bloating" to "Bloating","cramp" to "Cramp")

/** Everything the screens render: the whole tracker, as the Pi last read it plus this phone's unsent changes. */
data class Tracker(
    val profiles: List<Profile>,
    val events: List<CareEvent>,
    val shopping: List<ShoppingItem>,
    val tasks: List<TaskItem>,
) {
    /** Entries sorted newest first, grouped by person, built once per read. */
    val byPerson: Map<String,List<CareEvent>> by lazy {
        events.filter { it.type!=null }.sortedByDescending { it.start }.groupBy { it.babyId }
    }
    fun eventsFor(id: String)=byPerson[id].orEmpty()

    companion object {
        val EMPTY=Tracker(emptyList(),emptyList(),emptyList(),emptyList())

        fun parse(reply: JSONObject): Tracker {
            fun <T> list(name: String,make: (JSONObject) -> T)=reply.optJSONArray(name)?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it)?.let(make) } }.orEmpty()
            val profiles=list("profiles",::Profile).ifEmpty { listOfNotNull(reply.optJSONObject("profile")?.let(::Profile)) }
            return Tracker(profiles,list("events",::CareEvent),list("shopping",::ShoppingItem),list("tasks",::TaskItem))
        }
    }

    fun toJson(): JSONObject=JSONObject()
        .put("profiles",JSONArray().apply { profiles.forEach { put(it.json) } })
        .put("events",JSONArray().apply { events.forEach { put(it.json) } })
        .put("shopping",JSONArray().apply { shopping.forEach { put(it.json) } })
        .put("tasks",JSONArray().apply { tasks.forEach { put(it.json) } })
}
