import { useMemo, useState } from 'react';
import { cyclePhaseLabels, describeCycleStatus, getCycleContext, getCycleToday, type PeriodRecord } from '../domain/cycle';
import { filterEventsByRange, getPresetRange, type DateRange } from '../domain/dateRange';
import { formatDuration, formatShortDate } from '../domain/dates';
import { getFirstName, tracksCycle } from '../domain/family';
import { DEFAULT_LINK_WINDOW_HOURS, OUTPUT_KINDS, getIntakeOutputSummary, getTopIntakeTags } from '../domain/intakeOutput';
import { DEFAULT_REST_OPTIONS, getParentReport } from '../domain/parentReport';
import { getFoodTriggerById } from '../domain/reference';
import { mensesFlowLabels, outputKindLabels, type BabyProfile, type CareEvent } from '../domain/types';
import { formatVolume, getPreferredUnits } from '../domain/units';
import { formatDayLabel, type ChartPoint } from './chartFormat';
import { DateRangeFilter } from './DateRangeFilter';
import { MiniChart } from './MiniChart';
import { Timeline } from './Timeline';

interface ParentReportsProps {
  /** The parent's own entries. */
  events: CareEvent[];
  /** Every child's entries, for the care load behind the nights. */
  childEvents: CareEvent[];
  profile: BabyProfile;
  /** Everyone tracked — the babies' dates are what pause and restart a cycle. */
  profiles?: BabyProfile[];
}

type ParentPeriod = '7d' | '30d' | '90d' | 'custom';

const PARENT_PERIODS: Array<{ id: ParentPeriod; label: string }> = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'custom', label: 'Custom' }
];

/** How long it takes to settle back down — the part nobody logs. */
const SETTLE_OPTIONS = [0, 10, 15, 30];

/** Minutes to hours, since a night's sleep is read in hours, not in 420. */
function toHours(minutes: number) {
  return Math.round((minutes / 60) * 10) / 10;
}

function periodSummary(record: PeriodRecord) {
  const heaviest = record.flows.reduce((worst, flow) => {
    const rank = { heavy: 3, light: 1, medium: 2, spotting: 0 };
    return rank[flow] > rank[worst] ? flow : worst;
  }, record.flows[0]);

  return `${record.days} day${record.days === 1 ? '' : 's'} · ${mensesFlowLabels[heaviest].toLowerCase()} at its heaviest`;
}

/**
 * The report for whoever in the household is being tracked as a parent: their
 * own nights and cycle, plus the care the babies needed across the same span.
 */
export function ParentReports({ childEvents, events, profile, profiles = [] }: ParentReportsProps) {
  const [period, setPeriod] = useState<ParentPeriod>('30d');
  // How long it takes to settle back after a wake-up. Never logged, so it is a
  // dial rather than a measurement — and it moves every number below it.
  const [fallbackAsleepMinutes, setFallbackAsleepMinutes] = useState(DEFAULT_REST_OPTIONS.fallbackAsleepMinutes);
  const [customRange, setCustomRange] = useState<DateRange>(() => getPresetRange('30d'));
  const firstName = getFirstName(profile);
  const preferredUnits = getPreferredUnits(profile);
  const showsCycle = tracksCycle(profile);

  // Memoized so the filters below have a stable dependency — `getPresetRange`
  // builds a fresh object on every render.
  const range = useMemo(() => (period === 'custom' ? customRange : getPresetRange(period)), [customRange, period]);
  const periodEvents = useMemo(() => filterEventsByRange(events, range), [events, range]);
  const periodChildEvents = useMemo(() => filterEventsByRange(childEvents, range), [childEvents, range]);
  const report = useMemo(
    () => getParentReport(periodEvents, periodChildEvents, profile.id, { fallbackAsleepMinutes }),
    [fallbackAsleepMinutes, periodEvents, periodChildEvents, profile.id]
  );
  // The cycle reads the whole log, not the selected span — a 7-day window holds
  // no cycles at all, and the prediction would vanish whenever someone narrowed
  // the period.
  const cycle = showsCycle ? getCycleToday(events, new Date(), getCycleContext(profiles)) : null;
  const cycleTile = cycle ? describeCycleStatus(cycle) : null;
  const io = useMemo(() => getIntakeOutputSummary(periodEvents), [periodEvents]);
  const topTags = useMemo(() => getTopIntakeTags(periodEvents), [periodEvents]);

  const sleepValues: ChartPoint[] = report.nights.map((night) => ({
    label: night.dateKey,
    value: toHours(night.sleepMinutes)
  }));
  const wakeValues: ChartPoint[] = report.nights.map((night) => ({
    label: night.dateKey,
    value: night.interruptions
  }));
  const sleepHours = report.nights.map((night) => toHours(night.sleepMinutes));
  const sleepStats = {
    average: report.averageSleepMinutes != null ? toHours(report.averageSleepMinutes) : 0,
    max: sleepHours.length > 0 ? Math.max(...sleepHours) : 0,
    min: sleepHours.length > 0 ? Math.min(...sleepHours) : 0
  };
  const wakeCounts = report.nights.map((night) => night.interruptions);
  const wakeStats = {
    average: report.averageInterruptions ?? 0,
    max: wakeCounts.length > 0 ? Math.max(...wakeCounts) : 0,
    min: wakeCounts.length > 0 ? Math.min(...wakeCounts) : 0
  };

  // Newest first: the last few periods are the ones anyone looks at.
  const recentPeriods = cycle ? [...cycle.stats.periods].reverse().slice(0, 6) : [];

  return (
    <main className="view-stack">
      <section className="section-block">
        <div className="section-heading wrap">
          <div>
            <h1>{firstName}</h1>
            <span>{periodEvents.length} entr{periodEvents.length === 1 ? 'y' : 'ies'} in this period</span>
          </div>
          <div className="segmented-control period-control" aria-label="Report period">
            {PARENT_PERIODS.map((option) => (
              <button
                type="button"
                key={option.id}
                aria-pressed={period === option.id}
                className={period === option.id ? 'active' : ''}
                onClick={() => setPeriod(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {period === 'custom' && (
          <DateRangeFilter
            label="Report date range"
            range={customRange}
            summary={`${periodEvents.length} entr${periodEvents.length === 1 ? 'y' : 'ies'}`}
            onChange={setCustomRange}
          />
        )}
      </section>

      <section className="chart-grid" aria-label="Sleep trends">
        <MiniChart
          event="sleep"
          label="Sleep/night"
          stats={sleepStats}
          suffix="h"
          total={toHours(report.totalSleepMinutes)}
          values={sleepValues}
        />
        <MiniChart event="note" label="Wake-ups/night" stats={wakeStats} total={wakeCounts.reduce((a, b) => a + b, 0)} values={wakeValues} />
      </section>

      <section className="section-block">
        <div className="section-heading wrap">
          <h2>Rest</h2>
          <div className="segmented-control settle-control" aria-label="Time to fall back asleep">
            {SETTLE_OPTIONS.map((minutes) => (
              <button
                type="button"
                key={minutes}
                aria-pressed={fallbackAsleepMinutes === minutes}
                className={fallbackAsleepMinutes === minutes ? 'active' : ''}
                onClick={() => setFallbackAsleepMinutes(minutes)}
              >
                {minutes}m
              </button>
            ))}
          </div>
        </div>

        <div className="metric-grid">
          <article className="metric-card">
            <span>In bed</span>
            <strong>{report.averageInBedMinutes != null ? formatDuration(report.averageInBedMinutes) : '—'}</strong>
            <small>
              {report.averageSleepMinutes != null && report.averageInBedMinutes != null
                ? `${formatDuration(report.averageInBedMinutes - report.averageSleepMinutes)} of it awake`
                : 'Nothing logged yet'}
            </small>
          </article>
          <article className="metric-card">
            <span>Longest stretch</span>
            <strong>{report.averageLongestStretchMinutes != null ? formatDuration(report.averageLongestStretchMinutes) : '—'}</strong>
            <small>
              avg unbroken run
              {report.bestStretchMinutes != null ? ` · best ${formatDuration(report.bestStretchMinutes)}` : ''}
            </small>
          </article>
          <article className="metric-card">
            <span>Nights logged</span>
            <strong>{report.nights.length}</strong>
            <small>{report.nights.length === 0 ? 'Log a sleep to start' : formatRangeCaption(report.nights[0].dateKey, report.nights[report.nights.length - 1].dateKey)}</small>
          </article>
        </div>

        <p className="field-note">
          Rest is the time in bed less every wake-up and the {fallbackAsleepMinutes} minutes it takes to settle after
          one. Entries within half an hour of each other count as a single wake-up, and a stretch under half an hour
          between them is not counted as sleep at all. A broken night adds up to more than any one run of it, which is
          why the longest stretch sits below the nightly total — and because that figure is a nightly average, a longer
          period can lower it by taking in worse nights. The best single night beside it only ever goes up.
        </p>
      </section>

      {/* Two numbers per card: what this parent is recorded as having done, over
          what the household logged. An entry only names a caregiver when someone
          recorded one, so the share is never the whole story. */}
      <section className="section-block">
        <div className="section-heading">
          <h2>Baby care this period</h2>
          <span>
            {report.care.mine.total} of {report.care.total} entr{report.care.total === 1 ? 'y' : 'ies'}
          </span>
        </div>
        <div className="metric-grid">
          <article className="metric-card">
            <span>Night duty</span>
            <strong>{report.care.mine.nightEvents}</strong>
            <small>of {report.care.nightEvents} · 10pm–6am</small>
          </article>
          <article className="metric-card">
            <span>Feeds</span>
            <strong>{report.care.mine.feeds}</strong>
            <small>of {report.care.feeds} · {report.care.mine.nursingFeeds} nursing</small>
          </article>
          <article className="metric-card">
            <span>Diapers</span>
            <strong>{report.care.mine.diapers}</strong>
            <small>of {report.care.diapers} · {report.care.mine.pumps} of {report.care.pumps} pumps</small>
          </article>
        </div>
        <p className="field-note">
          The big number is what {firstName} is recorded as having done; the smaller one is everything the household
          logged.{' '}
          {report.care.unattributed > 0
            ? `${report.care.unattributed} of those name nobody — "Logged by" is optional, so a low share can mean a quiet week or an unfilled field.`
            : 'Every entry this period names who did it.'}{' '}
          The wake-ups above are a different question: those are the ones that broke into {firstName}'s own logged
          sleep.
        </p>
      </section>

      {/* What is here is a count of what has been logged, not a claim about what
          caused what. Finding the pattern between the two is a separate pass and
          a much harder question; this section is about whether the rows being
          written could answer it. */}
      {(io.intakes > 0 || io.outputs > 0) && (
        <section className="section-block">
          <div className="section-heading">
            <h2>Inputs &amp; outputs</h2>
            <span>
              over {io.daysLogged} day{io.daysLogged === 1 ? '' : 's'}
            </span>
          </div>

          <div className="metric-grid">
            <article className="metric-card" data-event="intake">
              <span>Inputs</span>
              <strong>{io.intakes}</strong>
              <small>
                {io.foods} food · {io.drinks} drink
                {io.fluidOz > 0 ? ` · ${formatVolume(io.fluidOz, preferredUnits.system)}` : ''}
              </small>
            </article>
            <article className="metric-card" data-event="output">
              <span>Outputs</span>
              <strong>{io.outputs}</strong>
              <small>
                {OUTPUT_KINDS.filter((kind) => io.byOutputKind[kind] > 0)
                  .map((kind) => `${io.byOutputKind[kind]} ${outputKindLabels[kind].toLowerCase()}`)
                  .join(' · ') || 'Nothing logged yet'}
              </small>
            </article>
            <article className="metric-card">
              <span>Ready to compare</span>
              <strong>{io.outputs > 0 ? `${Math.round((io.linkedOutputs / io.outputs) * 100)}%` : '—'}</strong>
              <small>
                of outputs have an input in the {DEFAULT_LINK_WINDOW_HOURS}h before
              </small>
            </article>
          </div>

          {topTags.length > 0 && (
            <ul className="cycle-list">
              {topTags.map((entry) => (
                <li key={entry.tag}>
                  <div>
                    <strong>{getFoodTriggerById(entry.tag)?.label ?? entry.tag}</strong>
                    <small>{getFoodTriggerById(entry.tag)?.group ?? 'Tag'}</small>
                  </div>
                  <span className="cycle-length">
                    {entry.count} input{entry.count === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="field-note">
            {io.taggedIntakes} of {io.intakes} input{io.intakes === 1 ? ' carries' : 's carry'} a food group and{' '}
            {io.ratedOutputs} of {io.outputs} output{io.outputs === 1 ? '' : 's'} a severity. Those two fields are what
            a pattern could later be read from — a free-text meal is a sentence nothing can group, and an unrated
            output has no size to compare. Nothing here says one caused the other; it is a count of what was logged,
            over a span short enough that coincidence is the likeliest explanation for anything that looks like a
            pattern. A symptom that keeps coming back is a question for a doctor, not for arithmetic.
          </p>
        </section>
      )}

      {showsCycle && (
        <section className="section-block">
          <div className="section-heading">
            <h2>Cycle</h2>
            <span>
              {cycle?.status === 'cycling' && cycle.phase
                ? cyclePhaseLabels[cycle.phase]
                : cycleTile
                  ? cycleTile.headline
                  : 'Nothing logged yet'}
            </span>
          </div>

          {cycle?.status === 'pregnant' && (
            <p className="empty-state">
              Cycle tracking is paused while a baby is on the way
              {cycle.daysUntilDue != null && cycle.daysUntilDue >= 0 ? `, about ${Math.ceil(cycle.daysUntilDue / 7)} weeks to go` : ''}. It
              picks up from the first period after the birth.
            </p>
          )}

          {cycle?.status === 'postpartum' && (
            <>
              {/* `describeCycleStatus` already phrases the wait in days or
                  weeks, singular or plural — one place to get that right. */}
              <p className="empty-state">
                No period logged yet{cycleTile ? ` — ${cycleTile.detail.toLowerCase()}` : ''}. Log the days when it
                returns and the cycle starts again from there.
              </p>
              {/* Plain, not flagged: waiting for a cycle to come back is
                  ordinary, not a warning. */}
              <p className="field-note">
                Cycles often take months to return, longer while breastfeeding. Ovulation comes first, so it can happen
                before any period.
              </p>
            </>
          )}

          {cycle?.status === 'cycling' ? (
            <>
              <div className="metric-grid">
                <article className="metric-card">
                  <span>Cycle day</span>
                  <strong>{cycle.dayOfCycle}</strong>
                  <small>since {formatDayLabel(cycle.stats.periods[cycle.stats.periods.length - 1].startKey)}</small>
                </article>
                <article className="metric-card">
                  <span>Cycle length</span>
                  <strong>{cycle.stats.averageCycleDays != null ? `${cycle.stats.averageCycleDays}d` : '—'}</strong>
                  <small>
                    {cycle.stats.shortestCycleDays != null && cycle.stats.longestCycleDays != null
                      ? `${cycle.stats.shortestCycleDays}–${cycle.stats.longestCycleDays}d range`
                      : 'Needs two cycles'}
                  </small>
                </article>
                <article className="metric-card">
                  <span>Period length</span>
                  <strong>{cycle.stats.averagePeriodDays != null ? `${cycle.stats.averagePeriodDays}d` : '—'}</strong>
                  <small>average</small>
                </article>
              </div>

              {cycle.prediction ? (
                <div className="cycle-forecast">
                  <article>
                    <span>Next period</span>
                    <strong>{formatDayLabel(cycle.prediction.nextPeriodKey)}</strong>
                    <small>
                      {formatDayLabel(cycle.prediction.windowStartKey)} – {formatDayLabel(cycle.prediction.windowEndKey)}
                    </small>
                  </article>
                  <article>
                    <span>Fertile window</span>
                    <strong>
                      {formatDayLabel(cycle.prediction.fertileStartKey)} – {formatDayLabel(cycle.prediction.fertileEndKey)}
                    </strong>
                    <small>ovulation around {formatDayLabel(cycle.prediction.ovulationKey)}</small>
                  </article>
                  <article>
                    <span>Based on</span>
                    <strong>{cycle.prediction.confidence} confidence</strong>
                    <small>
                      {cycle.prediction.basis}
                      {cycle.stats.droppedCycles > 0
                        ? ` · ${cycle.stats.droppedCycles} gap${cycle.stats.droppedCycles === 1 ? '' : 's'} not counted`
                        : ''}
                    </small>
                  </article>
                </div>
              ) : (
                <p className="empty-state">
                  Two cycles are needed before a date can be estimated. Keep logging the days of each period.
                </p>
              )}

              <ul className="cycle-list">
                {recentPeriods.map((record) => (
                  <li key={record.startKey}>
                    <div>
                      <strong>{formatDayLabel(record.startKey)}</strong>
                      <small>{periodSummary(record)}</small>
                    </div>
                    <span className={record.cycleLengthDays != null && !record.cycleCounted ? 'cycle-length dropped' : 'cycle-length'}>
                      {record.cycleLengthDays != null ? `${record.cycleLengthDays}d cycle` : 'current'}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="field-note flagged">
                Estimates from the dates logged here — not contraception, not a fertility test, and not a pregnancy
                test. Cycles are often irregular after a birth and while breastfeeding, which makes any prediction a
                rough one. Anything that worries you is a question for your doctor or midwife.
              </p>
            </>
          ) : cycle ? null : (
            <p className="empty-state">Log the days of a period and the cycle, the next date, and the fertile window follow from it.</p>
          )}
        </section>
      )}

      <section className="section-block">
        <div className="section-heading">
          <h2>Entries</h2>
          <span>{formatRangeCaption(range.from, range.to)}</span>
        </div>
        <Timeline events={periodEvents} emptyMessage={`Nothing logged for ${firstName} in this period.`} profile={profile} />
      </section>
    </main>
  );
}

function formatRangeCaption(from: string, to: string) {
  if (!from && !to) {
    return 'All time';
  }

  const start = from ? formatShortDate(`${from}T12:00:00`) : 'start';
  const end = to ? formatShortDate(`${to}T12:00:00`) : 'today';
  return start === end ? start : `${start} – ${end}`;
}
