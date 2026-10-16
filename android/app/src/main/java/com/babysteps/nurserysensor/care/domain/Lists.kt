package com.babysteps.nurserysensor.care.domain

import com.babysteps.nurserysensor.care.model.CareEvent
import com.babysteps.nurserysensor.care.model.EventType
import com.babysteps.nurserysensor.care.model.INTAKE_KIND_LABELS
import com.babysteps.nurserysensor.care.model.MENSES_FLOW_LABELS
import com.babysteps.nurserysensor.care.model.OUTPUT_KIND_LABELS
import com.babysteps.nurserysensor.care.model.PORTION_LABELS
import com.babysteps.nurserysensor.care.model.Profile
import com.babysteps.nurserysensor.care.model.SHOPPING_CATEGORIES
import com.babysteps.nurserysensor.care.model.SHOPPING_CATEGORY_LABELS
import com.babysteps.nurserysensor.care.model.ShoppingItem
import com.babysteps.nurserysensor.care.model.TaskItem
import java.time.Instant

/** `domain/shopping.ts`. Buying never removes an item: it goes to done, and the list doubles as the catalogue. */
object Shopping {
    fun normalize(name: String)=name.trim().lowercase().replace(Regex("[^a-z0-9]+")," ").trim()
    fun find(items: List<ShoppingItem>,name: String)=normalize(name).takeIf { it.isNotEmpty() }?.let { key -> items.find { normalize(it.name)==key } }
    fun isActive(item: ShoppingItem)=item.status=="need" || item.status=="cart"
    private fun aisleOrder(items: List<ShoppingItem>)=items.sortedWith(compareBy<ShoppingItem>({ SHOPPING_CATEGORIES.indexOf(it.category) },{ it.name }))
    fun active(items: List<ShoppingItem>)=aisleOrder(items.filter(::isActive))
    fun bought(items: List<ShoppingItem>)=items.filter { it.status=="done" }.sortedWith { a,b -> val ac=a.completedAt; val bc=b.completedAt
        when { ac!=null && bc!=null -> bc.compareTo(ac); ac!=null -> -1; bc!=null -> 1; else -> a.name.compareTo(b.name) } }
    fun aisles(items: List<ShoppingItem>): List<Pair<String,List<ShoppingItem>>> { val sorted=active(items)
        return SHOPPING_CATEGORIES.map { c -> (SHOPPING_CATEGORY_LABELS[c] ?: c) to sorted.filter { it.category==c } }.filter { it.second.isNotEmpty() } }
    fun suggest(items: List<ShoppingItem>,query: String,limit: Int=8): List<ShoppingItem> {
        val key=normalize(query); if(key.isEmpty()) return emptyList()
        return items.filter { !isActive(it) && normalize(it.name).contains(key) }
            .sortedWith(compareBy<ShoppingItem>({ !normalize(it.name).startsWith(key) },{ it.name })).take(limit)
    }
    fun foodNames(items: List<ShoppingItem>)=items.filter { it.isFood }.map { it.name }.distinct().sorted()
}

/** `domain/tasks.ts`. A task with no date is not late — it just needs doing. */
object Tasks {
    val BUCKET_LABELS=linkedMapOf("overdue" to "Overdue","today" to "Today","upcoming" to "Coming up","someday" to "No date")
    fun bucket(task: TaskItem,now: Instant=Dates.now()): String {
        val due=task.due ?: return "someday"
        val dk=Dates.key(due); val today=Dates.key(now)
        return if(dk<today) "overdue" else if(dk==today) "today" else "upcoming"
    }
    fun sort(tasks: List<TaskItem>)=tasks.sortedWith { a,b -> val ad=a.dueAt; val bd=b.dueAt
        when { ad!=null && bd!=null -> ad.compareTo(bd).takeIf { it!=0 } ?: a.title.compareTo(b.title); ad!=null -> -1; bd!=null -> 1; else -> a.title.compareTo(b.title) } }
    fun groups(tasks: List<TaskItem>,now: Instant=Dates.now()): List<Pair<String,List<TaskItem>>> { val open=sort(tasks.filter { it.status=="open" })
        return BUCKET_LABELS.keys.map { b -> b to open.filter { bucket(it,now)==b } }.filter { it.second.isNotEmpty() } }
    fun done(tasks: List<TaskItem>)=tasks.filter { it.status=="done" }.sortedByDescending { it.completedAt ?: it.updatedAt }
}

/** How one entry reads on the timeline (`components/Timeline.tsx`), and what the Log's search matches. */
object EventText {
    fun detail(e: CareEvent,profile: Profile?): String {
        val metric=profile?.metric==true
        fun join(vararg parts: String?)=parts.filterNotNull().filter { it.isNotEmpty() }.joinToString(" · ")
        return when(e.type) {
            EventType.BATH -> "Bath time"
            EventType.FEED -> join(if(e.method=="nursing") "nursing"+(e.side?.let { " · $it side" } ?: "") else "bottle"+(e.contents?.let { " · $it" } ?: ""),
                e.durationMinutes?.let { Dates.duration(it) },e.amountOz?.let { Units.volume(it,metric) })
            EventType.BIRTH, EventType.GROWTH -> join(e.weightOz?.let { Units.weight(it,profile) },e.lengthIn?.let { Units.length(it,metric) },
                e.headCircumferenceIn?.let { "${Units.length(it,metric)} head" }).ifEmpty { if(e.type==EventType.BIRTH) "Birth logged" else "Measurement" }
            EventType.MENSES -> "${MENSES_FLOW_LABELS[e.flow] ?: e.flow} flow"
            EventType.INTAKE -> join(e.items ?: INTAKE_KIND_LABELS[e.kind]?.lowercase(),e.portion?.let { "${PORTION_LABELS[it]?.lowercase() ?: it} portion" },
                if(e.kind=="drink") e.amountOz?.let { Units.volume(it,metric) } else null,e.caffeineMg?.let { "${Units.number(it,0)} mg caffeine" },
                e.tags.takeIf { it.isNotEmpty() }?.joinToString(", ") { Reference.foodTrigger(it)?.label ?: it })
            EventType.OUTPUT -> join(OUTPUT_KIND_LABELS[e.kind]?.lowercase() ?: e.kind,e.severity?.let { "severity $it/5" },
                Reference.bristol(e.bristol)?.let { "type ${it.type} · ${it.label.lowercase()}" },e.color?.let { Reference.stoolColor(it)?.label ?: it })
            EventType.PUMP -> "${Units.volume(e.amountOz ?: 0.0,metric)} · ${e.side ?: "both"}"
            EventType.DIAPER -> join(e.kind,DiaperDetails.size(e)?.let { "$it poop" },DiaperDetails.color(e)?.let { Reference.stoolColor(it)?.label ?: it })
            EventType.SLEEP -> if(e.end!=null) Dates.duration(Summary.durationMinutes(e)) else "In progress"
            EventType.MEDICATION -> "${e.medicationName} · ${e.dose} · ${e.status ?: ""}"
            EventType.APPOINTMENT -> join(e.reason,e.provider,e.location)
            EventType.NOTE -> e.title ?: e.notes ?: "Note"
            EventType.TEMPERATURE -> Units.temperature(e.celsius,metric)
            EventType.TUMMYTIME -> Dates.duration(e.durationMinutes ?: 0.0)
            EventType.MOOD -> Reference.moodScale.find { it.level==e.level }?.let { "${e.level} · ${it.label}" } ?: "Level ${e.level}"
            EventType.MILESTONE -> Reference.milestone(e.refId)?.milestone ?: "Milestone reached"
            EventType.VACCINE -> Reference.vaccination(e.refId)?.let { "${it.age} · ${it.vaccines}" } ?: "Vaccine given"
            null -> ""
        }
    }

    fun search(e: CareEvent): String {
        val p=mutableListOf(e.type?.label ?: "")
        when(e.type) {
            EventType.FEED -> { p+=listOfNotNull(e.method,e.side,e.contents); e.amountOz?.let { p+="${Units.number(it,2)} oz" } }
            EventType.PUMP -> p+=listOfNotNull("${Units.number(e.amountOz ?: 0.0,2)} oz",e.side)
            EventType.DIAPER -> p+=listOfNotNull(e.kind,DiaperDetails.size(e),DiaperDetails.color(e)?.let { Reference.stoolColor(it)?.label ?: it })
            EventType.MEDICATION -> p+=listOfNotNull(e.medicationName,e.dose,e.status)
            EventType.APPOINTMENT -> p+=listOfNotNull(e.reason,e.provider,e.location)
            EventType.NOTE -> p+=listOfNotNull(e.title)
            EventType.TEMPERATURE -> p+=e.celsius.toString()
            EventType.MOOD -> p+="level ${e.level}"
            EventType.MENSES -> p+=e.flow
            EventType.INTAKE -> p+=listOfNotNull(e.kind,e.items,e.portion)+e.tags
            EventType.OUTPUT -> { p+=listOfNotNull(e.kind,e.color); e.severity?.let { p+="severity $it" }; e.bristol?.let { p+="type $it" } }
            else -> {}
        }
        e.notes?.let { p+=it }
        return p.joinToString(" ").lowercase()
    }
}

/** `domain/emergency.ts`: first aid for a lay rescuer, split at the first birthday. Never a diagnosis or a dose. */
object Emergency {
    data class Guide(val id: String,val title: String,val whenText: String,val callWhen: List<String>,val steps: List<String>,val notes: List<String> = emptyList())
    const val INFANT_MAX_DAYS=365
    const val YOUNG_INFANT_FEVER_DAYS=90
    val OPEN_BY_DEFAULT=setOf("choking","cpr")

    fun group(ageDays: Int?)=if(ageDays==null || ageDays<INFANT_MAX_DAYS) "infant" else "child"

    private fun cpr(infant: Boolean)=if(infant) Guide("cpr","Not breathing / no heartbeat","Limp, not responding, and not breathing — or only gasping.",
        listOf("They do not respond, and are not breathing or are only gasping."),
        listOf("Tap the sole of the foot and shout their name. No response and not breathing normally? Start now.",
            "Shout for help. Anyone there calls 911 and fetches an AED. Alone with a phone: put 911 on speaker and start. Alone without one: do 2 minutes of CPR first, then carry the baby with you to call.",
            "Lay the baby on their back on something firm and flat — a table or the floor.",
            "Push in the center of the chest, just below the nipple line: both thumbs with your hands wrapped around the chest, or the heel of one hand. About 1½ inches (4 cm) deep, 100–120 a minute — the beat of \"Stayin' Alive\". Let the chest come all the way back up.",
            "After 30 pushes, give 2 breaths: tilt the head back just slightly, lift the chin, and cover their mouth and nose with your mouth. Puff gently — just enough to see the chest rise — about one second each.",
            "Keep going, 30 pushes then 2 breaths, until they breathe, help takes over, or an AED is ready. Turn the AED on and do what it says."),
        listOf("Don't stop to feel for a pulse — if they aren't breathing normally, push.",
            "A baby's heart usually stops because their breathing did, so the breaths matter. If you can't give them, keep pushing anyway.",
            "An AED can be used on a baby. Use child pads if the AED has them; adult pads if not (one on the chest, one on the back)."))
    else Guide("cpr","Not breathing / no heartbeat","Limp, not responding, and not breathing — or only gasping.",
        listOf("They do not respond, and are not breathing or are only gasping."),
        listOf("Tap their shoulder and shout their name. No response and not breathing normally? Start now.",
            "Shout for help. Anyone there calls 911 and fetches an AED. Alone with a phone: put 911 on speaker and start. Alone without one: do 2 minutes of CPR first, then go and call.",
            "Lay them on their back on something firm and flat.",
            "Push in the center of the chest, on the lower half of the breastbone, with the heel of one hand (two hands for a bigger child). About 2 inches (5 cm) deep, 100–120 a minute — the beat of \"Stayin' Alive\". Let the chest come all the way back up.",
            "After 30 pushes, give 2 breaths: tilt the head back, lift the chin, pinch the nose and seal your mouth over theirs. Breathe just enough to see the chest rise — about one second each.",
            "Keep going, 30 pushes then 2 breaths, until they breathe, help takes over, or an AED is ready. Turn the AED on and do what it says."),
        listOf("Don't stop to feel for a pulse — if they aren't breathing normally, push.",
            "A child's heart usually stops because their breathing did, so the breaths matter. If you can't give them, keep pushing anyway.",
            "Use an AED as soon as one arrives. Child pads if it has them; adult pads if not, as long as they do not touch.",
            "Once puberty has started, use adult technique: two hands, at least 2 inches deep."))

    private fun choking(infant: Boolean)=if(infant) Guide("choking","Choking","Can't cry, cough, or breathe after putting something in their mouth.",
        listOf("They can't cry, cough, or breathe — have someone call while you start."),
        listOf("Coughing hard, gagging or crying? Let them cough — that is the body clearing it. Stay with them and watch.",
            "Silent, turning blue, or making a high-pitched noise? Act now.",
            "5 back blows: lay the baby face-down along your forearm, head lower than their chest, holding the jaw (not the throat). Give 5 firm blows between the shoulder blades with the heel of your hand.",
            "5 chest thrusts: turn them face-up on your other forearm, head still low. With the heel of one hand in the center of the chest, just below the nipple line, give 5 quick pushes about 1½ inches deep.",
            "Repeat 5 back blows and 5 chest thrusts until the object comes out or the baby can cry or breathe.",
            "If they go limp, call 911 and start CPR. Each time you open the mouth for breaths, look — take the object out only if you can see it."),
        listOf("No abdominal thrusts (Heimlich) under one year — back blows and chest thrusts only.",
            "Never sweep a finger blindly in their mouth; it can push the object further down.",
            "Even once it comes out, have the baby checked by a doctor."))
    else Guide("choking","Choking","Can't speak, cough, or breathe after putting something in their mouth.",
        listOf("They can't speak, cough, or breathe — have someone call while you start."),
        listOf("Coughing hard or able to talk? Encourage them to keep coughing, and stay with them.",
            "Can't speak, cough, or breathe, or clutching their throat? Tell them you're going to help.",
            "5 back blows: kneel or stand behind them, lean them forward with one arm across their chest, and give 5 firm blows between the shoulder blades with the heel of your hand.",
            "5 abdominal thrusts: wrap your arms around their waist, make a fist just above the belly button (well below the breastbone), grab it with your other hand, and give 5 quick thrusts in and up.",
            "Repeat 5 back blows and 5 abdominal thrusts until the object comes out or they can breathe, cough, or talk.",
            "If they go limp, lower them to the floor, call 911 and start CPR. Each time you open the mouth for breaths, look — take the object out only if you can see it."),
        listOf("Never sweep a finger blindly in their mouth; it can push the object further down.",
            "After abdominal thrusts, have them checked by a doctor even if they seem fine."))

    private fun breathing(infant: Boolean)=Guide("breathing","Struggling to breathe","Working hard to breathe, wheezing, grunting, or turning blue.",
        listOf("Lips, tongue or face look blue or gray.","Pauses in breathing, or breathing so hard they cannot "+if(infant) "feed." else "talk or drink.",
            "The skin between the ribs or at the base of the neck sucks in with each breath, or they grunt with every breath.","Unusually sleepy, floppy, or hard to wake."),
        listOf("Call 911 if any of the signs above are there. Otherwise call the pediatrician now.",
            if(infant) "Hold the baby upright against you, or let them find the position they breathe easiest in." else "Let them sit up in whatever position they breathe easiest in; keep them calm.",
            "Give nothing to eat or drink.","Use any rescue inhaler or nebulizer exactly as their doctor prescribed it.","If they stop breathing or go limp, start CPR."))

    private fun seizure(infant: Boolean)=Guide("seizure","Seizure","Stiffening, jerking or twitching, eyes rolled back, not responding.",
        listOf(if(infant) "Any seizure in a baby under one year." else "It is their first seizure.","It lasts more than 5 minutes, or one follows another.",
            "They are blue or struggling to breathe afterwards, or do not start waking up.","They were hurt, or it happened in water."),
        listOf("Note the time it started.","Lay them on their side on the floor, or another flat surface they cannot fall from. Move hard or sharp things away.",
            "Put nothing in their mouth — not a finger, not a spoon. They cannot swallow their tongue.",
            "Do not hold them down or try to stop the movements. Loosen anything tight around the neck.",
            "When it stops, keep them on their side and let them rest. Stay with them until they are fully awake."),
        listOf("A short seizure with a fever is common between 6 months and 5 years. It is still frightening, and still needs a doctor the same day."))

    private fun fever(ageDays: Int?): Guide { val young=ageDays==null || ageDays<YOUNG_INFANT_FEVER_DAYS
        return Guide("fever",if(young) "Fever under 3 months" else "High fever",if(young) "100.4°F (38°C) or higher in a baby under 3 months." else "A high temperature with other worrying signs.",
            listOf("Hard to wake, limp, or unusually floppy.","Struggling to breathe, or lips look blue.","A seizure.","A rash of spots that do not fade when you press a glass against them."),
            if(young) listOf("Take a rectal temperature — it is the reliable reading at this age.",
                "100.4°F (38°C) or higher: call the pediatrician now, day or night. If you cannot reach them, go to the emergency room.",
                "Do not give any fever medicine before a doctor has seen or spoken to the baby.","Keep them lightly dressed and keep offering feeds.")
            else listOf("Call 911 for any of the signs above.",
                "Otherwise, call the pediatrician for advice — sooner if they won't drink, have far fewer wet diapers than usual, or just seem very unwell to you.",
                "Keep them lightly dressed, and keep offering fluids.","Ask the pediatrician or pharmacist before giving any medicine; never give aspirin to a child."),
            if(young) listOf("Under 3 months, a rectal temperature of 100.4°F (38°C) or higher is always a call to the doctor straight away — even if the baby seems well.") else emptyList()) }

    private val poisoning=Guide("poisoning","Poisoning","Swallowed medicine, a cleaning product, a battery, a plant — or you think they might have.",
        listOf("Not responding, struggling to breathe, or having a seizure."),
        listOf("Call Poison Control (1-800-222-1222) right away, even if they seem fine. Have the container in your hand.",
            "Swallowed a button battery or a magnet? Go to the emergency room now — even with no symptoms.",
            "Do not make them vomit, and give nothing to eat or drink unless Poison Control says to.",
            "On the skin: take off the clothing and rinse the skin under running water for 15–20 minutes.",
            "In the eyes: rinse with lukewarm running water for 15 minutes, holding the eyelids open.","Take the container or plant with you if you go to the hospital."),
        listOf("Poison Control is free, confidential, and open 24/7 — call even if you are only unsure."))

    private val drowning=Guide("drowning","Drowning","Found in the water, in any amount — a bath is enough.",
        listOf("Always — call 911 for any child pulled from the water who is not completely well."),
        listOf("Get them out of the water and shout for help.","Not breathing normally? Start CPR straight away, with the breaths — they matter most here.",
            "Breathing? Lay them on their side so water can drain, and keep them warm.","Have them checked by a doctor, even if they seem to recover fully."),
        listOf("Breathing trouble can start hours afterwards. Any coughing, fast breathing or unusual sleepiness later that day means calling the doctor."))

    private fun head(infant: Boolean)=Guide("head","Fall / head injury","A fall or knock to the head.",
        listOf("Knocked out, even briefly, or now hard to wake.","A seizure, or vomiting more than once.","Clear fluid or blood coming from the nose or ears.",
            "Neck pain, or not moving an arm or leg normally — and then do not move them.")+if(infant) listOf("A soft bulge on the head, or the soft spot looks swollen.") else emptyList(),
        listOf("If you think the neck is hurt, keep them still and call 911 — do not pick them up.","Otherwise, comfort them and hold a cold cloth on any bump for 20 minutes.",
            if(infant) "Call the pediatrician after any fall in a baby under one year, even if they seem fine." else "Call the pediatrician if they were dazed, cry for a long time, or anything seems off.",
            "Watch them closely for the next 24 hours: sleepiness, vomiting, unsteadiness, or not acting like themselves means calling the doctor."))

    private fun burns(infant: Boolean)=Guide("burns","Burns","Hot drinks, bath water, stoves, irons, sun, or chemicals.",
        listOf("A burn on the face, hands, feet, genitals or across a joint.",
            if(infant) "Any burn bigger than a quarter, or any blistering burn." else "A burn bigger than their palm, or a deep, white or charred one.","An electrical or chemical burn."),
        listOf("Hold the burn under cool (not cold) running water for 20 minutes.","Take off clothing and jewelry near the burn — but not anything stuck to it.",
            "Cover it loosely with plastic wrap or a clean, non-fluffy cloth.","No ice, butter, or creams.",
            if(infant) "Keep the rest of the baby warm — babies get cold quickly while a burn is cooling." else "Keep the rest of them warm while the burn cools."))

    private val bleeding=Guide("bleeding","Bleeding","A cut or wound that is bleeding heavily.",
        listOf("Blood is spurting, soaking through, or will not stop after 10 minutes of firm pressure."),
        listOf("Press firmly on the wound with a clean cloth or gauze.","Don't lift it to look. If blood soaks through, add more on top and keep pressing.",
            "Keep pressing for 10 minutes without letting go.","Have a doctor look at any cut that gapes, is on the face, or was made by something dirty or an animal bite."))

    private val allergy=Guide("allergy","Severe allergic reaction","Hives with swelling, breathing trouble or vomiting after a food, medicine or sting.",
        listOf("Trouble breathing, wheezing, or a hoarse cry or voice.","Swelling of the lips, tongue or face.","Repeated vomiting, or turning pale and floppy, after a new food or a sting."),
        listOf("If they have a prescribed epinephrine auto-injector, use it now — then call 911.",
            "Lay them down with their legs raised; if breathing is hard, let them sit up instead. Do not let them stand or walk.",
            "Stay with them. If they stop breathing, start CPR.","Hives on their own, with none of the signs above: call the pediatrician."))

    /** Most life-threatening first; a fever under three months moves up beside the breathing card. */
    fun guides(group: String,ageDays: Int?): List<Guide> {
        val infant=group=="infant"
        val groupAge=if(infant) ageDays?.takeIf { it<INFANT_MAX_DAYS } else maxOf(ageDays ?: 0,INFANT_MAX_DAYS)
        val urgent=groupAge==null || groupAge<YOUNG_INFANT_FEVER_DAYS
        val f=fever(groupAge)
        return listOfNotNull(cpr(infant),choking(infant),breathing(infant),f.takeIf { urgent },seizure(infant),poisoning,drowning,head(infant),burns(infant),bleeding,allergy,f.takeIf { !urgent })
    }

    val LINES=listOf(Triple("Emergencies","Call 911","911"),Triple("Poison Control (US)","1-800-222-1222","18002221222"))
}

/** Timers belong to a child, not to the device — twins can each be nursing (`domain/timers.ts`). */
val TIMER_TYPES=setOf(EventType.FEED,EventType.PUMP,EventType.SLEEP,EventType.TUMMYTIME)
