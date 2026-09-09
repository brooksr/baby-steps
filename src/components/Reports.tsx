import { useState } from 'react';
import { formatDuration, formatShortDate, getLocalDateKey, isSameLocalDate, minutesBetween } from '../domain/dates';
import { getCheckupSpan } from '../domain/checkup';
import { filterEventsByRange, formatRangeLabel, getPresetRange, isDateKeyInRange, type DateRange } from '../domain/dateRange';
import { getFeedToDiaperLags } from '../domain/diapers';
import { getDayMetricStats, getFirstYearAnalytics, type FirstYearPoint, type MetricStats } from '../domain/firstYear';
import { getDailySummary } from '../domain/summary';
import type { BabyProfile, CareEvent, CareEventType, FeedEvent, MeasurementSystem } from '../domain/types';
import { formatLength, formatVolume, formatWeight, getPreferredUnits, ouncesToKilograms, toUnitVolume } from '../domain/units';
import { DateRangeFilter } from './DateRangeFilter';
import { FeedClock } from './FeedClock';
import { FeedOrder } from './FeedOrder';
import { GrowthStandards } from './GrowthStandards';
import { NewbornStatus } from './NewbornStatus';
import { Timeline } from './Timeline';

type ReportPeriod = 'day' | 'week' | 'month' | 'year' | 'checkup' | 'custom';

const REPORT_PERIODS: ReportPeriod[] = ['day', 'week', 'month', 'year', 'checkup', 'custom'];

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  checkup: 'Check-Up',
  custom: 'Custom',
  day: 'Day',
  month: 'Month',
  week: 'Week',
  year: 'Year'
};

/** The periods scoped by calendar day rather than by days that logged something. */
function isCalendarPeriod(period: ReportPeriod) {
  return period === 'checkup' || period === 'custom';
}

/** How the insight cards describe what they just measured. */
function periodScopeLabel(period: ReportPeriod) {
  if (period === 'day') {
    return 'today';
  }

  if (period === 'checkup') {
    return 'since last check-up';
  }

  return period === 'custom' ? 'selected range' : `this ${period}`;
}

interface ReportsProps {
  events: CareEvent[];
  profile: BabyProfile;
}

interface ChartPoint {
  label: string;
  value: number;
  /** Optional breakdown of `value`, stacked bottom-up in the bar. */
  parts?: number[];
}

interface MiniChartProps {
  /** Which care event the chart is about — it colors the bars by family. */
  event: CareEventType;
  label: string;
  stats: MetricStats;
  suffix?: string;
  /** Sum across the charted span, shown next to the average. */
  total: number;
  /** Names for the stacked `parts`, in the same order. Drives the legend. */
  partLabels?: string[];
  /** Per-day averages per part, shown in the legend beside the headline average. */
  partAverages?: number[];
  /** Totals per part across the charted span, shown in the legend. */
  partTotals?: number[];
  /** True when bars average several days together, so a bar is not one day's total. */
  sampled?: boolean;
  values: ChartPoint[];
}

function formatParts(point: ChartPoint, partLabels: string[] | undefined) {
  if (!point.parts || !partLabels) {
    return '';
  }

  return ` (${point.parts.map((part, index) => `${formatBarValue(part)} ${partLabels[index]}`).join(' · ')})`;
}

/** Above this many bars there is no room for a number over each one. */
const BAR_LABEL_LIMIT = 7;

function formatStat(value: number, suffix = '') {
  // One decimal throughout: a second one is false precision on a count of
  // diapers, and it made the same number read two ways across the page.
  const rounded = Number(value.toFixed(1));
  return `${rounded.toLocaleString()}${suffix}`;
}

function convertStats(stats: MetricStats, convert: (value: number) => number): MetricStats {
  return {
    average: convert(stats.average),
    max: convert(stats.max),
    min: convert(stats.min)
  };
}

function formatBarValue(value: number) {
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}`;
}

// Date keys are local days; anchor at midday so they never slip a day in parsing.
function formatDayLabel(dateKey: string) {
  return formatShortDate(`${dateKey}T12:00:00`);
}

function MiniChart({ event, label, stats, suffix = '', partAverages, partLabels, partTotals, sampled = false, total, values }: MiniChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const max = Math.max(1, ...values.map((point) => point.value));
  const cols = Math.max(1, values.length);
  const showBarLabels = values.length > 0 && values.length <= BAR_LABEL_LIMIT;
  // Defaults to the most recent bar so a day total is always on screen.
  const activePoint = values.length > 0 ? values[Math.min(activeIndex ?? values.length - 1, values.length - 1)] : null;
  const dayWord = sampled ? 'avg/day from' : '';

  return (
    <article className="chart-card" data-event={event}>
      <div className="chart-heading">
        <h3>{label}</h3>
        <strong>{formatStat(stats.average, suffix)} avg</strong>
        <small>{formatStat(total, suffix)} total</small>
      </div>
      <div
        className="chart-bars"
        aria-label={`${label} chart`}
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(3px, 1fr))` }}
      >
        {values.length === 0 ? (
          <p className="empty-state compact">No data</p>
        ) : (
          values.map((point, index) => {
            const readout = `${dayWord ? `${dayWord} ` : ''}${formatDayLabel(point.label)}: ${formatStat(point.value, suffix)}${formatParts(point, partLabels)}`;
            const barHeight = `${Math.max(8, (point.value / max) * 100)}%`;

            return (
              <button
                type="button"
                className={`chart-column${point === activePoint ? ' active' : ''}`}
                key={`${label}-${point.label}`}
                aria-label={readout}
                title={readout}
                onClick={() => setActiveIndex(index)}
              >
                {showBarLabels && <b className="chart-bar-value">{formatBarValue(point.value)}</b>}
                <span className="chart-bar">
                  {point.parts && point.value > 0 ? (
                    <span className="chart-bar-stack" style={{ height: barHeight }}>
                      {point.parts.map((part, partIndex) => (
                        <i
                          key={partLabels?.[partIndex] ?? partIndex}
                          className={`chart-bar-part-${partIndex}`}
                          style={{ height: `${(part / point.value) * 100}%` }}
                        />
                      ))}
                    </span>
                  ) : (
                    <i style={{ height: barHeight }} />
                  )}
                </span>
                {showBarLabels && <em className="chart-bar-day">{new Date(`${point.label}T12:00:00`).getDate()}</em>}
              </button>
            );
          })
        )}
      </div>
      {activePoint && (
        <p className="chart-readout">
          <span>{dayWord ? `${dayWord} ${formatDayLabel(activePoint.label)}` : formatDayLabel(activePoint.label)}</span>
          <strong>
            {formatStat(activePoint.value, suffix)}
            {formatParts(activePoint, partLabels)}
          </strong>
        </p>
      )}
      {partLabels && partTotals && (
        <div className="chart-legend">
          {partLabels.map((partLabel, index) => (
            <span className={`chart-legend-item chart-bar-part-${index}`} key={partLabel}>
              {partLabel}{' '}
              {partAverages ? `${formatStat(partAverages[index], suffix)} avg · ` : ''}
              {formatStat(partTotals[index], suffix)} total
            </span>
          ))}
        </div>
      )}
      <div className="chart-stats">
        <span>Min {formatStat(stats.min, suffix)}</span>
        <span>Max {formatStat(stats.max, suffix)}</span>
      </div>
    </article>
  );
}

/**
 * Per-day stats over the charted span. A day the selector skips is left out
 * rather than counted as a zero, and today counts as the part of it that has
 * happened — see `getDayMetricStats`.
 */
function periodStat(points: FirstYearPoint[], selector: (point: FirstYearPoint) => number | undefined): MetricStats {
  return getDayMetricStats(
    points
      .map((point) => ({ dateKey: point.dateKey, value: selector(point) }))
      .filter((entry): entry is { dateKey: string; value: number } => entry.value !== undefined)
  );
}

/** A weekly weight change, signed — grams on metric, ounces otherwise. */
function formatWeightRate(ouncesPerWeek: number, system: MeasurementSystem) {
  const sign = ouncesPerWeek >= 0 ? '+' : '';

  return system === 'metric'
    ? `${sign}${Math.round(ouncesToKilograms(ouncesPerWeek) * 1000)} g`
    : `${sign}${ouncesPerWeek.toFixed(1)} oz`;
}

/** "3–7", or one number when every day in the span landed on the same one. */
function formatRange(stats: MetricStats, suffix = '') {
  const min = formatStat(stats.min, suffix);
  const max = formatStat(stats.max, suffix);

  return min === max ? min : `${min}–${max}`;
}

/** The same range, over durations: "45m–2h 10m". */
function formatDurationRange(min: number, max: number) {
  const shortest = formatDuration(Math.round(min));
  const longest = formatDuration(Math.round(max));

  return shortest === longest ? shortest : `${shortest}–${longest}`;
}

/** "2 lg · 1 sm" — a size nobody logged is left off, so the line stays short. */
function poopSizeBreakdown(counts: { large: number; medium: number; small: number; unsized: number }) {
  return [
    counts.large > 0 ? `${counts.large} lg` : null,
    counts.medium > 0 ? `${counts.medium} md` : null,
    counts.small > 0 ? `${counts.small} sm` : null,
    counts.unsized > 0 ? `${counts.unsized} unsized` : null
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

// Reduces daily data to at most maxBars by averaging groups of days.
function samplePoints(values: ChartPoint[], maxBars: number): ChartPoint[] {
  if (values.length <= maxBars) return values;
  const step = values.length / maxBars;
  const round = (value: number) => Math.round(value * 10) / 10;

  return Array.from({ length: maxBars }, (_, i) => {
    const start = Math.floor(i * step);
    const end = Math.floor((i + 1) * step);
    const bucket = values.slice(start, end);
    const average = (selector: (point: ChartPoint) => number) =>
      round(bucket.reduce((sum, p) => sum + selector(p), 0) / bucket.length);

    return {
      label: bucket[0].label,
      parts: bucket[0].parts?.map((_, partIndex) => average((p) => p.parts?.[partIndex] ?? 0)),
      value: average((p) => p.value)
    };
  });
}

/**
 * Wet and dirty per day, averaged over the days that logged any diaper — the
 * same denominator the total uses, so the two splits add up to it.
 */
function diaperSplitAverages(points: FirstYearPoint[]) {
  const onDiaperDays = (selector: (point: FirstYearPoint) => number) =>
    periodStat(points, (point) => (point.diapers > 0 ? selector(point) : undefined)).average;

  return {
    dirty: onDiaperDays((point) => point.dirtyDiapers),
    wet: onDiaperDays((point) => point.wetDiapers)
  };
}

/** Diaper bars stack wet under dirty, so the split is readable per day. */
function diaperPoints(points: FirstYearPoint[]): ChartPoint[] {
  return points.map((p) => ({ label: p.dateKey, parts: [p.wetDiapers, p.dirtyDiapers], value: p.diapers }));
}

const DIAPER_PART_LABELS = ['wet', 'dirty'];

function longestSleepMinutes(events: CareEvent[]): number {
  return events
    .filter((e) => e.type === 'sleep' && e.endedAt)
    .reduce((max, e) => Math.max(max, minutesBetween(e.startedAt, e.endedAt)), 0);
}

/** Mean, shortest and longest wait between feeds. Zeroed when nothing pairs up. */
function feedGapStats(events: CareEvent[]): MetricStats {
  const feeds = events
    .filter((e) => e.type === 'feed')
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  const gaps: number[] = [];
  for (let i = 1; i < feeds.length; i++) {
    const gap = (new Date(feeds[i].startedAt).getTime() - new Date(feeds[i - 1].startedAt).getTime()) / 60_000;
    if (gap > 0 && gap < 8 * 60) gaps.push(gap); // ignore overnight gaps
  }

  if (gaps.length === 0) {
    return { average: 0, max: 0, min: 0 };
  }

  return {
    average: gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length,
    max: Math.max(...gaps),
    min: Math.min(...gaps)
  };
}

function nursingBalance(events: CareEvent[]): { left: number; right: number; total: number } {
  const feeds = events.filter((e): e is FeedEvent => e.type === 'feed' && e.method === 'nursing');
  const left = feeds.filter((e) => e.side === 'left').length;
  const right = feeds.filter((e) => e.side === 'right').length;
  return { left, right, total: left + right };
}

/**
 * Ounces per week between each pair of consecutive measurements. `latest` is the
 * headline — the stretch since the last weigh-in — and the range beside it says
 * how steady the gain has been across every earlier stretch.
 */
function weightGainOzPerWeek(events: CareEvent[]): { latest: number; stats: MetricStats } | null {
  const measurements = events
    .filter((e): e is Extract<CareEvent, { weightOz?: number }> => (e.type === 'growth' || e.type === 'birth') && 'weightOz' in e && e.weightOz !== undefined)
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  const rates: number[] = [];
  for (let i = 1; i < measurements.length; i++) {
    const days = (new Date(measurements[i].startedAt).getTime() - new Date(measurements[i - 1].startedAt).getTime()) / (24 * 60 * 60_000);
    // Two readings on the same day measure noise, not a week's gain.
    if (days > 0) {
      rates.push((((measurements[i].weightOz as number) - (measurements[i - 1].weightOz as number)) / days) * 7);
    }
  }

  if (rates.length === 0) {
    return null;
  }

  return {
    latest: rates[rates.length - 1],
    stats: { average: rates.reduce((sum, rate) => sum + rate, 0) / rates.length, max: Math.max(...rates), min: Math.min(...rates) }
  };
}

function periodLabel(points: FirstYearPoint[]): string {
  if (points.length === 0) return '';
  const first = points[0].dateKey;
  const last = points[points.length - 1].dateKey;
  return first === last ? formatDayLabel(first) : `${formatDayLabel(first)} – ${formatDayLabel(last)}`;
}

export function Reports({ events, profile }: ReportsProps) {
  const [period, setPeriod] = useState<ReportPeriod>('day');
  const [dateKey, setDateKey] = useState(() => getLocalDateKey(new Date()));
  const [range, setRange] = useState<DateRange>(() => getPresetRange('30d'));
  const preferredUnits = getPreferredUnits(profile);
  const milkSuffix = preferredUnits.system === 'metric' ? ' mL' : ' oz';
  const toPreferredVolume = (ounces: number) => toUnitVolume(ounces, preferredUnits.system);

  const selectedEvents = events.filter((event) => isSameLocalDate(event.startedAt, dateKey));
  const summary = getDailySummary(selectedEvents);
  const daySizes = {
    large: summary.dirtyLarge,
    medium: summary.dirtyMedium,
    small: summary.dirtySmall,
    unsized: summary.dirtyDiapers - summary.dirtyLarge - summary.dirtyMedium - summary.dirtySmall
  };
  // With no size on any change the weighted figure is just the count again, so
  // the breakdown lines stay off rather than repeating it.
  const daySized = daySizes.large + daySizes.medium + daySizes.small;
  const analytics = getFirstYearAnalytics(profile, events);

  // Top overview charts always show the most recent 14 data points
  const recentPoints = analytics.points.slice(-14);
  const recentFeedValues = recentPoints.map((p) => ({ label: p.dateKey, value: p.feeds }));
  const recentDiaperValues = diaperPoints(recentPoints);
  const recentSleepValues = recentPoints.map((p) => ({ label: p.dateKey, value: p.sleepMinutes / 60 }));
  const recentMilkValues = recentPoints.map((p) => ({ label: p.dateKey, value: toPreferredVolume(p.bottleOunces + p.pumpOunces) }));
  const recentMilkStats = convertStats(analytics.stats.milkOunces, toPreferredVolume);

  const sumValues = (values: Array<{ value: number }>) => values.reduce((sum, point) => sum + point.value, 0);
  const recentTotals = {
    diapers: sumValues(recentDiaperValues),
    dirty: recentPoints.reduce((sum, p) => sum + p.dirtyDiapers, 0),
    feeds: sumValues(recentFeedValues),
    milk: sumValues(recentMilkValues),
    sleepHours: sumValues(recentSleepValues),
    wet: recentPoints.reduce((sum, p) => sum + p.wetDiapers, 0)
  };

  // The span since the last weigh-in — what the pediatrician asks about at the
  // next visit. Null until something has been measured.
  const checkup = getCheckupSpan(events);

  // Period-scoped points and stats. The fixed periods count back over the days
  // that logged something; the calendar periods are calendar-true, so they can
  // show a quiet stretch as the gap it actually was.
  const periodCount = period === 'week' ? 7 : period === 'month' ? 30 : analytics.points.length;
  const calendarRange = period === 'custom' ? range : period === 'checkup' ? checkup?.range ?? null : null;
  const periodPoints = isCalendarPeriod(period)
    ? (calendarRange ? analytics.points.filter((point) => isDateKeyInRange(point.dateKey, calendarRange)) : [])
    : analytics.points.slice(-Math.min(periodCount, analytics.points.length));
  const maxBars = period === 'week' ? 7 : period === 'month' ? 30 : isCalendarPeriod(period) ? 31 : 52;
  // Above maxBars the bars average groups of days, so they stop being day totals.
  const sampled = periodPoints.length > maxBars;

  const periodFeedValues = samplePoints(periodPoints.map((p) => ({ label: p.dateKey, value: p.feeds })), maxBars);
  const periodDiaperValues = samplePoints(diaperPoints(periodPoints), maxBars);
  const periodSleepValues = samplePoints(periodPoints.map((p) => ({ label: p.dateKey, value: p.sleepMinutes / 60 })), maxBars);
  const periodMilkValues = samplePoints(periodPoints.map((p) => ({ label: p.dateKey, value: toPreferredVolume(p.bottleOunces + p.pumpOunces) })), maxBars);

  const periodDiaperAverages = diaperSplitAverages(periodPoints);

  const periodStats = {
    feeds: periodStat(periodPoints, (p) => (p.feeds > 0 ? p.feeds : undefined)),
    diapers: periodStat(periodPoints, (p) => (p.diapers > 0 ? p.diapers : undefined)),
    // Gated on any diaper, not on any poop: a day of nothing but wet changes is
    // a real zero-poop day, and dropping it would overstate the pace.
    poops: periodStat(periodPoints, (p) => (p.diapers > 0 ? p.poopLoad : undefined)),
    sleepHours: periodStat(periodPoints, (p) => (p.sleepMinutes > 0 ? p.sleepMinutes / 60 : undefined)),
    milk: periodStat(periodPoints, (p) => {
      const volume = toPreferredVolume(p.bottleOunces + p.pumpOunces);
      return volume > 0 ? volume : undefined;
    })
  };

  const periodTotals = {
    feeds: periodPoints.reduce((s, p) => s + p.feeds, 0),
    diapers: periodPoints.reduce((s, p) => s + p.diapers, 0),
    dirty: periodPoints.reduce((s, p) => s + p.dirtyDiapers, 0),
    large: periodPoints.reduce((s, p) => s + p.dirtyLarge, 0),
    medium: periodPoints.reduce((s, p) => s + p.dirtyMedium, 0),
    poopLoad: periodPoints.reduce((s, p) => s + p.poopLoad, 0),
    sleepHours: periodPoints.reduce((s, p) => s + p.sleepMinutes, 0) / 60,
    small: periodPoints.reduce((s, p) => s + p.dirtySmall, 0),
    milk: toPreferredVolume(periodPoints.reduce((s, p) => s + p.bottleOunces + p.pumpOunces, 0)),
    wet: periodPoints.reduce((s, p) => s + p.wetDiapers, 0)
  };

  const periodPoopSizes = {
    large: periodTotals.large,
    medium: periodTotals.medium,
    small: periodTotals.small,
    unsized: periodTotals.dirty - periodTotals.large - periodTotals.medium - periodTotals.small
  };

  // Period raw events (for insights that need per-event data)
  const periodStartKey = periodPoints.length > 0 ? periodPoints[0].dateKey : '';
  const periodEndKey = periodPoints.length > 0 ? periodPoints[periodPoints.length - 1].dateKey : '';
  const periodRawEvents = period === 'day'
    ? selectedEvents
    : isCalendarPeriod(period)
      ? (calendarRange ? filterEventsByRange(events, calendarRange) : [])
      : events.filter((e) => {
          const dk = getLocalDateKey(e.startedAt);
          return dk >= periodStartKey && dk <= periodEndKey;
        });

  const longestSleep = longestSleepMinutes(events); // all-time best
  const feedGap = feedGapStats(periodRawEvents);
  const diaperLags = getFeedToDiaperLags(periodRawEvents);
  const balance = nursingBalance(periodRawEvents);
  const weightRate = weightGainOzPerWeek(events);

  // What was measured at the visit the span starts from, so the numbers below
  // read as "since he was 8 lb 2 oz" rather than as a bare date.
  const checkupAnchorStats = [
    checkup?.anchor.weightOz != null ? formatWeight(checkup.anchor.weightOz, preferredUnits) : null,
    checkup?.anchor.lengthIn != null ? formatLength(checkup.anchor.lengthIn, preferredUnits.system) : null,
    checkup?.anchor.headCircumferenceIn != null ? `${formatLength(checkup.anchor.headCircumferenceIn, preferredUnits.system)} head` : null
  ].filter((entry): entry is string => entry !== null);

  // Null when Check-Up has nothing to anchor to — the card above already says
  // why, and a second empty line would only repeat it.
  const emptyPeriodMessage = period === 'custom'
    ? `Nothing logged in ${formatRangeLabel(range)}.`
    : period === 'checkup'
      ? (checkup ? 'Nothing logged since the last measurement.' : null)
      : 'Nothing logged yet.';

  const progressLabel = profile.birthDate ? `${analytics.daysElapsed} of 365 days` : 'Birth not logged';

  return (
    <main className="view-stack">
      <section className="section-block first-year-block">
        <div className="section-heading">
          <div>
            <h1>First Year</h1>
            <span>{analytics.totalLogs} logs since {analytics.anchorDate}</span>
          </div>
          <strong>{analytics.progressPercent}%</strong>
        </div>
        <div className="year-progress" aria-label="First year progress">
          <i style={{ width: `${analytics.progressPercent}%` }} />
        </div>
        <p>{progressLabel}</p>
      </section>

      <section className="chart-grid" aria-label="Recent trends">
        <MiniChart event="feed" label="Feeds/day" stats={analytics.stats.feeds} total={recentTotals.feeds} values={recentFeedValues} />
        <MiniChart event="sleep" label="Sleep/day" stats={analytics.stats.sleepHours} suffix="h" total={recentTotals.sleepHours} values={recentSleepValues} />
        <MiniChart
          event="diaper"
          label="Diapers/day"
          partAverages={[analytics.stats.wetDiapers.average, analytics.stats.dirtyDiapers.average]}
          partLabels={DIAPER_PART_LABELS}
          partTotals={[recentTotals.wet, recentTotals.dirty]}
          stats={analytics.stats.diapers}
          total={recentTotals.diapers}
          values={recentDiaperValues}
        />
        <MiniChart event="pump" label="Milk/day" stats={recentMilkStats} suffix={milkSuffix} total={recentTotals.milk} values={recentMilkValues} />
      </section>

      <GrowthStandards events={events} profile={profile} />

      <section className="section-block">
        <div className="section-heading wrap">
          <h2>Report</h2>
          <div className="segmented-control period-control" aria-label="Report period">
            {REPORT_PERIODS.map((p) => (
              <button
                type="button"
                key={p}
                aria-pressed={period === p}
                className={period === p ? 'active' : ''}
                onClick={() => setPeriod(p)}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {period === 'custom' && (
          <DateRangeFilter
            label="Report date range"
            range={range}
            summary={`${periodRawEvents.length} entr${periodRawEvents.length === 1 ? 'y' : 'ies'}`}
            onChange={setRange}
          />
        )}

        {period === 'checkup' && (
          checkup ? (
            <div className="checkup-summary">
              <strong>
                Since {checkup.anchor.type === 'birth' ? 'birth' : 'the measurement'} on {formatDayLabel(checkup.anchor.dateKey)}
              </strong>
              <span>
                {checkup.days} day{checkup.days !== 1 ? 's' : ''} · {periodRawEvents.length} entr{periodRawEvents.length === 1 ? 'y' : 'ies'}
              </span>
              {checkupAnchorStats.length > 0 && <span>Measured then: {checkupAnchorStats.join(' · ')}</span>}
            </div>
          ) : (
            <p className="empty-state compact">
              No growth measurement logged yet, so there is no check-up span to report.
            </p>
          )
        )}

        {period !== 'day' && (
          periodPoints.length > 0 ? (
            <p>{periodLabel(periodPoints)} · {periodPoints.length} day{periodPoints.length !== 1 ? 's' : ''} with entries</p>
          ) : (
            emptyPeriodMessage && <p className="empty-state compact">{emptyPeriodMessage}</p>
          )
        )}
      </section>

      <section className="metric-grid report-grid" aria-label="Insights">
        <article className="metric-card" data-event="sleep">
          <span>Longest sleep</span>
          <strong>{longestSleep > 0 ? formatDuration(longestSleep) : '—'}</strong>
          <small>all time</small>
        </article>
        <article className="metric-card" data-event="feed">
          <span>Avg feed gap</span>
          <strong>{feedGap.average > 0 ? formatDuration(Math.round(feedGap.average)) : '—'}</strong>
          {feedGap.average > 0 && <small>{formatDurationRange(feedGap.min, feedGap.max)} range</small>}
          <small>{periodScopeLabel(period)}</small>
        </article>
        {(['wet', 'dirty'] as const).map((kind) => {
          const lag = diaperLags[kind];

          return (
            <article className="metric-card" data-event="diaper" key={kind}>
              <span>Feed → {kind}</span>
              <strong>{lag.averageMinutes !== null ? formatDuration(Math.round(lag.averageMinutes)) : '—'}</strong>
              {lag.minMinutes !== null && lag.maxMinutes !== null && (
                <small>{formatDurationRange(lag.minMinutes, lag.maxMinutes)} range</small>
              )}
              <small>{lag.samples > 0 ? `${lag.samples} feeds` : 'no pairs yet'}</small>
            </article>
          );
        })}
        <article className="metric-card" data-event="feed">
          <span>Nursing L/R</span>
          <strong>
            {balance.total > 0
              ? `${Math.round((balance.left / balance.total) * 100)}% · ${Math.round((balance.right / balance.total) * 100)}%`
              : '—'}
          </strong>
          <small>{periodScopeLabel(period)}</small>
        </article>
        <article className="metric-card" data-event="growth">
          <span>Weight gain</span>
          <strong>{weightRate ? formatWeightRate(weightRate.latest, preferredUnits.system) : '—'}</strong>
          {weightRate && weightRate.stats.min !== weightRate.stats.max && (
            <small>
              {formatWeightRate(weightRate.stats.min, preferredUnits.system)}–
              {formatWeightRate(weightRate.stats.max, preferredUnits.system)} range
            </small>
          )}
          <small>per week</small>
        </article>
      </section>

      <FeedClock events={periodRawEvents} scopeLabel={periodScopeLabel(period)} />

      <FeedOrder events={periodRawEvents} scopeLabel={periodScopeLabel(period)} />

      {period === 'day' ? (
        <>
          <section className="section-block">
            <div className="section-heading">
              <h2>Daily Report</h2>
              <input
                className="date-input"
                type="date"
                value={dateKey}
                onChange={(event) => setDateKey(event.target.value)}
                aria-label="Report date"
              />
            </div>
          </section>

          <NewbornStatus events={events} profile={profile} dateKey={dateKey} heading="Newborn check (selected day)" />

          <section className="metric-grid report-grid" aria-label="Daily summary">
            <article className="metric-card" data-event="feed">
              <span>Feeds</span>
              <strong>{summary.feedCount}</strong>
            </article>
            <article className="metric-card" data-event="feed">
              <span>Nursing</span>
              <strong>{formatDuration(summary.nursingMinutes)}</strong>
            </article>
            <article className="metric-card" data-event="feed">
              <span>Bottle</span>
              <strong>{formatVolume(summary.bottleOunces, preferredUnits.system)}</strong>
            </article>
            <article className="metric-card" data-event="pump">
              <span>Pumped</span>
              <strong>{formatVolume(summary.pumpOunces, preferredUnits.system)}</strong>
            </article>
            <article className="metric-card" data-event="diaper">
              <span>Wet</span>
              <strong>{summary.wetDiapers}</strong>
            </article>
            <article className="metric-card" data-event="diaper">
              <span>Dirty</span>
              <strong>{summary.dirtyDiapers}</strong>
              {daySized > 0 && <small>{poopSizeBreakdown(daySizes)}</small>}
              {daySized > 0 && <small>{formatStat(summary.poopLoad)} poops by size</small>}
            </article>
            <article className="metric-card" data-event="sleep">
              <span>Sleep</span>
              <strong>{formatDuration(summary.sleepMinutes)}</strong>
            </article>
            <article className="metric-card" data-event="medication">
              <span>Meds</span>
              <strong>{summary.medicationsGiven}</strong>
            </article>
          </section>

          <section className="section-block">
            <div className="section-heading">
              <h2>Entries</h2>
              <span>{selectedEvents.length}</span>
            </div>
            <Timeline events={selectedEvents} emptyMessage="No entries on this date." profile={profile} />
          </section>
        </>
      ) : (
        <>
          <section className="metric-grid report-grid" aria-label={`Summary for ${periodScopeLabel(period)}`}>
            <article className="metric-card" data-event="feed">
              <span>Feeds/day</span>
              <strong>{formatStat(periodStats.feeds.average)}</strong>
              <small>{formatRange(periodStats.feeds)} range</small>
              <small>{periodTotals.feeds} total</small>
            </article>
            <article className="metric-card" data-event="diaper">
              <span>Diapers/day</span>
              <strong>{formatStat(periodStats.diapers.average)}</strong>
              <small>{formatRange(periodStats.diapers)} range</small>
              <small>{formatStat(periodDiaperAverages.wet)} wet · {formatStat(periodDiaperAverages.dirty)} dirty</small>
              <small>{periodTotals.diapers} total</small>
            </article>
            <article className="metric-card" data-event="diaper">
              <span>Poops/day</span>
              <strong>{formatStat(periodStats.poops.average)}</strong>
              <small>{formatRange(periodStats.poops)} range</small>
              <small>{periodTotals.dirty > 0 ? poopSizeBreakdown(periodPoopSizes) : 'none logged'}</small>
              <small>{formatStat(periodTotals.poopLoad)} total · {periodTotals.dirty} change{periodTotals.dirty !== 1 ? 's' : ''}</small>
            </article>
            <article className="metric-card" data-event="sleep">
              <span>Sleep/day</span>
              <strong>{formatStat(periodStats.sleepHours.average, 'h')}</strong>
              <small>{formatRange(periodStats.sleepHours, 'h')} range</small>
              <small>{formatStat(periodTotals.sleepHours, 'h')} total</small>
            </article>
            <article className="metric-card" data-event="pump">
              <span>Milk/day</span>
              <strong>{formatStat(periodStats.milk.average, milkSuffix)}</strong>
              <small>{formatRange(periodStats.milk, milkSuffix)} range</small>
              <small>{formatStat(periodTotals.milk, milkSuffix)} total</small>
            </article>
          </section>

          <section className="chart-grid" aria-label={`Charts for ${periodScopeLabel(period)}`}>
            <MiniChart event="feed" label="Feeds/day" sampled={sampled} stats={periodStats.feeds} total={periodTotals.feeds} values={periodFeedValues} />
            <MiniChart event="sleep" label="Sleep/day" sampled={sampled} stats={periodStats.sleepHours} suffix="h" total={periodTotals.sleepHours} values={periodSleepValues} />
            <MiniChart
              event="diaper"
              label="Diapers/day"
              partAverages={[periodDiaperAverages.wet, periodDiaperAverages.dirty]}
              partLabels={DIAPER_PART_LABELS}
              partTotals={[periodTotals.wet, periodTotals.dirty]}
              sampled={sampled}
              stats={periodStats.diapers}
              total={periodTotals.diapers}
              values={periodDiaperValues}
            />
            <MiniChart event="pump" label="Milk/day" sampled={sampled} stats={periodStats.milk} suffix={milkSuffix} total={periodTotals.milk} values={periodMilkValues} />
          </section>
        </>
      )}
    </main>
  );
}
