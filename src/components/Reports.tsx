import { useState } from 'react';
import { getLocalDateKey, formatDuration, isSameLocalDate } from '../domain/dates';
import { getFirstYearAnalytics, type MetricStats } from '../domain/firstYear';
import { getDailySummary } from '../domain/summary';
import type { BabyProfile, CareEvent } from '../domain/types';
import { Timeline } from './Timeline';

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
  const recentValues = values.slice(-14);

  return (
    <article className="chart-card">
      <div className="chart-heading">
        <h3>{label}</h3>
        <strong>{formatStat(stats.average, suffix)} avg</strong>
      </div>
      <div className="chart-bars" aria-label={`${label} chart`}>
        {recentValues.length === 0 ? (
          <p className="empty-state compact">No data</p>
        ) : (
          recentValues.map((point) => (
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

export function Reports({ events, profile }: ReportsProps) {
  const [dateKey, setDateKey] = useState(() => getLocalDateKey(new Date()));
  const selectedEvents = events.filter((event) => isSameLocalDate(event.startedAt, dateKey));
  const summary = getDailySummary(selectedEvents);
  const analytics = getFirstYearAnalytics(profile, events);
  const feedValues = analytics.points.map((point) => ({ label: point.dateKey, value: point.feeds }));
  const diaperValues = analytics.points.map((point) => ({ label: point.dateKey, value: point.diapers }));
  const sleepValues = analytics.points.map((point) => ({ label: point.dateKey, value: point.sleepMinutes / 60 }));
  const milkValues = analytics.points.map((point) => ({ label: point.dateKey, value: point.bottleOunces + point.pumpOunces }));
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

      <section className="chart-grid" aria-label="First year charts">
        <MiniChart label="Feeds/day" stats={analytics.stats.feeds} values={feedValues} />
        <MiniChart label="Sleep/day" stats={analytics.stats.sleepHours} suffix="h" values={sleepValues} />
        <MiniChart label="Diapers/day" stats={analytics.stats.diapers} values={diaperValues} />
        <MiniChart label="Milk/day" stats={analytics.stats.milkOunces} suffix=" oz" values={milkValues} />
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>Daily Report</h2>
          <input className="date-input" type="date" value={dateKey} onChange={(event) => setDateKey(event.target.value)} aria-label="Report date" />
        </div>
      </section>

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
    </main>
  );
}
