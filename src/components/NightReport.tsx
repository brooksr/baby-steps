import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  getBabyDay,
  getBabyNight,
  getBabyNightsReport,
  getCurrentNightKey,
  NIGHT_START_HOUR,
  SETTLE_MINUTES,
  shiftNightKey,
  type BabyDay,
  type BabyNight,
  type HeardCry,
  type NightStat,
  type NightWake,
  type SleepStretch
} from '../domain/babyNights';
import { describeCryContext, getCryContext, isCryMarked, toCryMood, type MarkedCry } from '../domain/cryContext';
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
  /** Opens the sleep form on one estimated stretch. Absent, the track is read-only. */
  onLogSleep?: (sleep: UnloggedSleep) => void;
  /** Logs every estimated stretch of the night as it stands. */
  onLogSleeps?: (sleeps: UnloggedSleep[]) => Promise<void>;
  /** Records heard crying as Crying in Mood. Absent, the crying is only shown. */
  onMarkCries?: (cries: MarkedCry[]) => Promise<void>;
  now?: Date;
}

export type UnloggedSleep = SleepStretch['unlogged'][number];


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
/** A bar narrower than this share of the track has no room for its length. */
const DURATION_MIN_SHARE = 0.09;

interface TrackLabel {
  at: number;
  key: string;
  text: string;
  title?: string;
}

/** Labels under the track: a second row for one too close to the last, and the ends hung inward. */
function layoutLabels(labels: TrackLabel[]) {
  const rowEnds = [-1, -1];

  return labels.map((label) => {
    const row = label.at - rowEnds[0] >= LABEL_GAP ? 0 : 1;
    rowEnds[row] = label.at;
    const align = label.at < 0.08 ? 'start' : label.at > 0.92 ? 'end' : 'middle';
    return { ...label, align, row };
  });
}

function LabelRow({ className, labels }: { className: string; labels: TrackLabel[] }) {
  if (labels.length === 0) {
    return null;
  }

  const placed = layoutLabels(labels);

  return (
    <div className={`night-labels ${className}${placed.some((label) => label.row === 1) ? ' two-rows' : ''}`} aria-hidden="true">
      {placed.map(({ align, at, key, row, text, title }) => (
        <span className={`${align}${row === 1 ? ' lower' : ''}`} key={key} style={{ left: `${at * 100}%` }} title={title}>
          {text}
        </span>
      ))}
    </div>
  );
}

function describeSleep(sleep: UnloggedSleep) {
  return sleep.endedAt ? `${formatClock(sleep.startedAt)}–${formatClock(sleep.endedAt)}` : `from ${formatClock(sleep.startedAt)}, still asleep`;
}

interface TrackMark {
  startedAt: string;
  endedAt: string;
}

interface TrackProps {
  /** The track's accessible name: what it shows, read aloud. */
  label: string;
  startedAt: string;
  endedAt: string;
  /** `day` draws awake as the ground and sleep as the marks, the other way round from a night. */
  variant: 'day' | 'night';
  sleeps: SleepStretch[];
  /** Time awake drawn as breaks in the night. */
  awake: TrackMark[];
  items: Array<{ startedAt: string; type: CareEventType }>;
  heard: HeardCry[];
  /** Times under the track, below the sleep starts: the night's wakes. */
  wakeLabels?: Array<{ startedAt: string; title: string }>;
  /** Spans that can be logged as sleep, laid over the track as buttons. */
  targets: Array<{ name: string; part: UnloggedSleep }>;
  onLog?: (sleep: UnloggedSleep) => void;
  selectedCry: string | null;
  onSelectCry?: (startedAt: string) => void;
}

/**
 * A night or a day on one track: sleep as bars (solid when logged, hatched when
 * worked out from the gaps), each with its length in the middle and its start
 * underneath; time awake as the breaks; each logged entry as a dot in its own
 * color; and the sensor's heard crying as ticks above, each one tappable.
 */
function Track({ awake, endedAt, heard, items, label, onLog, onSelectCry, selectedCry, sleeps, startedAt, targets, variant, wakeLabels = [] }: TrackProps) {
  const start = timeOf(startedAt);
  const length = Math.max(1, timeOf(endedAt) - start);
  const share = (iso: string) => Math.min(1, Math.max(0, (timeOf(iso) - start) / length));
  const position = (iso: string) => `${share(iso) * 100}%`;
  const width = (from: string, to: string) => `max(2px, ${Math.max(0, ((timeOf(to) - timeOf(from)) / length) * 100)}%)`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((part) => new Date(start + part * length).toISOString());
  const sleepLabels = sleeps.map((stretch) => ({
    at: share(stretch.startedAt),
    key: stretch.startedAt,
    text: formatClock(stretch.startedAt),
    title: `Asleep ${formatClock(stretch.startedAt)}, ${minutes(stretch.minutes)}`
  }));

  return (
    <div className={`night-track-wrap ${variant}`}>
      <div className="night-heard-row">
        {heard.map((cry) => {
          const style = { left: position(cry.startedAt), width: width(cry.startedAt, cry.endedAt) };
          const className = `night-heard${cry.withWake ? '' : ' possible'}${selectedCry === cry.startedAt ? ' selected' : ''}`;
          return onSelectCry ? (
            <button
              aria-label={`Crying heard ${formatClock(cry.startedAt)}`}
              aria-pressed={selectedCry === cry.startedAt}
              className={className}
              key={cry.startedAt}
              style={style}
              type="button"
              onClick={() => onSelectCry(cry.startedAt)}
            />
          ) : (
            <i aria-hidden="true" className={className} key={cry.startedAt} style={style} />
          );
        })}
      </div>
      <div className="night-track-stack">
        <div className={`night-track ${variant}`} role="img" aria-label={label}>
          {sleeps.map((stretch) => (
            <i
              className={`night-sleep ${stretch.source}`}
              key={stretch.startedAt}
              style={{ left: position(stretch.startedAt), width: width(stretch.startedAt, stretch.endedAt) }}
            />
          ))}
          {awake.map((mark) => (
            <i className="night-wake" key={mark.startedAt} style={{ left: position(mark.startedAt), width: width(mark.startedAt, mark.endedAt) }} />
          ))}
          {items.map((item) => (
            <i
              className="night-entry"
              data-event={item.type}
              key={`${item.startedAt}-${item.type}`}
              style={{ left: position(item.startedAt) }}
              title={`${formatClock(item.startedAt)} ${careEventLabels[item.type]}`}
            />
          ))}
        </div>
        {/* Above the track's picture: each bar's length, and what can be logged as buttons. */}
        <div className="night-track-layer">
          {sleeps
            .filter((stretch) => share(stretch.endedAt) - share(stretch.startedAt) >= DURATION_MIN_SHARE)
            .map((stretch) => (
              <span
                aria-hidden="true"
                className="night-sleep-length"
                key={stretch.startedAt}
                style={{ left: position(stretch.startedAt), width: width(stretch.startedAt, stretch.endedAt) }}
              >
                <b>{minutes(stretch.minutes)}</b>
              </span>
            ))}
          {onLog &&
            targets.map(({ name, part }) => (
              <button
                aria-label={name}
                className={variant === 'day' ? 'night-opening' : 'night-sleep-log'}
                key={part.startedAt}
                style={{ left: position(part.startedAt), width: width(part.startedAt, part.endedAt ?? endedAt) }}
                title={name}
                type="button"
                onClick={() => onLog(part)}
              />
            ))}
        </div>
      </div>
      <LabelRow className="night-sleep-labels" labels={sleepLabels} />
      <LabelRow
        className="night-wake-labels"
        labels={wakeLabels.map((wake) => ({ at: share(wake.startedAt), key: wake.startedAt, text: formatClock(wake.startedAt), title: wake.title }))}
      />
      <div className="night-axis" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick}>{formatClock(tick)}</span>
        ))}
      </div>
    </div>
  );
}

function NightTrack({ night, ...rest }: { night: BabyNight; onLog?: (sleep: UnloggedSleep) => void; onSelectCry?: (startedAt: string) => void; selectedCry: string | null }) {
  const wakes = [...night.wakes, ...night.edges].sort((left, right) => left.startedAt.localeCompare(right.startedAt));

  return (
    <Track
      {...rest}
      awake={wakes.map((wake) => ({ endedAt: wake.resumedAt, startedAt: wake.startedAt }))}
      endedAt={night.endedAt}
      heard={night.heard}
      items={wakes.flatMap((wake) => wake.items)}
      label={`${formatNightLabel(night.dateKey)}: ${minutes(night.sleepMinutes)} asleep, ${plural(night.wakes.length, 'wake')}${
        night.wakes.length > 0 ? `: ${night.wakes.map(describeWake).join('; ')}` : ''
      }`}
      sleeps={night.sleeps}
      startedAt={night.startedAt}
      targets={night.sleeps.flatMap((stretch) => stretch.unlogged.map((part) => ({ name: `Log estimated sleep ${describeSleep(part)}`, part })))}
      variant="night"
      wakeLabels={night.wakes.map((wake) => ({ startedAt: wake.startedAt, title: describeWake(wake) }))}
    />
  );
}

function describeNap(opening: UnloggedSleep) {
  return opening.endedAt ? `${formatClock(opening.startedAt)}–${formatClock(opening.endedAt)}` : `from ${formatClock(opening.startedAt)}`;
}

function DayTrack({ day, ...rest }: { day: BabyDay; onLog?: (sleep: UnloggedSleep) => void; onSelectCry?: (startedAt: string) => void; selectedCry: string | null }) {
  return (
    <Track
      {...rest}
      awake={[]}
      endedAt={day.endedAt}
      heard={day.heard}
      items={day.items}
      label={`${formatNightLabel(day.dateKey)} day: ${plural(day.naps.length, 'nap')}${day.naps.length > 0 ? `, ${minutes(day.napMinutes)}` : ''}${
        day.naps.length > 0 ? `: ${day.naps.map((nap) => `${formatClock(nap.startedAt)} for ${minutes(nap.minutes)}`).join('; ')}` : ''
      }`}
      sleeps={day.naps}
      startedAt={day.startedAt}
      targets={day.openings.map((part) => ({ name: `Log a nap ${describeNap(part)}`, part }))}
      variant="day"
    />
  );
}

function formatCryLength(cry: HeardCry) {
  const seconds = Math.max(1, Math.round((timeOf(cry.endedAt) - timeOf(cry.startedAt)) / 1000));
  return seconds < 60 ? `${seconds}s` : minutes(seconds / 60);
}

interface CryPanelProps {
  cries: HeardCry[];
  events: CareEvent[];
  onMark?: (cries: MarkedCry[]) => Promise<void>;
  onSelect: (startedAt: string) => void;
  selected: string | null;
}

/**
 * Every bout the sensor heard across the night and the day, each one a chip:
 * tap for what the log says around it, and mark one or all of them as Crying in
 * Mood. The context is the log's, never a cause — see `domain/cryContext.ts`.
 */
function CryPanel({ cries, events, onMark, onSelect, selected }: CryPanelProps) {
  const [marking, setMarking] = useState(false);

  if (cries.length === 0) {
    return null;
  }

  const unmarked = cries.filter((cry) => !isCryMarked(cry, events));
  const current = cries.find((cry) => cry.startedAt === selected);
  const context = current ? describeCryContext(getCryContext(events, current.startedAt)) : [];

  async function mark(toMark: HeardCry[]) {
    setMarking(true);

    try {
      await onMark?.(toMark.map((cry) => toCryMood(cry, events)));
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="cry-panel">
      <div className="cry-panel-head">
        <strong>Crying heard</strong>
        {onMark && unmarked.length > 0 && (
          <button className="secondary-button" disabled={marking} type="button" onClick={() => void mark(unmarked)}>
            {marking ? 'Marking…' : unmarked.length === cries.length ? `Mark all ${unmarked.length} in Mood` : `Mark ${unmarked.length} more in Mood`}
          </button>
        )}
      </div>
      <div className="cry-chips">
        {cries.map((cry) => {
          const marked = isCryMarked(cry, events);
          return (
            <button
              aria-pressed={cry.startedAt === selected}
              className={`cry-chip${marked ? ' marked' : ''}${cry.withWake ? '' : ' possible'}`}
              key={cry.startedAt}
              type="button"
              onClick={() => onSelect(cry.startedAt)}
            >
              {formatClock(cry.startedAt)} · {formatCryLength(cry)}
              {marked && <Check aria-label="in Mood" />}
            </button>
          );
        })}
      </div>
      {current && (
        <div className="cry-detail">
          <p>
            <strong>
              {formatClock(current.startedAt)}–{formatClock(current.endedAt)}
            </strong>
            {' · '}
            {plural(current.episodes, 'episode')}
            {current.withWake ? ' · with a logged wake' : ' · nothing logged near it'}
          </p>
          {context.length > 0 ? (
            <ul className="cry-clues">
              {context.map((phrase) => (
                <li className={phrase.due ? 'due' : undefined} key={phrase.text}>
                  {phrase.text}
                  {phrase.due && <small> — past the usual gap</small>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="night-note">Nothing logged before it to go on.</p>
          )}
          {onMark &&
            (isCryMarked(current, events) ? (
              <p className="night-note">In Mood as crying.</p>
            ) : (
              <button className="secondary-button" disabled={marking} type="button" onClick={() => void mark([current])}>
                Mark in Mood
              </button>
            ))}
        </div>
      )}
      <p className="night-note">
        The sensor hears that a baby cried, not why. These are what was logged around it: pain, illness, a room too warm or cold,
        overstimulation or wanting company leave nothing in a log, so the baby is the one to check.
      </p>
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
export function NightReport({ averageRange, events, loadNursery, now: fixedNow, onLogSleep, onLogSleeps, onMarkCries, scopeLabel }: NightReportProps) {
  const now = fixedNow ?? new Date();
  const [nursery, setNursery] = useState<NurseryData | null>(null);
  const [logging, setLogging] = useState(false);
  const [nightKey, setNightKeyState] = useState(() => getDefaultNightKey(now));
  const [selectedCry, setSelectedCry] = useState<string | null>(null);
  const setNightKey = (key: string) => {
    setNightKeyState(key);
    setSelectedCry(null);
  };
  const selectCry = (startedAt: string) => setSelectedCry((current) => (current === startedAt ? null : startedAt));

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
  const day = getBabyDay(events, nightKey, nursery, now);
  const dayTracked = !day.upcoming && (day.items.length > 0 || day.naps.length > 0);
  const report = averageRange ? getBabyNightsReport(events, nursery, averageRange, now) : null;
  // A stretch still going is left to the form: logged in bulk it would be a
  // sleep still running when the baby may be up.
  const toLog = night.sleeps.flatMap((stretch) => stretch.unlogged).filter((part) => part.endedAt);

  async function logAll() {
    setLogging(true);

    try {
      await onLogSleeps?.(toLog);
    } finally {
      setLogging(false);
    }
  }

  return (
    <section className="section-block night-report" data-event="sleep">
      <div className="section-heading">
        <h2>Night &amp; Day</h2>
        <span>7 PM – 7 AM – 7 PM</span>
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
          <NightTrack night={night} onLog={onLogSleep} onSelectCry={selectCry} selectedCry={selectedCry} />
          <div className="night-legend" aria-hidden="true">
            <span><i className="night-sleep logged" />Logged sleep</span>
            <span><i className="night-sleep estimated" />Estimated</span>
            <span><i className="night-wake" />Awake</span>
            {entryTypes(night).map((type) => (
              <span key={type}><i className="night-entry" data-event={type} />{careEventLabels[type]}</span>
            ))}
            {nursery && <span><i className="night-heard" />Crying heard</span>}
            {onLogSleep && dayTracked && day.openings.length > 0 && <span><i className="night-opening" />Room for a nap</span>}
          </div>

          {onLogSleeps && toLog.length > 0 && (
            <div className="night-log-row">
              <button className="secondary-button" disabled={logging} type="button" onClick={() => void logAll()}>
                {logging ? 'Logging…' : `Log ${plural(toLog.length, 'estimated sleep')}`}
              </button>
              <small>or tap a hatched bar to log just that one</small>
            </div>
          )}

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

      <div className="section-heading night-span-heading">
        <h3>Day</h3>
        <span>{formatNightLabel(day.dateKey)}</span>
      </div>
      {day.upcoming ? (
        <p className="empty-state compact">Starts when the night ends.</p>
      ) : !dayTracked ? (
        <p className="empty-state compact">Nothing logged this day{day.inProgress ? ' yet' : ''}.</p>
      ) : (
        <>
          <DayTrack day={day} onLog={onLogSleep} onSelectCry={selectCry} selectedCry={selectedCry} />
          <p className="night-note">
            {day.naps.length === 0
              ? 'No naps logged'
              : `${plural(day.naps.length, 'nap')} · ${minutes(day.napMinutes)} in all · longest ${minutes(day.longestNapMinutes)}`}
            {day.inProgress ? ' so far' : ''}
            {onLogSleep && day.openings.length > 0 ? ' · tap a dashed gap to log a nap' : ''}
          </p>
        </>
      )}

      <CryPanel cries={[...night.heard, ...day.heard]} events={events} onMark={onMarkCries} onSelect={selectCry} selected={selectedCry} />

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
        estimated: the time between wakes, less {SETTLE_MINUTES} minutes to settle. Crying the sensor heard is taken out of estimated
        sleep the same way, but it never adds a wake or changes a logged sleep: the sensor only hears what reaches the phone.
      </p>
    </section>
  );
}
