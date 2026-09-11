import { useMemo, useState } from 'react';
import { cyclePhaseLabels, getCycleToday, type PeriodRecord } from '../domain/cycle';
import { filterEventsByRange, getPresetRange, type DateRange } from '../domain/dateRange';
import { formatDuration, formatShortDate } from '../domain/dates';
import { getFirstName, tracksCycle } from '../domain/family';
import { getParentReport } from '../domain/parentReport';
import { mensesFlowLabels, type BabyProfile, type CareEvent } from '../domain/types';
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
}

type ParentPeriod = '7d' | '30d' | '90d' | 'custom';

const PARENT_PERIODS: Array<{ id: ParentPeriod; label: string }> = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'custom', label: 'Custom' }
];

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
export function ParentReports({ childEvents, events, profile }: ParentReportsProps) {
  const [period, setPeriod] = useState<ParentPeriod>('30d');
  const [customRange, setCustomRange] = useState<DateRange>(() => getPresetRange('30d'));
  const firstName = getFirstName(profile);
  const showsCycle = tracksCycle(profile);

  // Memoized so the filters below have a stable dependency — `getPresetRange`
  // builds a fresh object on every render.
  const range = useMemo(() => (period === 'custom' ? customRange : getPresetRange(period)), [customRange, period]);
  const periodEvents = useMemo(() => filterEventsByRange(events, range), [events, range]);
  const periodChildEvents = useMemo(() => filterEventsByRange(childEvents, range), [childEvents, range]);
  const report = useMemo(
    () => getParentReport(periodEvents, periodChildEvents, profile.id),
    [periodEvents, periodChildEvents, profile.id]
  );
  // The cycle reads the whole log, not the selected span — a 7-day window holds
  // no cycles at all, and the prediction would vanish whenever someone narrowed
  // the period.
  const cycle = showsCycle ? getCycleToday(events) : null;

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

      <section className="metric-grid status-grid" aria-label="Sleep summary">
        <article className="metric-card">
          <span>Longest stretch</span>
          <strong>{report.averageLongestStretchMinutes != null ? formatDuration(report.averageLongestStretchMinutes) : '—'}</strong>
          <small>average per night</small>
        </article>
        <article className="metric-card">
          <span>Shortest night</span>
          <strong>{report.shortestSleepMinutes != null ? formatDuration(report.shortestSleepMinutes) : '—'}</strong>
          <small>{report.longestSleepMinutes != null ? `longest ${formatDuration(report.longestSleepMinutes)}` : 'Nothing logged yet'}</small>
        </article>
        <article className="metric-card">
          <span>Nights logged</span>
          <strong>{report.nights.length}</strong>
          <small>{report.nights.length === 0 ? 'Log a sleep to start' : formatRangeCaption(report.nights[0].dateKey, report.nights[report.nights.length - 1].dateKey)}</small>
        </article>
      </section>

      {/* Nobody signs an entry, so this is the household's load, not one
          person's share of it — and it is labelled that way. */}
      <section className="section-block">
        <div className="section-heading">
          <h2>Baby care this period</h2>
          <span>{report.care.total} entr{report.care.total === 1 ? 'y' : 'ies'}</span>
        </div>
        <div className="metric-grid">
          <article className="metric-card">
            <span>Night duty</span>
            <strong>{report.care.nightEvents}</strong>
            <small>10pm–6am</small>
          </article>
          <article className="metric-card">
            <span>Feeds</span>
            <strong>{report.care.feeds}</strong>
            <small>{report.care.nursingFeeds} nursing</small>
          </article>
          <article className="metric-card">
            <span>Diapers</span>
            <strong>{report.care.diapers}</strong>
            <small>{report.care.pumps} pump{report.care.pumps === 1 ? '' : 's'}</small>
          </article>
        </div>
        <p className="field-note">
          Logged for the babies across this period by whoever was on. Entries are not signed, so this is the household's
          load rather than one person's share — the wake-ups above are the ones that landed inside {firstName}'s own
          logged sleep.
        </p>
      </section>

      {showsCycle && (
        <section className="section-block">
          <div className="section-heading">
            <h2>Cycle</h2>
            <span>{cycle ? cyclePhaseLabels[cycle.phase] : 'Nothing logged yet'}</span>
          </div>

          {cycle ? (
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
          ) : (
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
