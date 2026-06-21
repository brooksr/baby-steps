import { useState } from 'react';
import { formatDuration, formatShortDate, getLocalDateKey, isSameLocalDate, minutesBetween } from '../domain/dates';
import { getFirstYearAnalytics, type FirstYearPoint, type MetricStats } from '../domain/firstYear';
import { getDailySummary } from '../domain/summary';
import type { BabyProfile, BreastfeedEvent, CareEvent } from '../domain/types';
import { GrowthStandards } from './GrowthStandards';
import { NewbornStatus } from './NewbornStatus';
import { Timeline } from './Timeline';

type ReportPeriod = 'day' | 'week' | 'month' | 'year';

interface ReportsProps {
  events: CareEvent[];
  profile: BabyProfile;
}

interface MiniChartProps {
  label: string;
  stats: MetricStats;
  suffix?: string;
  values: Array<{ label: string; value: number }>;
}

function formatStat(value: number, suffix = '') {
  const rounded = value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${Number(rounded).toLocaleString()}${suffix}`;
}

function MiniChart({ label, stats, suffix = '', values }: MiniChartProps) {
  const max = Math.max(1, ...values.map((point) => point.value));
  const cols = Math.max(1, values.length);

  return (
    <article className="chart-card">
      <div className="chart-heading">
        <h3>{label}</h3>
        <strong>{formatStat(stats.average, suffix)} avg</strong>
      </div>
      <div
        className="chart-bars"
        aria-label={`${label} chart`}
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(3px, 1fr))` }}
      >
        {values.length === 0 ? (
          <p className="empty-state compact">No data</p>
        ) : (
          values.map((point) => (
            <span className="chart-bar" key={`${label}-${point.label}`}>
              <i style={{ height: `${Math.max(8, (point.value / max) * 100)}%` }} />
            </span>
          ))
        )}
      </div>
      <div className="chart-stats">
        <span>Min {formatStat(stats.min, suffix)}</span>
        <span>Max {formatStat(stats.max, suffix)}</span>
      </div>
    </article>
  );
}

function computeStats(values: number[]): MetricStats {
  const nonZero = values.filter((v) => v > 0);
  if (nonZero.length === 0) return { average: 0, max: 0, min: 0 };
  return {
    average: nonZero.reduce((s, v) => s + v, 0) / nonZero.length,
    max: Math.max(...nonZero),
    min: Math.min(...nonZero)
  };
}

// Reduces daily data to at most maxBars by averaging groups of days.
function samplePoints(
  values: Array<{ label: string; value: number }>,
  maxBars: number
): Array<{ label: string; value: number }> {
  if (values.length <= maxBars) return values;
  const step = values.length / maxBars;
  return Array.from({ length: maxBars }, (_, i) => {
    const start = Math.floor(i * step);
    const end = Math.floor((i + 1) * step);
    const bucket = values.slice(start, end);
    const avg = bucket.reduce((sum, p) => sum + p.value, 0) / bucket.length;
    return { label: bucket[0].label, value: Math.round(avg * 10) / 10 };
  });
}

function longestSleepMinutes(events: CareEvent[]): number {
  return events
    .filter((e) => e.type === 'sleep' && e.endedAt)
    .reduce((max, e) => Math.max(max, minutesBetween(e.startedAt, e.endedAt)), 0);
}

function avgFeedGapMinutes(events: CareEvent[]): number {
  const feeds = events
    .filter((e) => e.type === 'breastfeed' || e.type === 'bottle')
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  if (feeds.length < 2) return 0;

  const gaps: number[] = [];
  for (let i = 1; i < feeds.length; i++) {
    const gap = (new Date(feeds[i].startedAt).getTime() - new Date(feeds[i - 1].startedAt).getTime()) / 60_000;
    if (gap > 0 && gap < 8 * 60) gaps.push(gap); // ignore overnight gaps
  }

  return gaps.length > 0 ? gaps.reduce((s, v) => s + v, 0) / gaps.length : 0;
}

function nursingBalance(events: CareEvent[]): { left: number; right: number; total: number } {
  const feeds = events.filter((e): e is BreastfeedEvent => e.type === 'breastfeed');
  const left = feeds.filter((e) => e.side === 'left').length;
  const right = feeds.filter((e) => e.side === 'right').length;
  return { left, right, total: left + right };
}

function weightGainOzPerWeek(events: CareEvent[]): number | null {
  const measurements = events
    .filter((e): e is Extract<CareEvent, { weightOz?: number }> => (e.type === 'growth' || e.type === 'birth') && 'weightOz' in e && e.weightOz !== undefined)
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  if (measurements.length < 2) return null;

  const last = measurements[measurements.length - 1];
  const prev = measurements[measurements.length - 2];
  const ozDiff = (last.weightOz as number) - (prev.weightOz as number);
  const days = (new Date(last.startedAt).getTime() - new Date(prev.startedAt).getTime()) / (24 * 60 * 60_000);
  return days > 0 ? (ozDiff / days) * 7 : null;
}

function periodLabel(points: FirstYearPoint[]): string {
  if (points.length === 0) return '';
  const first = points[0].dateKey;
  const last = points[points.length - 1].dateKey;
  return first === last ? formatShortDate(first) : `${formatShortDate(first)} – ${formatShortDate(last)}`;
}

export function Reports({ events, profile }: ReportsProps) {
  const [period, setPeriod] = useState<ReportPeriod>('day');
  const [dateKey, setDateKey] = useState(() => getLocalDateKey(new Date()));

  const selectedEvents = events.filter((event) => isSameLocalDate(event.startedAt, dateKey));
  const summary = getDailySummary(selectedEvents);
  const analytics = getFirstYearAnalytics(profile, events);

  // Top overview charts always show the most recent 14 data points
  const recentPoints = analytics.points.slice(-14);
  const recentFeedValues = recentPoints.map((p) => ({ label: p.dateKey, value: p.feeds }));
  const recentDiaperValues = recentPoints.map((p) => ({ label: p.dateKey, value: p.diapers }));
  const recentSleepValues = recentPoints.map((p) => ({ label: p.dateKey, value: p.sleepMinutes / 60 }));
  const recentMilkValues = recentPoints.map((p) => ({ label: p.dateKey, value: p.bottleOunces + p.pumpOunces }));

  // Period-scoped points and stats
  const periodCount = period === 'week' ? 7 : period === 'month' ? 30 : analytics.points.length;
  const periodPoints = analytics.points.slice(-Math.min(periodCount, analytics.points.length));
  const maxBars = period === 'week' ? 7 : period === 'month' ? 30 : 52;

  const periodFeedValues = samplePoints(periodPoints.map((p) => ({ label: p.dateKey, value: p.feeds })), maxBars);
  const periodDiaperValues = samplePoints(periodPoints.map((p) => ({ label: p.dateKey, value: p.diapers })), maxBars);
  const periodSleepValues = samplePoints(periodPoints.map((p) => ({ label: p.dateKey, value: p.sleepMinutes / 60 })), maxBars);
  const periodMilkValues = samplePoints(periodPoints.map((p) => ({ label: p.dateKey, value: p.bottleOunces + p.pumpOunces })), maxBars);

  const periodStats = {
    feeds: computeStats(periodPoints.map((p) => p.feeds)),
    diapers: computeStats(periodPoints.map((p) => p.diapers)),
    sleepHours: computeStats(periodPoints.map((p) => (p.sleepMinutes > 0 ? p.sleepMinutes / 60 : 0))),
    milkOz: computeStats(periodPoints.map((p) => p.bottleOunces + p.pumpOunces))
  };

  const periodTotals = {
    feeds: periodPoints.reduce((s, p) => s + p.feeds, 0),
    diapers: periodPoints.reduce((s, p) => s + p.diapers, 0),
    sleepHours: periodPoints.reduce((s, p) => s + p.sleepMinutes, 0) / 60,
    milkOz: periodPoints.reduce((s, p) => s + p.bottleOunces + p.pumpOunces, 0)
  };

  // Period raw events (for insights that need per-event data)
  const periodStartKey = periodPoints.length > 0 ? periodPoints[0].dateKey : '';
  const periodEndKey = periodPoints.length > 0 ? periodPoints[periodPoints.length - 1].dateKey : '';
  const periodRawEvents = period === 'day'
    ? selectedEvents
    : events.filter((e) => {
        const dk = getLocalDateKey(e.startedAt);
        return dk >= periodStartKey && dk <= periodEndKey;
      });

  const longestSleep = longestSleepMinutes(events); // all-time best
  const feedGap = avgFeedGapMinutes(periodRawEvents);
  const balance = nursingBalance(periodRawEvents);
  const weightRate = weightGainOzPerWeek(events);

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
        <MiniChart label="Feeds/day" stats={analytics.stats.feeds} values={recentFeedValues} />
        <MiniChart label="Sleep/day" stats={analytics.stats.sleepHours} suffix="h" values={recentSleepValues} />
        <MiniChart label="Diapers/day" stats={analytics.stats.diapers} values={recentDiaperValues} />
        <MiniChart label="Milk/day" stats={analytics.stats.milkOunces} suffix=" oz" values={recentMilkValues} />
      </section>

      <GrowthStandards events={events} profile={profile} />

      <section className="metric-grid report-grid" aria-label="Insights">
        <article className="metric-card">
          <span>Longest sleep</span>
          <strong>{longestSleep > 0 ? formatDuration(longestSleep) : '—'}</strong>
          <small>all time</small>
        </article>
        <article className="metric-card">
          <span>Avg feed gap</span>
          <strong>{feedGap > 0 ? formatDuration(Math.round(feedGap)) : '—'}</strong>
          <small>{period === 'day' ? 'today' : `this ${period}`}</small>
        </article>
        <article className="metric-card">
          <span>Nursing L/R</span>
          <strong>
            {balance.total > 0
              ? `${Math.round((balance.left / balance.total) * 100)}% · ${Math.round((balance.right / balance.total) * 100)}%`
              : '—'}
          </strong>
          <small>{period === 'day' ? 'today' : `this ${period}`}</small>
        </article>
        <article className="metric-card">
          <span>Weight gain</span>
          <strong>{weightRate !== null ? `${weightRate >= 0 ? '+' : ''}${weightRate.toFixed(1)} oz` : '—'}</strong>
          <small>per week</small>
        </article>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>Report</h2>
          <div
            className="segmented-control"
            style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
            aria-label="Report period"
          >
            {(['day', 'week', 'month', 'year'] as ReportPeriod[]).map((p) => (
              <button
                key={p}
                className={period === p ? 'active' : ''}
                onClick={() => setPeriod(p)}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {period !== 'day' && periodPoints.length > 0 && (
          <p>{periodLabel(periodPoints)} · {periodPoints.length} day{periodPoints.length !== 1 ? 's' : ''}</p>
        )}
      </section>

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
            <article className="metric-card">
              <span>Feeds</span>
              <strong>{summary.feedCount}</strong>
            </article>
            <article className="metric-card">
              <span>Nursing</span>
              <strong>{formatDuration(summary.nursingMinutes)}</strong>
            </article>
            <article className="metric-card">
              <span>Bottle</span>
              <strong>{summary.bottleOunces.toFixed(1)} oz</strong>
            </article>
            <article className="metric-card">
              <span>Pumped</span>
              <strong>{summary.pumpOunces.toFixed(1)} oz</strong>
            </article>
            <article className="metric-card">
              <span>Wet</span>
              <strong>{summary.wetDiapers}</strong>
            </article>
            <article className="metric-card">
              <span>Dirty</span>
              <strong>{summary.dirtyDiapers}</strong>
            </article>
            <article className="metric-card">
              <span>Sleep</span>
              <strong>{formatDuration(summary.sleepMinutes)}</strong>
            </article>
            <article className="metric-card">
              <span>Meds</span>
              <strong>{summary.medicationsGiven}</strong>
            </article>
          </section>

          <section className="section-block">
            <div className="section-heading">
              <h2>Entries</h2>
              <span>{selectedEvents.length}</span>
            </div>
            <Timeline events={selectedEvents} emptyMessage="No entries on this date." />
          </section>
        </>
      ) : (
        <>
          <section className="metric-grid report-grid" aria-label={`${period} summary`}>
            <article className="metric-card">
              <span>Feeds/day</span>
              <strong>{formatStat(periodStats.feeds.average)}</strong>
              <small>{periodTotals.feeds} total</small>
            </article>
            <article className="metric-card">
              <span>Diapers/day</span>
              <strong>{formatStat(periodStats.diapers.average)}</strong>
              <small>{periodTotals.diapers} total</small>
            </article>
            <article className="metric-card">
              <span>Sleep/day</span>
              <strong>{formatStat(periodStats.sleepHours.average, 'h')}</strong>
              <small>{formatStat(periodTotals.sleepHours, 'h')} total</small>
            </article>
            <article className="metric-card">
              <span>Milk/day</span>
              <strong>{formatStat(periodStats.milkOz.average, ' oz')}</strong>
              <small>{formatStat(periodTotals.milkOz, ' oz')} total</small>
            </article>
          </section>

          <section className="chart-grid" aria-label={`${period} charts`}>
            <MiniChart label="Feeds/day" stats={periodStats.feeds} values={periodFeedValues} />
            <MiniChart label="Sleep/day" stats={periodStats.sleepHours} suffix="h" values={periodSleepValues} />
            <MiniChart label="Diapers/day" stats={periodStats.diapers} values={periodDiaperValues} />
            <MiniChart label="Milk/day" stats={periodStats.milkOz} suffix=" oz" values={periodMilkValues} />
          </section>
        </>
      )}
    </main>
  );
}
