import { Bath, Bed, Calendar, Droplets, Dumbbell, FileText, Heart, Milk, Navigation, Pill, Plus, Ruler, Smile, Thermometer, TriangleAlert, Wind } from 'lucide-react';
import type { ReactNode } from 'react';
import { getCadenceReminders, predictNextBath, predictNextFeed } from '../domain/cadence';
import { getFirstName } from '../domain/family';
import { formatAgeSummary, formatAgo, formatClock, formatClockRange, formatDaysSince, formatDuration, formatShortDate, formatWeekday, getAgeDays, getDaysUntilDue, getDueDateStatus, isSameLocalDate } from '../domain/dates';
import { predictNextDiaper } from '../domain/diapers';
import { classifyTemperatureC } from '../domain/reference';
import { getActiveSleep, getDailySummary, getEventDurationMinutes, getLastEvent, getUpcomingAppointments, getUpcomingMedicationEvents } from '../domain/summary';
import { HOSPITAL } from '../domain/medicalInfo';
import { formatTemperature } from '../domain/temperature';
import { type ActiveTimers, formatElapsed, getElapsedSeconds, isTimerType } from '../domain/timers';
import type { BabyProfile, CareEvent, CareEventType, TemperatureEvent } from '../domain/types';
import { formatVolume, getPreferredUnits } from '../domain/units';
import { NewbornStatus } from './NewbornStatus';
import { Timeline } from './Timeline';
import { WhatToExpect } from './WhatToExpect';

interface DashboardProps {
  activeTimers: ActiveTimers;
  /**
   * The only entry types this person may add — a caregiver's feeds and
   * diapers. Unset is everything.
   */
  allowedTypes?: readonly CareEventType[];
  events: CareEvent[];
  profile: BabyProfile;
  todayKey: string;
  /** Everyone tracked, so an entry can name the parent who logged it. */
  profiles?: BabyProfile[];
  onAdd: (type: CareEventType) => void;
  /** Unset where there is no Log to open — the caregiver view. */
  onOpenLog?: (type: CareEventType) => void;
}

// Ordered by how often a caregiver reaches for it, three to a row: the awake
// routine (tummy, bath) sits with sleep rather than trailing the grid.
const actions = [
  { icon: Milk, label: 'Feed', type: 'feed' },
  { icon: Droplets, label: 'Pump', type: 'pump' },
  { icon: Wind, label: 'Diaper', type: 'diaper' },
  { icon: Dumbbell, label: 'Tummy', type: 'tummytime' },
  { icon: Bath, label: 'Bath', type: 'bath' },
  { icon: Bed, label: 'Sleep', type: 'sleep' },
  { icon: Pill, label: 'Med', type: 'medication' },
  { icon: Calendar, label: 'Visit', type: 'appointment' },
  { icon: Ruler, label: 'Growth', type: 'growth' },
  { icon: Thermometer, label: 'Temp', type: 'temperature' },
  { icon: Smile, label: 'Mood', type: 'mood' },
  { icon: FileText, label: 'Note', type: 'note' }
] satisfies Array<{ icon: typeof Plus; label: string; type: CareEventType }>;

/** Opens the Log filtered to its type, or — with nowhere to open — is just a reading. */
function HeroMetric({ children, className, label, onOpen }: { children: ReactNode; className: string; label: string; onOpen?: () => void }) {
  return onOpen ? (
    <button aria-label={label} className={`${className} hero-metric-link`} type="button" onClick={onOpen}>
      {children}
    </button>
  ) : (
    <div className={className}>{children}</div>
  );
}

export function Dashboard({ activeTimers, allowedTypes, events, profile, profiles = [], todayKey, onAdd, onOpenLog }: DashboardProps) {
  const canAdd = (type: CareEventType) => !allowedTypes || allowedTypes.includes(type);
  const openLog = (type: CareEventType) => (onOpenLog ? () => onOpenLog(type) : undefined);
  // Whoever the switcher is on — an alert has to name the right baby.
  const firstName = getFirstName(profile);
  const preferredUnits = getPreferredUnits(profile);
  const isBorn = Boolean(profile.birthDate);
  const hasDueDate = Boolean(profile.dueDate);
  const daysUntilDue = getDaysUntilDue(profile);
  const ageDays = getAgeDays(profile);
  const todayEvents = events.filter((event) => isSameLocalDate(event.startedAt, todayKey));
  const summary = getDailySummary(todayEvents);
  const lastFeed = getLastEvent(events, (event) => event.type === 'feed');
  const nextFeed = activeTimers.feed ? null : predictNextFeed(events);
  const lastNursing = getLastEvent(events, (event) => event.type === 'feed' && event.method === 'nursing');
  const nextSide =
    lastNursing && lastNursing.type === 'feed'
      ? lastNursing.side === 'left'
        ? 'right'
        : lastNursing.side === 'right'
          ? 'left'
          : 'either'
      : null;
  const lastDiaper = getLastEvent(events, (event) => event.type === 'diaper');
  const nextDiaper = predictNextDiaper(events);
  const lastBath = getLastEvent(events, (event) => event.type === 'bath');
  const nextBath = predictNextBath(events);
  const dayLabel = (dateKey: string) => (dateKey === todayKey ? 'Today' : formatWeekday(dateKey));
  const sideSuffix = nextSide ? ` · ${nextSide}` : '';
  const cadenceReminders = getCadenceReminders(events, { feedInProgress: Boolean(activeTimers.feed) });
  const bathReminder = cadenceReminders.find((reminder) => reminder.kind === 'bath');
  const feedReminder = cadenceReminders.find((reminder) => reminder.kind === 'feed');
  const otherCadenceReminders = cadenceReminders.filter((reminder) => reminder.kind !== 'bath');
  // Under a fortnight the headline is already in days, so the exact age below it
  // would only say the same thing twice.
  const ageDetail = isBorn
    ? ageDays >= 14
      ? ageDays >= 56
        ? `${Math.floor(ageDays / 7)} weeks · ${getDueDateStatus(profile)}`
        : getDueDateStatus(profile)
      : ''
    : hasDueDate
      ? daysUntilDue === 1
        ? 'day until due date'
        : 'days until due date'
      : 'Add a due date or birth date in Settings.';
  const activeSleep = getActiveSleep(events);
  const upcomingMeds = getUpcomingMedicationEvents(events).slice(0, 3);
  const upcomingAppointments = getUpcomingAppointments(events).slice(0, 3);
  const lastTemperature = events
    .filter((event): event is TemperatureEvent => event.type === 'temperature')
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
  const temperatureBand = lastTemperature ? classifyTemperatureC(lastTemperature.celsius) : undefined;
  const feverActive = temperatureBand?.band === 'Fever' || temperatureBand?.band === 'High fever';

  return (
    <main className="view-stack">
      <section className="profile-band">
        <div className="profile-band-top">
          <div>
            <p className="eyebrow">{profile.name}</p>
            <h1 className={isBorn || !hasDueDate ? 'age-headline' : undefined}>{isBorn ? formatAgeSummary(profile) : hasDueDate ? daysUntilDue : 'Welcome'}</h1>
            {ageDetail && <p>{ageDetail}</p>}
          </div>
          {!isBorn && canAdd('birth') && (
            <div className="hero-side">
              <button className="birth-button" type="button" onClick={() => onAdd('birth')}>
                <Heart aria-hidden="true" />
                <span>Log birth</span>
              </button>
            </div>
          )}
        </div>

        {/* A card only appears once there is something to count from — an empty
            "None · Nothing logged yet" tile says nothing the quick-add grid doesn't. */}
        {(lastFeed || lastDiaper || lastBath) && (
          <div className="hero-metrics">
            {lastFeed && (
              <HeroMetric className={`hero-metric${feedReminder ? ' past-due' : ''}`} label="View feed log" onOpen={openLog('feed')}>
                <span>Last feed</span>
                <strong>{formatAgo(lastFeed.startedAt).replace(/ ago$/, '')}</strong>
                <small>{formatClock(lastFeed.startedAt)}</small>
                {nextFeed && (
                  <small className="hero-metric-detail">
                    {nextFeed.minutesAway > 0 ? `Next ~${formatClockRange(nextFeed.windowStartAt, nextFeed.windowEndAt)}` : 'Due now'}
                    {sideSuffix}
                  </small>
                )}
              </HeroMetric>
            )}
            {lastDiaper && (
              <HeroMetric className={`hero-metric${nextDiaper && nextDiaper.minutesAway <= 0 ? ' past-due' : ''}`} label="View diaper log" onOpen={openLog('diaper')}>
                <span>Last diaper</span>
                <strong>{formatAgo(lastDiaper.startedAt).replace(/ ago$/, '')}</strong>
                <small>{formatClock(lastDiaper.startedAt)}</small>
                {nextDiaper && (
                  <small className="hero-metric-detail">
                    {nextDiaper.minutesAway > 0 ? `Next ~${formatClockRange(nextDiaper.windowStartAt, nextDiaper.windowEndAt)}` : 'Likely now'} · {nextDiaper.likelyKind}
                  </small>
                )}
              </HeroMetric>
            )}
            {lastBath && (
              <HeroMetric className={`hero-metric${bathReminder ? ' past-due' : ''}`} label="View bath log" onOpen={openLog('bath')}>
                <span>Last bath</span>
                <strong>{formatDaysSince(lastBath.startedAt)}</strong>
                <small>{`${formatShortDate(lastBath.startedAt)} · ${formatClock(lastBath.startedAt)}`}</small>
                {nextBath && (
                  <small className="hero-metric-detail">
                    {nextBath.due ? 'Due today' : `Next ~${dayLabel(nextBath.windowStartKey)}–${dayLabel(nextBath.windowEndKey)}`}
                  </small>
                )}
              </HeroMetric>
            )}
          </div>
        )}
      </section>

      <section className="quick-grid" aria-label="Quick add">
        {actions.filter((action) => canAdd(action.type)).map((action) => {
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

      {/* Only useful on the way to the delivery, once a route is configured. */}
      {!isBorn && HOSPITAL.directionsUrl && (
        <a className="hospital-link" href={HOSPITAL.directionsUrl} target="_blank" rel="noreferrer">
          <Navigation aria-hidden="true" />
          <div>
            <strong>Directions to {HOSPITAL.name}</strong>
            <span>{HOSPITAL.note}</span>
          </div>
        </a>
      )}

      {feverActive && lastTemperature && (
        <section className="status-list" aria-label="Temperature alert">
          <article className="status-row urgent">
            <TriangleAlert aria-hidden="true" />
            <div>
              <strong>{firstName} has a fever — {formatTemperature(lastTemperature.celsius, preferredUnits.system)}</strong>
              <span>
                {ageDays < 90
                  ? 'Under 3 months, a fever is worth a call to your doctor now.'
                  : `Keep ${firstName} comfortable and hydrated; call your doctor if it climbs or persists.`}{' '}
                · {formatClock(lastTemperature.startedAt)}
              </span>
            </div>
          </article>
        </section>
      )}

      {otherCadenceReminders.length > 0 && (
        <section className="status-list" aria-label="Gentle reminders">
          {otherCadenceReminders.map((reminder) => {
            const Icon = reminder.kind === 'feed' ? Milk : Bath;

            return (
              <article className="status-row gentle" key={reminder.kind}>
                <Icon aria-hidden="true" />
                <div>
                  <strong>{reminder.title}</strong>
                  <span>{reminder.message}</span>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <NewbornStatus events={events} profile={profile} dateKey={todayKey} heading="Today's newborn check" />

      {/* Sits below the alerts and the daily check — what is happening today
          comes first, what to expect of this week comes after it. */}
      <WhatToExpect key={profile.id} events={events} profile={profile} />

      {(upcomingMeds.length > 0 || upcomingAppointments.length > 0) && (
        <section className="status-list" aria-label="Upcoming">
          {upcomingMeds.map((medication) => (
            <article className="status-row urgent" key={medication.id}>
              <Pill aria-hidden="true" />
              <div>
                <strong>{medication.medicationName}</strong>
                <span>{medication.dose} · {formatClock(medication.scheduledAt ?? medication.startedAt)}</span>
              </div>
            </article>
          ))}
          {upcomingAppointments.map((appointment) => (
            <article className="status-row" key={appointment.id}>
              <Calendar aria-hidden="true" />
              <div>
                <strong>{appointment.reason}</strong>
                <span>{formatClock(appointment.startedAt)}{appointment.location ? ` · ${appointment.location}` : ''}</span>
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="section-block">
        <div className="section-heading">
          <h2>Today</h2>
          <span>{summary.feedCount} feeds · {summary.wetDiapers + summary.dirtyDiapers} diapers</span>
        </div>
        <div className="today-totals" aria-label="Today summary">
          <article>
            <span>Sleep</span>
            <strong>{activeSleep ? formatDuration(getEventDurationMinutes({ ...activeSleep, endedAt: new Date().toISOString() })) : formatDuration(summary.sleepMinutes)}</strong>
          </article>
          <article>
            <span>Milk out</span>
            <strong>{formatVolume(summary.pumpOunces, preferredUnits.system)}</strong>
          </article>
          <article>
            <span>Wet</span>
            <strong>{summary.wetDiapers}</strong>
          </article>
          <article>
            <span>Dirty</span>
            <strong>{summary.dirtyDiapers}</strong>
          </article>
        </div>
        <Timeline events={todayEvents.slice(0, 8)} emptyMessage="No entries for today." profile={profile} profiles={profiles} />
      </section>
    </main>
  );
}
