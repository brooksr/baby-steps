package com.babysteps.nurserysensor.care.domain

import com.babysteps.nurserysensor.care.model.Profile
import com.babysteps.nurserysensor.care.model.parseInstant
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * `domain/dates.ts`. Every calendar question is answered in the phone's own zone,
 * the way the web app answers it in the browser's: a day key is the local day.
 */
object Dates {
    val zone: ZoneId get()=ZoneId.systemDefault()
    private const val MINUTE=60_000L
    private const val DAY=24*60*MINUTE

    fun now(): Instant=Instant.now()

    /** `YYYY-MM-DD` for a local day; a bare date string is already one. */
    fun key(instant: Instant): String=instant.atZone(zone).toLocalDate().toString()
    fun key(value: String): String = if(Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(value)) value else parseInstant(value)?.let(::key) ?: value.take(10)
    fun date(key: String): LocalDate=LocalDate.parse(key)
    /** Local noon on a day key — a date key never slips a day when it is parsed. */
    fun noon(key: String): Instant=date(key).atTime(12,0).atZone(zone).toInstant()
    fun midnight(key: String): Instant=date(key).atStartOfDay(zone).toInstant()
    fun addDays(key: String,days: Long): String=date(key).plusDays(days).toString()
    fun today(now: Instant=now())=key(now)

    fun minutesBetween(start: Instant,end: Instant?): Long = if(end==null) 0 else max(0,((end.toEpochMilli()-start.toEpochMilli()).toDouble()/MINUTE).roundToLong())

    /** Floored at a quarter: one 00:30 entry is not a wild daily rate. */
    fun dayFraction(key: String,now: Instant=now()): Double {
        val today=key(now)
        if(key<today) return 1.0
        if(key>today) return 0.0
        val elapsed=(now.toEpochMilli()-midnight(key).toEpochMilli()).toDouble()/DAY
        return min(1.0,max(0.25,elapsed))
    }

    private fun locale()=Locale.getDefault()
    private val clockFormat get()=DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale())
    /** "2:32 PM" (or "14:32" where the phone reads 24-hour). */
    fun clock(instant: Instant): String=clockFormat.format(instant.atZone(zone)).replace(' ',' ')
    fun clock(iso: String)=parseInstant(iso)?.let(::clock) ?: ""

    /** "Oct 12". */
    fun shortDate(instant: Instant): String=DateTimeFormatter.ofPattern("MMM d",locale()).format(instant.atZone(zone))
    fun shortDate(key: String): String=DateTimeFormatter.ofPattern("MMM d",locale()).format(date(key))
    fun fullDate(instant: Instant): String=DateTimeFormatter.ofPattern("MMM d, yyyy",locale()).format(instant.atZone(zone))
    /** "Sat". */
    fun weekday(key: String): String=DateTimeFormatter.ofPattern("EEE",locale()).format(date(key))
    /** "Sat, Oct 12" — a night in the Night & Day report. */
    fun nightLabel(key: String): String=DateTimeFormatter.ofPattern("EEE, MMM d",locale()).format(date(key))

    /** An average time of day from minutes after midnight, on no particular date. */
    fun minutesOfDay(minutes: Double): String {
        val total=((minutes.roundToInt()%1440)+1440)%1440
        return clockFormat.format(LocalTime.of(total/60,total%60)).replace(' ',' ')
    }

    fun roundTo(instant: Instant,stepMinutes: Int=15): Instant {
        val step=stepMinutes*MINUTE
        return Instant.ofEpochMilli(Math.round(instant.toEpochMilli().toDouble()/step)*step)
    }

    /** "6:30–7:30 AM", or "6–7 AM" on the hour: an estimate, so rounded to the quarter hour. */
    fun clockRange(start: Instant,end: Instant,stepMinutes: Int=15): String {
        val s=roundTo(start,stepMinutes).atZone(zone); val e=roundTo(end,stepMinutes).atZone(zone)
        if(!s.isBefore(e)) return clock(s.toInstant())
        val onHour=s.minute==0 && e.minute==0
        val twelve=clock(Instant.parse("2000-01-01T15:00:00Z")).contains(Regex("[AaPp]\\.?\\s?[Mm]"))
        if(!twelve) return "${clock(s.toInstant())}–${clock(e.toInstant())}"
        fun part(t: java.time.ZonedDateTime)=(if(t.hour%12==0) 12 else t.hour%12).toString()+if(onHour) "" else ":%02d".format(t.minute)
        fun period(t: java.time.ZonedDateTime)=if(t.hour<12) "AM" else "PM"
        return if(period(s)==period(e)) "${part(s)}–${part(e)} ${period(e)}" else "${part(s)} ${period(s)}–${part(e)} ${period(e)}"
    }

    fun duration(minutes: Long): String {
        if(minutes<60) return "${minutes}m"
        val h=minutes/60; val r=minutes%60
        return if(r==0L) "${h}h" else "${h}h ${r}m"
    }
    fun duration(minutes: Double)=duration(minutes.roundToLong())

    fun ago(instant: Instant,now: Instant=now()): String {
        val minutes=max(0,((now.toEpochMilli()-instant.toEpochMilli()).toDouble()/MINUTE).roundToLong())
        return if(minutes<1) "just now" else "${duration(minutes)} ago"
    }

    /** Calendar days between, for the things counted in days rather than hours. */
    fun daysAgo(instant: Instant,now: Instant=now())=ChronoUnit.DAYS.between(date(key(instant)),date(key(now)))
    fun daysAgoText(instant: Instant,now: Instant=now())=daysAgo(instant,now).let { if(it<=0) "Today" else if(it==1L) "Yesterday" else "$it days ago" }
    /** The bath card's headline: "Today", "1 day", "5 days". */
    fun daysSince(instant: Instant,now: Instant=now())=daysAgo(instant,now).let { if(it<=0) "Today" else if(it==1L) "1 day" else "$it days" }

    private fun birthNoon(profile: Profile)=profile.birthDate?.let { noon(key(it)) }

    fun ageDays(profile: Profile,now: Instant=now()): Int {
        val birth=birthNoon(profile) ?: return 0
        return max(0,floor((now.toEpochMilli()-birth.toEpochMilli()).toDouble()/DAY).toInt())
    }

    fun dueStatus(profile: Profile,now: Instant=now()): String {
        if(profile.birthDate!=null) {
            val days=ageDays(profile,now)
            return if(days==0) "Born today" else if(days==1) "1 day old" else "$days days old"
        }
        val due=profile.dueDate ?: return ""
        val diff=Math.ceil((noon(key(due)).toEpochMilli()-now.toEpochMilli()).toDouble()/DAY).toInt()
        return when {
            diff>1 -> "Due in $diff days"
            diff==1 -> "Due tomorrow"
            diff==0 -> "Due today"
            else -> abs(diff).let { if(it==1) "1 day old" else "$it days old" }
        }
    }

    fun daysUntilDue(profile: Profile,now: Instant=now()): Int {
        if(profile.birthDate!=null) return 0
        val due=profile.dueDate ?: return 0
        return max(0,Math.ceil((noon(key(due)).toEpochMilli()-now.toEpochMilli()).toDouble()/DAY).toInt())
    }

    private fun ageMonths(birthDate: String,now: Instant): Int {
        val birth=date(key(birthDate)); val today=now.atZone(zone).toLocalDate()
        val months=(today.year-birth.year)*12+(today.monthValue-birth.monthValue)
        return max(0,if(today.dayOfMonth<birth.dayOfMonth) months-1 else months)
    }

    /** Days for a fortnight, weeks through the second month, then months and years. */
    fun ageSummary(profile: Profile,now: Instant=now()): String {
        val birthDate=profile.birthDate ?: return ""
        val days=ageDays(profile,now)
        if(days==0) return "Newborn"
        if(days<14) return if(days==1) "1 day" else "$days days"
        val weeks=days/7
        if(weeks<8) return "$weeks weeks"
        val months=max(2,ageMonths(birthDate,now))
        if(months<24) return "$months months"
        val years=months/12; val rest=months%12
        return if(rest==0) "$years years" else "${years}y ${rest}m"
    }

    fun parseLocalDateTime(text: String): Instant? = runCatching { LocalDateTime.parse(text).atZone(zone).toInstant() }.getOrNull()
    fun elapsedSeconds(start: Instant,now: Instant=now())=max(0,Duration.between(start,now).seconds)
    fun elapsed(seconds: Long): String {
        val h=seconds/3600; val m=(seconds%3600)/60; val s=seconds%60
        return if(h>0) "%d:%02d:%02d".format(h,m,s) else "%d:%02d".format(m,s)
    }
}

/** `domain/units.ts`. Stored values are always oz, in, °C; the profile picks how they read. */
object Units {
    const val CM_PER_IN=2.54
    const val KG_PER_OZ=0.028349523125
    const val ML_PER_OZ=29.5735295625

    fun number(value: Double,digits: Int): String {
        val f=java.text.NumberFormat.getNumberInstance(Locale.getDefault()); f.maximumFractionDigits=digits; f.minimumFractionDigits=0
        return f.format(value)
    }
    fun length(inches: Double,metric: Boolean)=if(metric) "${number(inches*CM_PER_IN,1)} cm" else "${number(inches,1)} in"
    fun volume(oz: Double,metric: Boolean)=if(metric) "${number(oz*ML_PER_OZ,0)} mL" else "${number(oz,2)} oz"
    fun weight(oz: Double,metric: Boolean,ouncesOnly: Boolean): String {
        if(metric) return "${number(oz*KG_PER_OZ,2)} kg"
        if(ouncesOnly) return "${number(oz,1)} oz"
        val rounded=Math.round(oz*10)/10.0
        val pounds=floor(rounded/16).toInt(); val rest=rounded-pounds*16
        if(pounds==0) return "${number(rest,1)} oz"
        return if(rest==0.0) "$pounds lb" else "$pounds lb ${number(rest,1)} oz"
    }
    fun weight(oz: Double,profile: Profile?)=weight(oz,profile?.metric==true,profile?.ouncesOnly==true)
    fun toVolume(oz: Double,metric: Boolean)=if(metric) oz*ML_PER_OZ else oz
    fun fromVolume(value: Double,metric: Boolean)=if(metric) value/ML_PER_OZ else value
    fun toLength(inches: Double,metric: Boolean)=if(metric) inches*CM_PER_IN else inches
    fun fromLength(value: Double,metric: Boolean)=if(metric) value/CM_PER_IN else value
    fun toWeight(oz: Double,metric: Boolean)=if(metric) oz*KG_PER_OZ else oz
    fun fromWeight(value: Double,metric: Boolean)=if(metric) value/KG_PER_OZ else value

    fun celsiusToF(c: Double)=c*9/5+32
    /** A Celsius reading in the profile's unit, with its band: "100.9°F · Fever". */
    fun temperature(celsius: Double,metric: Boolean): String {
        val band=Reference.classifyTemperature(celsius)
        val reading=if(metric) "%.1f°C".format(celsius) else "%.1f°F".format(celsiusToF(celsius))
        return reading+(band?.let { " · ${it.band}" } ?: "")
    }

    /** One decimal throughout, as the web's `formatStat` does. */
    fun stat(value: Double,suffix: String="")=number(Math.round(value*10)/10.0,1)+suffix
    fun barValue(value: Double)=if(value>=10) Math.round(value).toString() else number(Math.round(value*10)/10.0,1)
}
