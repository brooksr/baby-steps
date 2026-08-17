import { Bath, Bed, Calendar, Clock3, Droplets, Dumbbell, FileText, Heart, Milk, Navigation, Pill, Plus, Ruler, Smile, Thermometer, TriangleAlert, Wind } from 'lucide-react';
import { formatAgo, formatClock, formatDaysAgo, formatDuration, formatShortDate, getAgeDays, getDaysUntilDue, getDueDateStatus, isSameLocalDate } from '../domain/dates';
import { classifyTemperatureC } from '../domain/reference';
import { getActiveSleep, getDailySummary, getEventDurationMinutes, getLastEvent, getUpcomingAppointments, getUpcomingMedicationEvents } from '../domain/summary';
import { HOSPITAL } from '../domain/medicalInfo';
import { formatTemperature } from '../domain/temperature';
import { type ActiveTimers, formatElapsed, getElapsedSeconds, isTimerType } from '../domain/timers';
import type { BabyProfile, CareEvent, CareEventType, TemperatureEvent } from '../domain/types';
import { FamilyCalendar } from './FamilyCalendar';
import { NewbornStatus } from './NewbornStatus';
import { Timeline } from './Timeline';

interface DashboardProps {
  activeTimers: ActiveTimers;
  events: CareEvent[];
  profile: BabyProfile;
  todayKey: string;
  onAdd: (type: CareEventType) => void;
}

const actions = [
  { icon: Milk, label: 'Feed', type: 'feed' },
  { icon: Droplets, label: 'Pump', type: 'pump' },
  { icon: Wind, label: 'Diaper', type: 'diaper' },
  { icon: Bed, label: 'Sleep', type: 'sleep' },
  { icon: Pill, label: 'Med', type: 'medication' },
  { icon: Calendar, label: 'Visit', type: 'appointment' },
  { icon: Ruler, label: 'Growth', type: 'growth' },
  { icon: Thermometer, label: 'Temp', type: 'temperature' },
  { icon: Dumbbell, label: 'Tummy', type: 'tummytime' },
  { icon: Smile, label: 'Mood', type: 'mood' },
  { icon: Bath, label: 'Bath', type: 'bath' },
  { icon: FileText, label: 'Note', type: 'note' }
] satisfies Array<{ icon: typeof Plus; label: string; type: CareEventType }>;

function formatProfileDate(value: string) {
  const dateKey = value.slice(0, 10);
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function Dashboard({ activeTimers, events, profile, todayKey, onAdd }: DashboardProps) {
  const isBorn = Boolean(profile.birthDate);
  const daysUntilDue = getDaysUntilDue(profile);
  const ageDays = getAgeDays(profile);
  const firstYearProgress = Math.min(100, Math.round(((ageDays + 1) / 365) * 100));
  const todayEvents = events.filter((event) => isSameLocalDate(event.startedAt, todayKey));
  const summary = getDailySummary(todayEvents);
  const lastFeed = getLastEvent(events, (event) => event.type === 'feed');
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
  const lastBath = getLastEvent(events, (event) => event.type === 'bath');
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
            <h1>{isBorn ? ageDays : daysUntilDue}</h1>
            <p>{isBorn ? getDueDateStatus(profile) : daysUntilDue === 1 ? 'day until due date' : 'days until due date'}</p>
          </div>
          <div className="hero-side">
            <div className="profile-badge">
              <Clock3 aria-hidden="true" />
              <span>{formatProfileDate(profile.birthDate ?? profile.dueDate)}</span>
            </div>
            {isBorn ? (
              <div className="hero-progress" aria-label="First year progress">
                <span>First year {firstYearProgress}%</span>
                <div>
                  <i style={{ width: `${firstYearProgress}%` }} />
                </div>
              </div>
            ) : (
              <button className="birth-button" type="button" onClick={() => onAdd('birth')}>
                <Heart aria-hidden="true" />
                <span>Log birth</span>
              </button>
            )}
          </div>
        </div>

        <div className="hero-metrics">
          <div className="hero-metric">
            <span>Last feed</span>
            <strong>{lastFeed ? formatAgo(lastFeed.startedAt) : 'None'}</strong>
            <small>{lastFeed ? `${formatClock(lastFeed.startedAt)}${nextSide ? ` · next: ${nextSide}` : ''}` : 'Nothing logged yet'}</small>
          </div>
          <div className="hero-metric">
            <span>Last diaper</span>
            <strong>{lastDiaper ? formatAgo(lastDiaper.startedAt) : 'None'}</strong>
            <small>{lastDiaper ? formatClock(lastDiaper.startedAt) : 'Nothing logged yet'}</small>
          </div>
        </div>
      </section>

      <section className="quick-grid" aria-label="Quick add">
        {actions.map((action) => {
          const Icon = action.icon;
          const timer = isTimerType(action.type) ? activeTimers[action.type] : undefined;
          const elapsed = timer ? getElapsedSeconds(timer.startedAt) : null;
          return (
            <button className={`quick-button${timer ? ' timer-active' : ''}`} type="button" key={action.type} onClick={() => onAdd(action.type)}>
              <Icon aria-hidden="true" />
              <span>{action.label}</span>
              {elapsed !== null && <span className="quick-timer">{formatElapsed(elapsed)}</span>}
            </button>
          );
        })}
      </section>

      {/* Only useful on the way to the delivery — retired once Theo is here. */}
      {!isBorn && (
        <a className="hospital-link" href={HOSPITAL.directionsUrl} target="_blank" rel="noreferrer">
          <Navigation aria-hidden="true" />
          <div>
            <strong>Directions to {HOSPITAL.name}</strong>
            <span>{HOSPITAL.note}</span>
          </div>
        </a>
      )}

      <section className="metric-grid status-grid" aria-label="Current status">
        <article className="metric-card">
          <span>Sleep</span>
          <strong>{activeSleep ? formatDuration(getEventDurationMinutes({ ...activeSleep, endedAt: new Date().toISOString() })) : `${formatDuration(summary.sleepMinutes)} today`}</strong>
        </article>
        <article className="metric-card">
          <span>Milk out</span>
          <strong>{summary.pumpOunces.toFixed(1)} oz</strong>
        </article>
        <article className="metric-card">
          <span>Last bath</span>
          <strong>{lastBath ? formatDaysAgo(lastBath.startedAt) : 'None'}</strong>
          <small>{lastBath ? `${formatShortDate(lastBath.startedAt)} · ${formatClock(lastBath.startedAt)}` : 'Nothing logged yet'}</small>
        </article>
      </section>

      {feverActive && lastTemperature && (
        <section className="status-list" aria-label="Temperature alert">
          <article className="status-row urgent">
            <TriangleAlert aria-hidden="true" />
            <div>
              <strong>Theo has a fever — {formatTemperature(lastTemperature.celsius)}</strong>
              <span>
                {ageDays < 90 ? 'Under 3 months, a fever is worth a call to your doctor now.' : 'Keep Theo comfortable and hydrated; call your doctor if it climbs or persists.'} · {formatClock(lastTemperature.startedAt)}
              </span>
            </div>
          </article>
        </section>
      )}

      <NewbornStatus events={events} profile={profile} dateKey={todayKey} heading="Today's newborn check" />

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
        <Timeline events={todayEvents.slice(0, 8)} emptyMessage="No entries for today." />
      </section>

      <FamilyCalendar />
    </main>
  );
}
