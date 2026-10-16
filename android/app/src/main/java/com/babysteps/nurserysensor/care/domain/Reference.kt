package com.babysteps.nurserysensor.care.domain

import android.content.Context
import java.io.File

/**
 * Canonical monorepo `src/data/reference` CSVs, packaged by Gradle under
 * `assets/reference` and read the way `domain/reference.ts` reads them.
 * Edit the shared source tables; no Android copies are checked in.
 */
object Reference {
    private var reader: (String) -> String = { error("Reference data is not loaded") }
    private val cache=HashMap<String,List<Map<String,String>>>()

    fun init(context: Context) { val assets=context.applicationContext.assets; use { name -> assets.open("reference/$name").bufferedReader().use { it.readText() } } }
    /** Tests read the same files from the source tree. */
    fun initFromDirectory(dir: File) = use { name -> File(dir,name).readText() }
    private fun use(next: (String) -> String) { synchronized(cache) { reader=next; cache.clear() } }

    fun text(file: String)=reader(file)

    fun records(file: String): List<Map<String,String>> = synchronized(cache) {
        cache.getOrPut(file) { Csv.records(reader(file)) }
    }

    data class Sheet(val id: String,val title: String,val description: String,val category: String,val filename: String)

    /** `data/referenceSheets.ts`, in its order — the Learn page lists them like this. */
    val SHEETS=listOf(
        Sheet("length-for-age-boys","Length-for-age (boys)","WHO Child Growth Standards (2006), boys — length in cm.","growth","length-for-age-boys.csv"),
        Sheet("weight-for-age-boys","Weight-for-age (boys)","WHO Child Growth Standards (2006), boys — weight in kg.","growth","weight-for-age-boys.csv"),
        Sheet("head-for-age-boys","Head circumference-for-age (boys)","WHO Child Growth Standards (2006), boys — head circumference in cm.","growth","head-circumference-for-age-boys.csv"),
        Sheet("length-for-age-girls","Length-for-age (girls)","WHO Child Growth Standards (2006), girls — length in cm.","growth","length-for-age-girls.csv"),
        Sheet("weight-for-age-girls","Weight-for-age (girls)","WHO Child Growth Standards (2006), girls — weight in kg.","growth","weight-for-age-girls.csv"),
        Sheet("head-for-age-girls","Head circumference-for-age (girls)","WHO Child Growth Standards (2006), girls — head circumference in cm.","growth","head-circumference-for-age-girls.csv"),
        Sheet("newborn-expectations","Newborn daily expectations","Typical minimum diapers and feeds per day of life in the first weeks.","newborn","newborn-daily-expectations.csv"),
        Sheet("fetal-development","Fetal development by week","Week-by-week fetal development, weeks 4–41 — the Home card before the birth.","expect","fetal-development-by-week.csv"),
        Sheet("what-to-expect","What to expect by age","Day, week and month expectations from birth to age two. {name}, {their} and {them} are filled in from the profile.","expect","what-to-expect-by-age.csv"),
        Sheet("what-to-expect-notes","What to expect — personal notes","The extra notes added for a preterm birth or a baby’s recorded sex.","expect","what-to-expect-notes.csv"),
        Sheet("milestones","Developmental milestones","CDC-style developmental milestones by age — the Care tab checklist.","feature","developmental-milestones.csv"),
        Sheet("temperature","Temperature ranges","Infant body-temperature bands and guidance — the bands behind the fever flag.","feature","temperature-ranges.csv"),
        Sheet("tummy-time","Tummy time by age","Recommended daily tummy-time minutes by age.","feature","tummy-time-by-age.csv"),
        Sheet("vaccinations","Vaccination schedule","CDC-style childhood immunization schedule — the Care tab due/overdue dates.","feature","vaccination-schedule.csv"),
        Sheet("mood","Mood scale","Simple mood / fussiness scale — the 1–5 levels used when logging mood.","feature","mood-scale.csv"),
        Sheet("stool-colors","Stool colors","Stool colors offered when logging a diaper, and which ones are worth a call.","feature","stool-colors.csv"),
        Sheet("food-triggers","Food & drink groups","Food and drink groups offered as tags when a parent logs an input — the structured half of what is otherwise free text.","feature","food-triggers.csv"),
        Sheet("bristol","Bristol stool scale","The Bristol stool scale, types 1–7 — the consistency recorded on a parent’s output entry.","feature","bristol-stool-scale.csv"),
        Sheet("shopping-catalog","Shopping catalogue","The household’s starting shopping catalogue — seeded into the Shopping tab once, then owned by the sheet.","feature","shopping-catalog.csv"),
    )

    private fun slug(value: String)=value.lowercase().replace(Regex("[^a-z0-9]+"),"-").trim('-')
    private fun num(value: String?)=value?.trim()?.takeIf { it.isNotEmpty() }?.toDoubleOrNull()

    data class Milestone(val id: String,val ageMonths: Int,val domain: String,val milestone: String)
    val milestones: List<Milestone> get()=records("developmental-milestones.csv").mapIndexed { i,row ->
        Milestone("m-$i-${row["age_months"]}-${slug(row["domain"].orEmpty())}",row["age_months"]?.toIntOrNull() ?: 0,row["domain"].orEmpty(),row["milestone"].orEmpty())
    }
    fun milestone(id: String)=milestones.find { it.id==id }

    data class TemperatureBand(val band: String,val celsiusMin: Double?,val celsiusMax: Double?,val guidance: String)
    val temperatureBands get()=records("temperature-ranges.csv").map { TemperatureBand(it["band"].orEmpty(),num(it["celsius_min"]),num(it["celsius_max"]),it["guidance"].orEmpty()) }
    fun classifyTemperature(celsius: Double)=temperatureBands.find { (it.celsiusMin==null || celsius>=it.celsiusMin) && (it.celsiusMax==null || celsius<=it.celsiusMax) }

    data class Vaccination(val id: String,val age: String,val ageMonths: Int,val vaccines: String,val note: String)
    private fun ageMonths(age: String)=if(Regex("birth",RegexOption.IGNORE_CASE).containsMatchIn(age)) 0 else Regex("\\d+").find(age)?.value?.toInt() ?: 0
    val vaccinations: List<Vaccination> get()=records("vaccination-schedule.csv").flatMap { row ->
        row["vaccines"].orEmpty().split(',').map { v -> val vaccines=v.trim()
            Vaccination("vax-${slug(row["age"].orEmpty())}-${slug(vaccines)}",row["age"].orEmpty(),ageMonths(row["age"].orEmpty()),vaccines,row["note"].orEmpty()) }
    }
    fun vaccination(id: String)=vaccinations.find { it.id==id } ?: records("vaccination-schedule.csv").find { "vax-${slug(it["age"].orEmpty())}"==id }?.let {
        // An entry written before vaccines became individually actionable used one id for the whole row.
        Vaccination(id,it["age"].orEmpty(),ageMonths(it["age"].orEmpty()),it["vaccines"].orEmpty(),it["note"].orEmpty())
    }

    data class MoodLevel(val level: Int,val label: String,val description: String)
    val moodScale get()=records("mood-scale.csv").map { MoodLevel(it["level"]?.toIntOrNull() ?: 0,it["label"].orEmpty(),it["description"].orEmpty()) }

    data class StoolColor(val id: String,val label: String,val flagFromDay: Int?,val guidance: String) {
        /** Informational only — it repeats the reference row, it does not diagnose. */
        fun flagged(ageDays: Int)=flagFromDay!=null && ageDays>=flagFromDay
    }
    val stoolColors get()=records("stool-colors.csv").map { StoolColor(it["id"].orEmpty(),it["label"].orEmpty(),num(it["flag_from_day"])?.toInt(),it["guidance"].orEmpty()) }
    fun stoolColor(id: String?)=id?.let { key -> stoolColors.find { it.id==key } }

    data class FoodTrigger(val id: String,val label: String,val group: String,val examples: String,val watchFor: String)
    val foodTriggers get()=records("food-triggers.csv").map { FoodTrigger(it["id"].orEmpty(),it["label"].orEmpty(),it["group"].orEmpty(),it["examples"].orEmpty(),it["watch_for"].orEmpty()) }
    fun foodTrigger(id: String)=foodTriggers.find { it.id==id }

    data class Bristol(val type: Int,val label: String,val description: String,val reading: String)
    val bristolScale get()=records("bristol-stool-scale.csv").map { Bristol(it["type"]?.toIntOrNull() ?: 0,it["label"].orEmpty(),it["description"].orEmpty(),it["reading"].orEmpty()) }
    fun bristol(type: Int?)=type?.let { t -> bristolScale.find { it.type==t } }

    data class TummyTime(val ageRange: String,val minMinutes: Int,val maxMinutes: Int,val note: String)
    val tummyTime get()=records("tummy-time-by-age.csv").map { TummyTime(it["age_range"].orEmpty(),it["daily_min_minutes"]?.toIntOrNull() ?: 0,it["daily_max_minutes"]?.toIntOrNull() ?: 0,it["note"].orEmpty()) }

    private fun bullets(cell: String?)=cell.orEmpty().split('|').map { it.trim() }.filter { it.isNotEmpty() }

    data class FetalWeek(val week: Int,val trimester: String,val size: String,val development: String,val headsUp: String,val facts: List<String>)
    val fetalWeeks get()=records("fetal-development-by-week.csv").map {
        FetalWeek(it["week"]?.toIntOrNull() ?: 0,it["trimester"].orEmpty(),it["size"].orEmpty(),it["development"].orEmpty(),it["heads_up"].orEmpty(),bullets(it["facts"]))
    }.sortedBy { it.week }

    data class AgeStage(val fromDays: Int,val toDays: Int,val label: String,val summary: String,val development: String,val feeding: String,val sleep: String,val headsUp: String,val facts: List<String>)
    val ageStages get()=records("what-to-expect-by-age.csv").map {
        AgeStage(it["from_days"]?.toIntOrNull() ?: 0,it["to_days"]?.toIntOrNull() ?: 0,it["label"].orEmpty(),it["summary"].orEmpty(),it["development"].orEmpty(),
            it["feeding"].orEmpty(),it["sleep"].orEmpty(),it["heads_up"].orEmpty(),bullets(it["facts"]))
    }.sortedBy { it.fromDays }

    data class ExpectationNote(val audience: String,val fromDays: Int,val toDays: Int,val note: String)
    val expectationNotes get()=records("what-to-expect-notes.csv").map { ExpectationNote(it["audience"].orEmpty(),it["from_days"]?.toIntOrNull() ?: 0,it["to_days"]?.toIntOrNull() ?: 0,it["note"].orEmpty()) }

    data class CatalogItem(val name: String,val category: String,val food: Boolean)
    val shoppingCatalog get()=records("shopping-catalog.csv").map { CatalogItem(it["name"].orEmpty(),it["category"].orEmpty(),it["food"]=="yes") }
}

/** `domain/csv.ts`: one row per line, double-quoted cells may hold commas. */
object Csv {
    fun parse(text: String): Pair<List<String>,List<List<String>>> {
        val lines=text.replace("\r\n","\n").trim().split('\n')
        if(lines.isEmpty()) return emptyList<String>() to emptyList()
        return parseLine(lines.first()) to lines.drop(1).filter { it.isNotBlank() }.map(::parseLine)
    }

    fun records(text: String): List<Map<String,String>> {
        val (headers,rows)=parse(text)
        return rows.map { row -> headers.mapIndexed { i,h -> h to (row.getOrNull(i) ?: "") }.toMap() }
    }

    private fun parseLine(line: String): List<String> {
        val cells=ArrayList<String>(); val current=StringBuilder(); var quoted=false; var i=0
        while(i<line.length) {
            val c=line[i]
            if(quoted) {
                if(c=='"') { if(line.getOrNull(i+1)=='"') { current.append('"'); i++ } else quoted=false } else current.append(c)
            } else when(c) { '"' -> quoted=true; ',' -> { cells.add(current.toString()); current.clear() }; else -> current.append(c) }
            i++
        }
        cells.add(current.toString())
        return cells.map { it.trim() }
    }
}
