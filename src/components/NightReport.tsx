import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  getBabyNight,
  getBabyNightsReport,
  getCurrentNightKey,
  NIGHT_START_HOUR,
  SETTLE_MINUTES,
  shiftNightKey,
  type BabyNight,
  type NightStat,
  type NightWake
} from '../domain/babyNights';
import type { DateRange } from '../domain/dateRange';
import { formatClock, formatDuration, getLocalDateKey } from '../domain/dates';
import type { NurseryData } from '../domain/nurserySensor';
import { careEventLabels, type CareEvent, type CareEventType } from '../domain/types';

interface NightReportProps {
  events: CareEvent[];
  /** The nights the averages cover — the Reports period. Null (the Day period) shows the one night only. */
  averageRange: DateRange | null;
  /** How the period names itself — "this week", "selected range". */
  scopeLabel: string;
  /** Reads the nursery sensor's tabs; absent or null means no sensor layer. */
  loadNursery?: () => Promise<NurseryData | null>;
  now?: Date;
}

const timeOf = (iso: string) => new Date(iso).getTime();

function formatNightLabel(dateKey: string) {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', weekday: 'short' }).format(new Date(`${dateKey}T12:00:00`));
}

const minutes = (value: number) => formatDuration(Math.round(value));
const durationRange = (stats: NightStat) => (Math.round(stats.min) === Math.round(stats.max) ? minutes(stats.min) : `${minutes(stats.min)}–${minutes(stats.max)}`);
const countRange = (stats: NightStat) => (stats.min === stats.max ? `${stats.min}` : `${stats.min}–${stats.max}`);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** A wake read aloud: "1:13 AM, Feeding, 45m up, heard". */
function describeWake(wake: NightWake) {
  const up = minutes((timeOf(wake.resumedAt) - timeOf(wake.startedAt)) / 60_000);
  return `${formatClock(wake.startedAt)}, ${wake.types.map((type) => careEventLabels[type]).join(' and ')}, ${up} up${wake.heard ? ', crying heard' : ''}`;
}

/** The night that opens first: last night all day, until tonight is well under way. */
function getDefaultNightKey(now: Date) {
  const current = getCurrentNightKey(now);
  return now.getHours() >= NIGHT_START_HOUR ? shiftNightKey(current, -1) : current;
}

/** Below this share of the track apart, two wake labels would overlap, so the second drops a row. */
const LABEL_GAP = 0.16;

/**
 * One night on a track from going down to getting up: sleep as bars (solid when
 * logged, hatched when worked out from the gaps), time awake as the breaks, each
 * logged entry as a dot in its own color, wake times under the track, and the
 * sensor's heard crying as ticks above it.
 */
function NightTrack({ night }: { night: BabyNight }) {
  const start = timeOf(night.startedAt);
  const length = timeOf(night.endedAt) - start;
  const share = (iso: string) => Math.min(1, Math.max(0, (timeOf(iso) - start) / length));
  const position = (iso: string) => `${share(iso) * 100}%`;
  const width = (from: string, to: string) => `max(2px, ${Math.max(0, ((timeOf(to) - timeOf(from)) / length) * 100)}%)`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((part) => new Date(start + part * length).toISOString());
  const wakes = [...night.wakes, ...night.edges].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const rowEnds = [-1, -1];
  const labels = night.wakes.map((wake) => {
    const at = share(wake.startedAt);
    const row = at - rowEnds[0] >= LABEL_GAP ? 0 : 1;
    rowEnds[row] = at;
    // Labels at either end hang inward rather than off the card.
    const align = at < 0.08 ? 'start' : at > 0.92 ? 'end' : 'middle';
    return { align, at, row, wake };
  });

  return (
    <div className="night-track-wrap">
      <div className="night-heard-row" aria-hidden="true">
        {night.heard.map((cry) => (
          <i
            className={`night-heard${cry.withWake ? '' : ' possible'}`}
            key={cry.startedAt}
            style={{ left: position(cry.startedAt), width: width(cry.startedAt, cry.endedAt) }}
          />
        ))}
      </div>
      <div
        className="night-track"
        role="img"
        aria-label={`${formatNightLabel(night.dateKey)}: ${minutes(night.sleepMinutes)} asleep, ${plural(night.wakes.length, 'wake')}${
          night.wakes.length > 0 ? `: ${night.wakes.map(describeWake).join('; ')}` : ''
        }`}
      >
        {night.sleeps.map((stretch) => (
          <i
            className={`night-sleep ${stretch.source}`}
            key={stretch.startedAt}
            style={{ left: position(stretch.startedAt), width: width(stretch.startedAt, stretch.endedAt) }}
          />
        ))}
        {wakes.map((wake) => (
          <i className="night-wake" key={wake.startedAt} style={{ left: position(wake.startedAt), width: width(wake.startedAt, wake.resumedAt) }} />
        ))}
        {wakes.flatMap((wake) =>
          wake.items.map((item) => (
            <i
              className="night-entry"
              data-event={item.type}
              key={`${item.startedAt}-${item.type}`}
              style={{ left: position(item.startedAt) }}
              title={`${formatClock(item.startedAt)} ${careEventLabels[item.type]}`}
            />
          ))
        )}
      </div>
      {labels.length > 0 && (
        <div className={`night-wake-labels${labels.some((label) => label.row === 1) ? ' two-rows' : ''}`} aria-hidden="true">
          {labels.map(({ align, at, row, wake }) => (
            <span className={`${align}${row === 1 ? ' lower' : ''}`} key={wake.startedAt} style={{ left: `${at * 100}%` }} title={describeWake(wake)}>
              {formatClock(wake.startedAt)}
            </span>
          ))}
        </div>
      )}
      <div className="night-axis" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick}>{formatClock(tick)}</span>
        ))}
      </div>
    </div>
  );
}

function SensorLine({ night, nursery }: { night: BabyNight; nursery: NurseryData | null }) {
  if (!nursery) {
    return null;
  }

  if (!night.sensor) {
    return <p className="night-note">Nursery sensor: not running this night.</p>;
  }

  const possible = night.heard.filter((cry) => !cry.withWake).length;

  return (
    <p className="night-note">
      Nursery sensor: {night.heard.length === 0 ? 'no crying heard overnight' : `crying heard ${night.heard.length === 1 ? 'once' : `${night.heard.length} times`} overnight`}
      {possible > 0 && ` (${possible} with nothing logged, outlined — a possible wake, not counted)`}
      {' · '}
      {/* The phone measures its own noon-to-noon day, not this 7pm–7am window. */}
      listening {Math.round(night.sensor.coveragePercent)}% of noon to noon
    </p>
  );
}

/** The entry colors this night's dots use, for the legend. */
function entryTypes(night: BabyNight): CareEventType[] {
  return [...new Set([...night.wakes, ...night.edges].flatMap((wake) => wake.types))].sort();
}

/**
 * The Reports "Nights" section: one night at a time — sleep windows, wakes and
 * what the nursery sensor heard, all on one track — plus averages over the
 * nights of the selected Reports period. See `domain/babyNights.ts` for how a
 * night is read.
 */
export function NightReport({ averageRange, events, loadNursery, now: fixedNow, scopeLabel }: NightReportProps) {
  const now = fixedNow ?? new Date();
  const [nursery, setNursery] = useState<NurseryData | null>(null);
  const [nightKey, setNightKey] = useState(() => getDefaultNightKey(now));

  useEffect(() => {
    let current = true;

    loadNursery?.()
      .then((data) => {
        if (current) {
          setNursery(data);
        }
      })
      .catch(() => undefined);

    return () => {
      current = false;
    };
  }, [loadNursery]);

  const latestKey = getCurrentNightKey(now);
  const earliestEvent = events.reduce<string | null>((earliest, event) => (!earliest || event.startedAt < earliest ? event.startedAt : earliest), null);
  const earliestKey = earliestEvent ? shiftNightKey(getLocalDateKey(earliestEvent), -1) : latestKey;
  const night = getBabyNight(events, nightKey, nursery, now);
  const report = averageRange ? getBabyNightsReport(events, nursery, averageRange, now) : null;

  return (
    <section className="section-block night-report" data-event="sleep">
      <div className="section-heading">
        <h2>Nights</h2>
        <span>7 PM – 7 AM</span>
      </div>

      <div className="night-nav">
        <button
          aria-label="Previous night"
          className="icon-button"
          disabled={nightKey <= earliestKey}
          type="button"
          onClick={() => setNightKey(shiftNightKey(nightKey, -1))}
        >
          <ChevronLeft />
        </button>
        <div>
          <strong>{formatNightLabel(nightKey)}</strong>
          <small>{night.inProgress ? 'In progress' : nightKey === getDefaultNightKey(now) ? 'Last night' : 'Night of'}</small>
        </div>
        <button
          aria-label="Next night"
          className="icon-button"
          disabled={nightKey >= latestKey}
          type="button"
          onClick={() => setNightKey(shiftNightKey(nightKey, 1))}
        >
          <ChevronRight />
        </button>
      </div>

      {!night.tracked ? (
        <p className="empty-state compact">Nothing logged around this night.</p>
      ) : (
        <>
          <NightTrack night={night} />
          <div className="night-legend" aria-hidden="true">
            <span><i className="night-sleep logged" />Logged sleep</span>
            <span><i className="night-sleep estimated" />Estimated</span>
            <span><i className="night-wake" />Awake</span>
            {entryTypes(night).map((type) => (
              <span key={type}><i className="night-entry" data-event={type} />{careEventLabels[type]}</span>
            ))}
            {nursery && <span><i className="night-heard" />Crying heard</span>}
          </div>

          <div className="metric-grid report-grid" aria-label="This night">
            <article className="metric-card" data-event="sleep">
              <span>Asleep</span>
              <strong>{minutes(night.sleepMinutes)}</strong>
              <small>{night.estimated ? 'estimated' : 'logged'}{night.inProgress ? ' · so far' : ''}</small>
            </article>
            <article className="metric-card" data-event="sleep">
              <span>Wakes</span>
              <strong>{night.wakes.length}</strong>
              <small>{night.wakes.some((wake) => wake.heard) ? `${night.wakes.filter((wake) => wake.heard).length} heard by sensor` : 'from logged entries'}</small>
            </article>
            <article className="metric-card" data-event="sleep">
              <span>Longest sleep</span>
              <strong>{night.longestStretchMinutes > 0 ? minutes(night.longestStretchMinutes) : '—'}</strong>
              <small>this night</small>
            </article>
            <article className="metric-card" data-event="sleep">
              <span>Bedtime</span>
              <strong>{night.bedtime ? formatClock(night.bedtime) : '—'}</strong>
              <small>{night.bedtime ? 'logged sleep' : 'not logged'}</small>
            </article>
          </div>
        </>
      )}

      <SensorLine night={night} nursery={nursery} />

      {report && (
        <>
          <div className="section-heading night-span-heading">
            <h3>Averages</h3>
            <span>{scopeLabel}</span>
          </div>

          {report.nights.length === 0 ? (
            <p className="empty-state compact">No finished night logged {scopeLabel === 'selected range' ? 'in the selected range' : scopeLabel}.</p>
          ) : (
            <>
              <div className="metric-grid report-grid" aria-label={`Night averages ${scopeLabel}`}>
                <article className="metric-card" data-event="sleep">
                  <span>Night sleep</span>
                  <strong>{report.sleepMinutes ? minutes(report.sleepMinutes.average) : '—'}</strong>
                  {report.sleepMinutes && <small>{durationRange(report.sleepMinutes)} range</small>}
                </article>
                <article className="metric-card" data-event="sleep">
                  <span>Wakes/night</span>
                  <strong>{report.wakes ? Number(report.wakes.average.toFixed(1)) : '—'}</strong>
                  {report.wakes && <small>{countRange(report.wakes)} range</small>}
                </article>
                <article className="metric-card" data-event="sleep">
                  <span>Longest stretch</span>
                  <strong>{report.longestStretchMinutes ? minutes(report.longestStretchMinutes.average) : '—'}</strong>
                  {report.longestStretchMinutes && <small>best {minutes(report.longestStretchMinutes.max)}</small>}
                </article>
                <article className="metric-card" data-event="sleep">
                  <span>Naps/day</span>
                  <strong>{report.napMinutes ? minutes(report.napMinutes.average) : '—'}</strong>
                  <small>{report.napMinutes ? `${durationRange(report.napMinutes)} range` : 'no naps logged'}</small>
                </article>
              </div>
              <p className="night-note">
                {report.nights.length} of {plural(report.span, 'night')} logged
                {report.estimatedNights > 0 && ` · ${report.estimatedNights} with sleep estimated`}
              </p>
            </>
          )}
        </>
      )}

      <p className="night-note">
        Wakes are night feeds, changes and meds logged within 30 minutes of each other. Sleep not logged as a sleep entry is
        estimated: the time between wakes, less {SETTLE_MINUTES} minutes to settle. The sensor only hears what reaches the phone, so
        its crying marks are suggestions and never change these numbers.
      </p>
    </section>
  );
}
