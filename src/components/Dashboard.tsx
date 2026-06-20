import { Bed, Calendar, Clock3, Droplets, FileText, Heart, Pill, Plus, Ruler, Utensils } from 'lucide-react';
import { formatClock, formatDuration, getAgeDays, getDaysUntilDue, getDueDateStatus, isSameLocalDate } from '../domain/dates';
import { getActiveSleep, getDailySummary, getEventDurationMinutes, getLastEvent, getUpcomingAppointments, getUpcomingMedicationEvents } from '../domain/summary';
import type { BabyProfile, CareEvent, CareEventType } from '../domain/types';
import { Timeline } from './Timeline';

interface DashboardProps {
  events: CareEvent[];
  profile: BabyProfile;
  todayKey: string;
  onAdd: (type: CareEventType) => void;
}

const actions = [
  { icon: Utensils, label: 'Nurse', type: 'breastfeed' },
  { icon: Utensils, label: 'Bottle', type: 'bottle' },
  { icon: Droplets, label: 'Pump', type: 'pump' },
  { icon: Droplets, label: 'Diaper', type: 'diaper' },
  { icon: Bed, label: 'Sleep', type: 'sleep' },
  { icon: Pill, label: 'Med', type: 'medication' },
  { icon: Calendar, label: 'Visit', type: 'appointment' },
  { icon: Ruler, label: 'Growth', type: 'growth' },
  { icon: FileText, label: 'Note', type: 'note' }
] satisfies Array<{ icon: typeof Plus; label: string; type: CareEventType }>;

function lastEventText(event: CareEvent | undefined) {
  if (!event) {
    return 'None';
  }

  return formatClock(event.startedAt);
}

function formatProfileDate(value: string) {
  const dateKey = value.slice(0, 10);
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function Dashboard({ events, profile, todayKey, onAdd }: DashboardProps) {
  const isBorn = Boolean(profile.birthDate);
  const daysUntilDue = getDaysUntilDue(profile);
  const ageDays = getAgeDays(profile);
  const firstYearProgress = Math.min(100, Math.round(((ageDays + 1) / 365) * 100));
  const todayEvents = events.filter((event) => isSameLocalDate(event.startedAt, todayKey));
  const summary = getDailySummary(todayEvents);
  const lastFeed = getLastEvent(events, (event) => event.type === 'breastfeed' || event.type === 'bottle');
  const lastDiaper = getLastEvent(events, (event) => event.type === 'diaper');
  const activeSleep = getActiveSleep(events);
  const upcomingMeds = getUpcomingMedicationEvents(events).slice(0, 3);
  const upcomingAppointments = getUpcomingAppointments(events).slice(0, 3);

  return (
    <main className="view-stack">
      <section className="profile-band">
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
      </section>

      <section className="quick-grid" aria-label="Quick add">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button className="quick-button" type="button" key={action.type} onClick={() => onAdd(action.type)}>
              <Icon aria-hidden="true" />
              <span>{action.label}</span>
            </button>
          );
        })}
      </section>

      <section className="metric-grid" aria-label="Current status">
        <article className="metric-card">
          <span>Last feed</span>
          <strong>{lastEventText(lastFeed)}</strong>
        </article>
        <article className="metric-card">
          <span>Last diaper</span>
          <strong>{lastEventText(lastDiaper)}</strong>
        </article>
        <article className="metric-card">
          <span>Sleep</span>
          <strong>{activeSleep ? formatDuration(getEventDurationMinutes({ ...activeSleep, endedAt: new Date().toISOString() })) : `${formatDuration(summary.sleepMinutes)} today`}</strong>
        </article>
        <article className="metric-card">
          <span>Milk out</span>
          <strong>{summary.pumpOunces.toFixed(1)} oz</strong>
        </article>
      </section>

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
    </main>
  );
}
