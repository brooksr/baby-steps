import { formatDuration, formatMinutesOfDay } from '../domain/dates';
import {
  FEED_DAY_MAX_FEEDS,
  FEED_DAY_MIN_FEEDS,
  getFeedOrderReport,
  toClockMinutes
} from '../domain/feedOrder';
import type { CareEvent } from '../domain/types';

const DAY_MINUTES = 24 * 60;

/** Ticks every six hours along the feeding day — enough to place a row, few
 *  enough to read on a phone. Both ends are the day start, a full day apart. */
const AXIS_OFFSETS = [0, 6 * 60, 12 * 60, 18 * 60, DAY_MINUTES];

interface FeedOrderProps {
  events: CareEvent[];
  /** How the section names the span it measured — "this week", "today". */
  scopeLabel: string;
}

const percent = (minutes: number) => `${(minutes / DAY_MINUTES) * 100}%`;

const dayWord = (count: number) => `${count} day${count === 1 ? '' : 's'}`;

/**
 * The day by feed order rather than by clock: when the first feed of the day
 * usually lands, then the second, and so on. Each row sits on the same 24-hour
 * track — the bar is the earliest-to-latest spread that index has run to, the
 * mark inside it is the average — so the shape of a day reads straight down the
 * column, and a row that wanders shows as a wide bar rather than hiding inside
 * its own average.
 *
 * The track runs from the start of the feeding day (see `FEED_DAY_START_HOUR`)
 * rather than from midnight, so a late-night feed sits at the right-hand end
 * where it belongs in the sequence instead of jumping back to the left. Only
 * ordinary full days are counted (see `FEED_DAY_MIN_FEEDS`), and the line under
 * the summary says how many days that left, since every number here is about
 * them rather than about the whole span.
 */
export function FeedOrder({ events, scopeLabel }: FeedOrderProps) {
  const report = getFeedOrderReport(events);
  const scope = `${scopeLabel.charAt(0).toUpperCase()}${scopeLabel.slice(1)}`;
  const first = report.slots[0];
  const last = report.typicalCount > 0 ? report.slots[report.typicalCount - 1] : null;
  /** An offset on the track, read back as the time of day it stands for. */
  const clock = (offset: number) => formatMinutesOfDay(toClockMinutes(offset, report.dayStartMinutes));

  return (
    <section className="section-block" data-event="feed">
      <div className="section-heading">
        <h2>Feed order</h2>
        <span>{scopeLabel}</span>
      </div>

      {report.slots.length === 0 ? (
        <p>
          {report.loggedDays === 0
            ? `${scope}: no feeds logged.`
            : `${scope}: no day logged ${FEED_DAY_MIN_FEEDS}–${FEED_DAY_MAX_FEEDS} feeds, so there is no ordinary day to describe (${dayWord(
                report.loggedDays
              )} logged).`}
        </p>
      ) : (
        <>
          <p>
            {`${scope}: ${Number(report.feedsPerDay.toFixed(1))} feeds a day`}
            {first && `, starting around ${clock(first.averageOffset)}`}
            {last && last !== first && ` and reaching feed ${last.index} around ${clock(last.averageOffset)}`}.
          </p>
          <p className="feed-order-scope">
            {`${report.days} of ${dayWord(report.loggedDays)} · only days with ${FEED_DAY_MIN_FEEDS}–${FEED_DAY_MAX_FEEDS} feeds · day starts ${formatMinutesOfDay(
              report.dayStartMinutes
            )}`}
          </p>

          <ol className="feed-order-list">
            {report.slots.map((slot) => (
              <li className={`feed-order-row${slot.typical ? '' : ' sparse'}`} key={slot.index}>
                <div className="feed-order-head">
                  <span>Feed {slot.index}</span>
                  <strong>{clock(slot.averageOffset)}</strong>
                  <small>
                    {slot.averageGapMinutes !== null && `+${formatDuration(Math.round(slot.averageGapMinutes))} · `}
                    {dayWord(slot.days)}
                  </small>
                </div>
                <div
                  className="feed-order-track"
                  aria-label={`Feed ${slot.index} averages ${clock(slot.averageOffset)}, between ${clock(
                    slot.earliestOffset
                  )} and ${clock(slot.latestOffset)} across ${dayWord(slot.days)}`}
                >
                  <i
                    className="feed-order-span"
                    style={{
                      left: percent(slot.earliestOffset),
                      // A row that never varied would otherwise have no width at
                      // all, so the span floors at the width of its own mark.
                      width: `max(3px, ${percent(slot.latestOffset - slot.earliestOffset)})`
                    }}
                  />
                  <i className="feed-order-mark" style={{ left: percent(slot.averageOffset) }} />
                </div>
              </li>
            ))}
          </ol>

          <div className="feed-order-axis" aria-hidden="true">
            {AXIS_OFFSETS.map((offset) => (
              <span key={offset}>{clock(offset)}</span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
