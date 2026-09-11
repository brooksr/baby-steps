import { useState } from 'react';
import { formatDuration } from '../domain/dates';
import {
  DEFAULT_FEED_BAND_HOURS,
  FEED_BAND_OPTIONS,
  getFeedClockReport,
  type FeedBandHours,
  type FeedTimeBand
} from '../domain/feedClock';
import type { CareEvent } from '../domain/types';

interface FeedClockProps {
  events: CareEvent[];
  /** How the cards name the span they measured — "this week", "today". */
  scopeLabel: string;
}

interface ClockChartProps {
  bands: FeedTimeBand[];
  /** The big number under the title. */
  headline: string;
  label: string;
  /** The line under the headline. */
  note: string;
  /** The pair along the bottom, already worded. */
  stats: [string, string];
  /** What a bar is drawn from — null draws no bar and reads as "—". */
  valueOf: (band: FeedTimeBand) => number | null;
  formatValue: (value: number) => string;
  /** What the band says when it is picked, without repeating its own name. */
  readoutOf: (band: FeedTimeBand) => string;
}

/** Above this many bands a per-bar number has nowhere to sit. */
const MAX_LABELLED_BANDS = 12;

/** One decimal, the way every other rate on the Reports page is written. */
function formatRate(value: number) {
  return `${Number(value.toFixed(1)).toLocaleString()}`;
}

function ClockChart({ bands, headline, label, note, stats, valueOf, formatValue, readoutOf }: ClockChartProps) {
  const [activeHour, setActiveHour] = useState<number | null>(null);
  const max = Math.max(1, ...bands.map((band) => valueOf(band) ?? 0));
  const activeBand = bands.find((band) => band.startHour === activeHour) ?? null;
  // Twenty-four bars leave no room for a number over each one, and the hour
  // ticks have to thin out to every third — the readout still names any bar.
  const showValues = bands.length <= MAX_LABELLED_BANDS;
  const showsTick = (startHour: number) => bands.length <= MAX_LABELLED_BANDS || startHour % 3 === 0;

  return (
    <article className="chart-card" data-event="feed">
      <div className="chart-heading">
        <h3>{label}</h3>
        <strong>{headline}</strong>
        <small>{note}</small>
      </div>
      <div
        className="chart-bars"
        aria-label={`${label} chart`}
        style={{ gridTemplateColumns: `repeat(${bands.length}, minmax(0, 1fr))` }}
      >
        {bands.map((band) => {
          const value = valueOf(band);
          const readout = `${band.label}: ${readoutOf(band)}`;

          return (
            <button
              type="button"
              className={`chart-column${band === activeBand ? ' active' : ''}`}
              key={band.startHour}
              aria-label={readout}
              title={readout}
              onClick={() => setActiveHour(band.startHour)}
            >
              {showValues && <b className="chart-bar-value">{value === null ? '—' : formatValue(value)}</b>}
              <span className="chart-bar">
                {/* An hour with nothing in it draws no bar: on a clock a gap is
                    the point, and a stub would read as a small something. A band
                    nobody timed is empty the same way — an absent average is not
                    a zero-length feed. */}
                <i style={{ height: value ? `${Math.max(8, (value / max) * 100)}%` : '0%' }} />
              </span>
              <em className="chart-bar-day">{showsTick(band.startHour) ? band.shortLabel : ''}</em>
            </button>
          );
        })}
      </div>
      {activeBand && (
        <p className="chart-readout">
          <span>{activeBand.label}</span>
          <strong>{readoutOf(activeBand)}</strong>
        </p>
      )}
      <div className="chart-stats">
        <span>{stats[0]}</span>
        <span>{stats[1]}</span>
      </div>
    </article>
  );
}

/**
 * When feeds happen across the day and how long they run at each of those
 * times: one chart for the shape of the day, one for the length of a feed in
 * each part of it. Both read the same three-hour bands, so a tall bar on the
 * left and a tall bar on the right are the same stretch of clock.
 */
export function FeedClock({ events, scopeLabel }: FeedClockProps) {
  const [bandHours, setBandHours] = useState<FeedBandHours>(DEFAULT_FEED_BAND_HOURS);
  const report = getFeedClockReport(events, bandHours);
  const feedWord = (count: number) => `${count} feed${count === 1 ? '' : 's'}`;
  // "Today" already says the span is one day, so the day count is left off there.
  const spread = report.days === 1 ? '' : ` across ${report.days} days`;
  const scope = `${scopeLabel.charAt(0).toUpperCase()}${scopeLabel.slice(1)}`;

  return (
    <>
      <section className="section-block" data-event="feed">
        <div className="section-heading wrap">
          <h2>Feed clock</h2>
          <div className="segmented-control three-option" aria-label="Hours per band">
            {FEED_BAND_OPTIONS.map((hours) => (
              <button
                type="button"
                key={hours}
                aria-pressed={bandHours === hours}
                className={bandHours === hours ? 'active' : ''}
                onClick={() => setBandHours(hours)}
              >
                {hours}h
              </button>
            ))}
          </div>
        </div>
        <p>
          {report.feeds === 0
            ? `${scope}: no feeds logged.`
            : `${scope}: ${feedWord(report.feeds)}${spread}${
                report.busiest ? `, most often around ${report.busiest.label}` : ''
              }.`}
        </p>
      </section>

      {report.feeds > 0 && (
        <section className="chart-grid clock-grid" aria-label="Feeds by time of day">
          <ClockChart
            bands={report.bands}
            formatValue={(value) => `${value}`}
            headline={report.busiest ? report.busiest.label : '—'}
            label="Feeds by time of day"
            note={`busiest · ${feedWord(report.feeds)}`}
            readoutOf={(band) =>
              band.feedsPerDay === null
                ? feedWord(band.feeds)
                : `${feedWord(band.feeds)} · ${formatRate(band.feedsPerDay)}/day`
            }
            stats={[
              `Busiest ${report.busiest?.label ?? '—'}`,
              report.busiest?.feedsPerDay != null ? `${formatRate(report.busiest.feedsPerDay)}/day` : 'per day —'
            ]}
            /* Bars are raw counts: that is the shape of the day, and a band
               today that has not come round yet is honestly empty. The per-day
               rate, which does account for that, is on the readout. */
            valueOf={(band) => band.feeds}
          />
          <ClockChart
            bands={report.bands}
            formatValue={(value) => formatDuration(Math.round(value))}
            headline={report.averageMinutes === null ? '—' : formatDuration(Math.round(report.averageMinutes))}
            label="Feed length by time"
            note={`avg feed · ${report.timed} of ${report.feeds} timed`}
            readoutOf={(band) => {
              if (band.averageMinutes === null) {
                return 'no timed feeds';
              }

              const shortest = formatDuration(Math.round(band.minMinutes as number));
              const longest = formatDuration(Math.round(band.maxMinutes as number));
              const range = shortest === longest ? '' : ` · ${shortest}–${longest}`;

              return `${formatDuration(Math.round(band.averageMinutes))} avg${range} · ${band.timed} timed`;
            }}
            stats={[`Longest ${report.longest?.label ?? '—'}`, `Shortest ${report.shortest?.label ?? '—'}`]}
            valueOf={(band) => band.averageMinutes}
          />
        </section>
      )}
    </>
  );
}
