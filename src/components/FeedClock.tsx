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
  feeds: number;
  timed: number;
  averageMinutes: number | null;
  busiest: FeedTimeBand | null;
  longest: FeedTimeBand | null;
  shortest: FeedTimeBand | null;
}

/** Above this many bands a per-bar number has nowhere to sit. */
const MAX_LABELLED_BANDS = 12;

/** One decimal, the way every other rate on the Reports page is written. */
function formatRate(value: number) {
  return `${Number(value.toFixed(1)).toLocaleString()}`;
}

function feedWord(count: number) {
  return `${count} feed${count === 1 ? '' : 's'}`;
}

function countReadout(band: FeedTimeBand) {
  return band.feedsPerDay === null ? feedWord(band.feeds) : `${feedWord(band.feeds)} · ${formatRate(band.feedsPerDay)}/day`;
}

function lengthReadout(band: FeedTimeBand) {
  if (band.averageMinutes === null) {
    return 'no timed feeds';
  }

  const shortest = formatDuration(Math.round(band.minMinutes as number));
  const longest = formatDuration(Math.round(band.maxMinutes as number));
  const range = shortest === longest ? '' : ` · ${shortest}–${longest}`;

  return `${formatDuration(Math.round(band.averageMinutes))} avg${range} · ${band.timed} timed`;
}

/**
 * One chart for both questions: the bar is how many feeds started in a band,
 * and the mark across it is how long those feeds ran on average, on its own
 * scale. Bars are raw counts — that is the shape of the day, and a band today
 * that has not come round yet is honestly empty. The per-day rate, which does
 * account for that, is on the readout.
 */
function ClockChart({ averageMinutes, bands, busiest, feeds, longest, shortest, timed }: ClockChartProps) {
  const [activeHour, setActiveHour] = useState<number | null>(null);
  const maxCount = Math.max(1, ...bands.map((band) => band.feeds));
  const maxLength = Math.max(1, ...bands.map((band) => band.averageMinutes ?? 0));
  const activeBand = bands.find((band) => band.startHour === activeHour) ?? null;
  // Twenty-four bars leave no room for a number over each one, and the hour
  // ticks have to thin out to every third — the readout still names any bar.
  const showValues = bands.length <= MAX_LABELLED_BANDS;
  const showsTick = (startHour: number) => bands.length <= MAX_LABELLED_BANDS || startHour % 3 === 0;

  return (
    <article className="chart-card feed-clock-chart" data-event="feed">
      <div className="chart-heading">
        <h3>Feeds &amp; length by time of day</h3>
        <strong>{busiest ? busiest.label : '—'}</strong>
        <small>
          busiest · {feedWord(feeds)} · {averageMinutes === null ? 'no timed feeds' : `${formatDuration(Math.round(averageMinutes))} avg, ${timed} of ${feeds} timed`}
        </small>
      </div>
      <div
        className="chart-bars"
        aria-label="Feeds and length by time of day chart"
        style={{ gridTemplateColumns: `repeat(${bands.length}, minmax(0, 1fr))` }}
      >
        {bands.map((band) => {
          const readout = `${band.label}: ${countReadout(band)} · ${lengthReadout(band)}`;

          return (
            <button
              type="button"
              className={`chart-column${band === activeBand ? ' active' : ''}`}
              key={band.startHour}
              aria-label={readout}
              title={readout}
              onClick={() => setActiveHour(band.startHour)}
            >
              {showValues && <b className="chart-bar-value">{band.feeds}</b>}
              <span className="chart-bar">
                {/* An hour with nothing in it draws no bar: on a clock a gap is
                    the point, and a stub would read as a small something. */}
                <i style={{ height: band.feeds ? `${Math.max(8, (band.feeds / maxCount) * 100)}%` : '0%' }} />
                {/* A band nobody timed has no mark — an absent average is not a
                    zero-length feed. */}
                {band.averageMinutes !== null && (
                  <s className="feed-length-mark" style={{ bottom: `${(band.averageMinutes / maxLength) * 100}%` }} />
                )}
              </span>
              <em className="chart-bar-day">{showsTick(band.startHour) ? band.shortLabel : ''}</em>
            </button>
          );
        })}
      </div>
      <div className="chart-legend">
        <span className="chart-legend-item feed-legend-count">Feeds</span>
        <span className="chart-legend-item feed-legend-length">Avg length{averageMinutes === null ? '' : ` (top ${formatDuration(Math.round(maxLength))})`}</span>
      </div>
      {activeBand && (
        <p className="chart-readout">
          <span>{activeBand.label}</span>
          <strong>{countReadout(activeBand)}</strong>
          <strong>{lengthReadout(activeBand)}</strong>
        </p>
      )}
      <div className="chart-stats">
        <span>
          Busiest {busiest?.label ?? '—'}
          {busiest?.feedsPerDay != null ? ` · ${formatRate(busiest.feedsPerDay)}/day` : ''}
        </span>
        <span>Longest {longest?.label ?? '—'} · Shortest {shortest?.label ?? '—'}</span>
      </div>
    </article>
  );
}

/**
 * When feeds happen across the day and how long they run at each of those
 * times, on one chart over the same bands — the bar counts feeds, the mark
 * across it is their average length.
 */
export function FeedClock({ events, scopeLabel }: FeedClockProps) {
  const [bandHours, setBandHours] = useState<FeedBandHours>(DEFAULT_FEED_BAND_HOURS);
  const report = getFeedClockReport(events, bandHours);
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
            averageMinutes={report.averageMinutes}
            bands={report.bands}
            busiest={report.busiest}
            feeds={report.feeds}
            longest={report.longest}
            shortest={report.shortest}
            timed={report.timed}
          />
        </section>
      )}
    </>
  );
}
