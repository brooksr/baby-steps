import { Bed, Calendar, CircleAlert, FileText, Moon, Pill, Smile, Thermometer, Waves } from 'lucide-react';
import { cyclePhaseLabels, getCycleToday } from '../domain/cycle';
import { formatAgo, formatClock, formatDuration, formatShortDate, getLocalDateKey } from '../domain/dates';
import { getFirstName, tracksCycle } from '../domain/family';
import { getParentReport } from '../domain/parentReport';
import { getLastEvent } from '../domain/summary';
import { formatTemperature } from '../domain/temperature';
import { type ActiveTimers, formatElapsed, getElapsedSeconds, isTimerType } from '../domain/timers';
import type { BabyProfile, CareEvent, CareEventType, TemperatureEvent } from '../domain/types';
import { getPreferredUnits } from '../domain/units';
import { Timeline } from './Timeline';

interface ParentDashboardProps {
  activeTimers: ActiveTimers;
  /** The parent's own entries. */
  events: CareEvent[];
  /** Every child's entries — without them a broken night reads as an unbroken one. */
  childEvents: CareEvent[];
  profile: BabyProfile;
  todayKey: string;
  onAdd: (type: CareEventType) => void;
}

/**
 * What a parent actually logs about themselves. Feeds, diapers and growth are
 * the baby's — they stay on the baby's Home rather than being offered here
 * against the wrong person.
 */
const actions = [
  { icon: Bed, label: 'Sleep', type: 'sleep' },
  { icon: Smile, label: 'Mood', type: 'mood' },
  { icon: Thermometer, label: 'Temp', type: 'temperature' },
  { icon: Pill, label: 'Med', type: 'medication' },
  { icon: Calendar, label: 'Visit', type: 'appointment' },
  { icon: FileText, label: 'Note', type: 'note' }
] satisfies Array<{ icon: typeof Bed; label: string; type: CareEventType }>;

/** How a cycle day reads once the predicted date has gone by. */
function formatDueIn(days: number) {
  if (days > 1) {
    return `in ${days} days`;
  }

  if (days === 1) {
    return 'tomorrow';
  }

  if (days === 0) {
    return 'today';
  }

  return `${Math.abs(days)} day${days === -1 ? '' : 's'} late`;
}

export function ParentDashboard({ activeTimers, childEvents, events, profile, todayKey, onAdd }: ParentDashboardProps) {
  const firstName = getFirstName(profile);
  const preferredUnits = getPreferredUnits(profile);
  const showsCycle = tracksCycle(profile);
  const cycle = showsCycle ? getCycleToday(events) : null;
  const report = getParentReport(events, childEvents, profile.id);
  const lastNight = report.nights[report.nights.length - 1];
  // Last night is the night keyed to yesterday evening — today's key only
  // appears once tonight's sleep has been logged.
  const lastNightIsRecent = Boolean(lastNight && lastNight.dateKey >= getLocalDateKey(new Date(Date.now() - 86_400_000)));
  const lastSleep = getLastEvent(events, (event) => event.type === 'sleep');
  const lastTemperature = events
    .filter((event): event is TemperatureEvent => event.type === 'temperature')
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
  const todayEvents = events.filter((event) => getLocalDateKey(event.startedAt) === todayKey);

  return (
    <main className="view-stack">
      <section className="profile-band">
        <div className="profile-band-top">
          <div>
            <p className="eyebrow">{profile.name}</p>
            <h1 className="age-headline">
              {lastNightIsRecent && lastNight ? formatDuration(lastNight.sleepMinutes) : '—'}
            </h1>
            <p>{lastNightIsRecent && lastNight ? `slept last night · ${lastNight.interruptions} interruption${lastNight.interruptions === 1 ? '' : 's'}` : 'no sleep logged yet'}</p>
          </div>
        </div>

        <div className="hero-metrics">
          <div className="hero-metric">
            <span>Last sleep</span>
            <strong>{lastSleep ? formatAgo(lastSleep.startedAt) : 'None'}</strong>
            <small>{lastSleep ? formatClock(lastSleep.startedAt) : 'Nothing logged yet'}</small>
          </div>
          <div className="hero-metric">
            <span>{showsCycle ? 'Cycle day' : 'Nights logged'}</span>
            <strong>{showsCycle ? (cycle ? cycle.dayOfCycle : '—') : report.nights.length}</strong>
            <small>
              {showsCycle
                ? cycle
                  ? cyclePhaseLabels[cycle.phase]
                  : 'No period logged yet'
                : report.averageSleepMinutes != null
                  ? `${formatDuration(report.averageSleepMinutes)} average`
                  : 'Nothing logged yet'}
            </small>
          </div>
        </div>
      </section>

      <section className="quick-grid" aria-label="Quick add">
        {(showsCycle ? [...actions, { icon: Waves, label: 'Period', type: 'menses' as CareEventType }] : actions).map((action) => {
          const Icon = action.icon;
          const timer = isTimerType(action.type) ? activeTimers[action.type] : undefined;
          const elapsed = timer ? getElapsedSeconds(timer.startedAt) : null;

          return (
            <button
              className={`quick-button${timer ? ' timer-active' : ''}`}
              type="button"
              key={action.type}
              data-event={action.type}
              onClick={() => onAdd(action.type)}
            >
              <Icon aria-hidden="true" />
              <span>{action.label}</span>
              {elapsed !== null && <span className="quick-timer">{formatElapsed(elapsed)}</span>}
            </button>
          );
        })}
      </section>

      {showsCycle && cycle?.prediction && (
        <section className="status-list" aria-label="Cycle">
          <article className="status-row">
            <Waves aria-hidden="true" />
            <div>
              <strong>
                Period {cycle.daysUntilNextPeriod != null ? formatDueIn(cycle.daysUntilNextPeriod) : 'due'} ·{' '}
                {formatShortDate(`${cycle.prediction.nextPeriodKey}T12:00:00`)}
              </strong>
              <span>
                {formatShortDate(`${cycle.prediction.windowStartKey}T12:00:00`)}–
                {formatShortDate(`${cycle.prediction.windowEndKey}T12:00:00`)} · {cycle.prediction.basis} ·{' '}
                {cycle.prediction.confidence} confidence
              </span>
            </div>
          </article>
          <article className="status-row gentle">
            <Moon aria-hidden="true" />
            <div>
              <strong>
                Fertile window {formatShortDate(`${cycle.prediction.fertileStartKey}T12:00:00`)}–
                {formatShortDate(`${cycle.prediction.fertileEndKey}T12:00:00`)}
              </strong>
              <span>
                Ovulation estimated {formatShortDate(`${cycle.prediction.ovulationKey}T12:00:00`)} — an estimate from
                logged dates, not contraception and not a fertility test.
              </span>
            </div>
          </article>
        </section>
      )}

      {showsCycle && !cycle?.prediction && (
        <p className="field-note">
          Log the days of a period and BabySteps works out the cycle. It needs two cycles before it will estimate the
          next one — until then it stays quiet rather than guessing.
        </p>
      )}

      <section className="metric-grid status-grid" aria-label="Recent sleep">
        <article className="metric-card">
          <span>Sleep/night</span>
          <strong>{report.averageSleepMinutes != null ? formatDuration(report.averageSleepMinutes) : '—'}</strong>
          <small>{report.nights.length > 0 ? `over ${report.nights.length} night${report.nights.length === 1 ? '' : 's'}` : 'Nothing logged yet'}</small>
        </article>
        <article className="metric-card">
          <span>Longest stretch</span>
          <strong>{report.averageLongestStretchMinutes != null ? formatDuration(report.averageLongestStretchMinutes) : '—'}</strong>
          <small>average</small>
        </article>
        <article className="metric-card">
          <span>Wake-ups</span>
          <strong>{report.averageInterruptions != null ? report.averageInterruptions : '—'}</strong>
          <small>per night</small>
        </article>
      </section>

      {lastTemperature && (
        <section className="status-list" aria-label="Temperature">
          <article className="status-row">
            <CircleAlert aria-hidden="true" />
            <div>
              <strong>Last temperature — {formatTemperature(lastTemperature.celsius, preferredUnits.system)}</strong>
              <span>{formatShortDate(lastTemperature.startedAt)} · {formatClock(lastTemperature.startedAt)}</span>
            </div>
          </article>
        </section>
      )}

      <section className="section-block">
        <div className="section-heading">
          <h2>Today</h2>
          <span>{todayEvents.length} entr{todayEvents.length === 1 ? 'y' : 'ies'}</span>
        </div>
        <Timeline events={todayEvents} emptyMessage={`Nothing logged for ${firstName} today.`} profile={profile} />
      </section>
    </main>
  );
}
