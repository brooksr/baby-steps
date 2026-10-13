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
  type NightStat
} from '../domain/babyNights';
import { formatClock, formatDuration, getLocalDateKey } from '../domain/dates';
import type { NurseryData } from '../domain/nurserySensor';
import { careEventLabels, type CareEvent } from '../domain/types';

const SPANS = [7, 14, 30] as const;
type Span = (typeof SPANS)[number];

interface NightReportProps {
  events: CareEvent[];
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

/** The night that opens first: last night all day, until tonight is well under way. */
function getDefaultNightKey(now: Date) {
  const current = getCurrentNightKey(now);
  return now.getHours() >= NIGHT_START_HOUR ? shiftNightKey(current, -1) : current;
}

/**
 * One night on a track from going down to getting up: sleep as bars (solid when
 * logged, hatched when worked out from the gaps), wakes as the breaks between
 * them, and the sensor's heard crying as ticks above the track.
 */
function NightTrack({ night }: { night: BabyNight }) {
  const start = timeOf(night.startedAt);
  const length = timeOf(night.endedAt) - start;
  const position = (iso: string) => `${Math.min(100, Math.max(0, ((timeOf(iso) - start) / length) * 100))}%`;
  const width = (from: string, to: string) => `max(2px, ${Math.max(0, ((timeOf(to) - timeOf(from)) / length) * 100)}%)`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((share) => new Date(start + share * length).toISOString());

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
      <div className="night-track" role="img" aria-label={`${formatNightLabel(night.dateKey)}: ${minutes(night.sleepMinutes)} asleep, ${plural(night.wakes.length, 'wake')}`}>
        {night.sleeps.map((stretch) => (
          <i
            className={`night-sleep ${stretch.source}`}
            key={stretch.startedAt}
            style={{ left: position(stretch.startedAt), width: width(stretch.startedAt, stretch.endedAt) }}
          />
        ))}
        {[...night.wakes, ...night.edges].map((wake) => (
          <i className="night-wake" key={wake.startedAt} style={{ left: position(wake.startedAt), width: width(wake.startedAt, wake.resumedAt) }} />
        ))}
      </div>
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

  const possible = night.heard.filter((cry) => !cry.withWake);

  return (
    <>
      <p className="night-note">
        Nursery sensor: {night.heard.length === 0 ? 'no crying heard overnight' : `crying heard ${night.heard.length === 1 ? 'once' : `${night.heard.length} times`} overnight`}
        {' · '}
        {/* The phone measures its own noon-to-noon day, not this 7pm–7am window. */}
        listening {Math.round(night.sensor.coveragePercent)}% of noon to noon
      </p>
      {possible.length > 0 && (
        <p className="night-note">
          Possible {possible.length === 1 ? 'wake' : 'wakes'} with nothing logged: {possible.map((cry) => formatClock(cry.startedAt)).join(', ')}. These are suggestions from the sensor, not counted
          above.
        </p>
      )}
    </>
  );
}

/**
 * The Reports "Nights" section: one night at a time — sleep windows, wakes and
 * what the nursery sensor heard — plus averages over the last 7, 14 or 30
 * finished nights. See `domain/babyNights.ts` for how a night is read.
 */
export function NightReport({ events, loadNursery, now: fixedNow }: NightReportProps) {
  const now = fixedNow ?? new Date();
  const [nursery, setNursery] = useState<NurseryData | null>(null);
  const [nightKey, setNightKey] = useState(() => getDefaultNightKey(now));
  const [span, setSpan] = useState<Span>(7);

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
  const report = getBabyNightsReport(events, nursery, span, now);

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
              <small>{night.wakes.filter((wake) => wake.heard).length > 0 ? `${night.wakes.filter((wake) => wake.heard).length} heard by sensor` : 'from logged entries'}</small>
            </article>
            <article className="metric-card" data-event="sleep">
              <span>Longest stretch</span>
              <strong>{night.longestStretchMinutes > 0 ? minutes(night.longestStretchMinutes) : '—'}</strong>
            </article>
            <article className="metric-card" data-event="sleep">
              <span>Bedtime</span>
              <strong>{night.bedtime ? formatClock(night.bedtime) : '—'}</strong>
              <small>{night.bedtime ? 'logged sleep' : 'not logged'}</small>
            </article>
          </div>

          {night.wakes.length > 0 && (
            <ol className="night-wakes" aria-label="Wakes">
              {night.wakes.map((wake) => (
                <li key={wake.startedAt}>
                  <strong>{formatClock(wake.startedAt)}</strong>
                  <span>{wake.types.map((type) => careEventLabels[type]).join(', ')}</span>
                  <small>
                    {minutes((timeOf(wake.resumedAt) - timeOf(wake.startedAt)) / 60_000)} up
                    {wake.heard ? ' · heard' : ''}
                  </small>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      <SensorLine night={night} nursery={nursery} />

      <div className="section-heading night-span-heading">
        <h3>Averages</h3>
        <div className="segmented-control night-span-control" aria-label="Nights averaged">
          {SPANS.map((option) => (
            <button aria-pressed={span === option} className={span === option ? 'active' : ''} key={option} type="button" onClick={() => setSpan(option)}>
              {option} nights
            </button>
          ))}
        </div>
      </div>

      {report.nights.length === 0 ? (
        <p className="empty-state compact">No finished night logged in the last {span}.</p>
      ) : (
        <>
          <div className="metric-grid report-grid" aria-label={`Averages over the last ${span} nights`}>
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
            {report.nights.length} of {span} nights logged
            {report.estimatedNights > 0 && ` · ${report.estimatedNights} with sleep estimated`}
          </p>
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
