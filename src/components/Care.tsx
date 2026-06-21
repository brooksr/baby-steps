import { Check, Syringe } from 'lucide-react';
import { getAgeDays, getLocalDateKey } from '../domain/dates';
import { getMilestones, getVaccinationSchedule } from '../domain/reference';
import type { BabyProfile, CareEvent } from '../domain/types';
import { KeyInfo } from './KeyInfo';

interface CareProps {
  events: CareEvent[];
  profile: BabyProfile;
  onSaveProfile: (patch: Partial<BabyProfile>) => Promise<void>;
  onToggle: (type: 'milestone' | 'vaccine', refId: string, on: boolean) => Promise<void>;
}

const AVG_DAYS_PER_MONTH = 365.25 / 12;

function formatDate(date: Date) {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function addMonths(birthDate: string, months: number) {
  const date = new Date(`${getLocalDateKey(birthDate)}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return date;
}

export function Care({ events, profile, onSaveProfile, onToggle }: CareProps) {
  const ageMonths = profile.birthDate ? getAgeDays(profile) / AVG_DAYS_PER_MONTH : null;

  const achieved = new Map<string, CareEvent>();
  for (const event of events) {
    if (event.type === 'milestone' || event.type === 'vaccine') {
      achieved.set(event.refId, event);
    }
  }

  const milestones = getMilestones();
  const milestoneGroups = new Map<number, typeof milestones>();
  for (const milestone of milestones) {
    const group = milestoneGroups.get(milestone.ageMonths) ?? [];
    group.push(milestone);
    milestoneGroups.set(milestone.ageMonths, group);
  }

  const achievedCount = milestones.filter((milestone) => achieved.has(milestone.id)).length;

  const vaccinations = getVaccinationSchedule().map((vaccination) => {
    const given = achieved.get(vaccination.id);
    const due = profile.birthDate ? addMonths(profile.birthDate, vaccination.ageMonths) : null;
    const overdue = Boolean(due && !given && due.getTime() < Date.now());
    return { ...vaccination, due, given, overdue };
  });
  const nextDue = vaccinations.find((vaccination) => !vaccination.given);

  return (
    <main className="view-stack">
      <section className="section-block">
        <div className="section-heading">
          <div>
            <h1>Care plan</h1>
            <span>{ageMonths != null ? `${ageMonths.toFixed(1)} months old` : 'Log birth to anchor ages'}</span>
          </div>
        </div>
      </section>

      <KeyInfo profile={profile} onSave={onSaveProfile} />

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Milestones</h2>
            <span>{achievedCount} of {milestones.length} marked</span>
          </div>
        </div>

        {[...milestoneGroups.entries()].map(([month, items]) => {
          const dueNow = ageMonths != null && month <= ageMonths;
          return (
            <div className="care-group" key={month}>
              <h3 className="care-group-title">
                {month} months {dueNow && <span className="care-tag">age-appropriate</span>}
              </h3>
              {items.map((milestone) => {
                const event = achieved.get(milestone.id);
                const done = Boolean(event);
                return (
                  <button
                    type="button"
                    key={milestone.id}
                    className={`check-row ${done ? 'done' : ''}`}
                    onClick={() => onToggle('milestone', milestone.id, !done)}
                    aria-pressed={done}
                  >
                    <span className="check-box">{done && <Check aria-hidden="true" />}</span>
                    <span className="check-text">
                      <strong>{milestone.milestone}</strong>
                      <small>{milestone.domain}{event ? ` · ${formatDate(new Date(event.startedAt))}` : ''}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Vaccinations</h2>
            <span>{nextDue ? `Next: ${nextDue.age}` : 'All marked given'}</span>
          </div>
        </div>

        <div className="care-group">
          {vaccinations.map((vaccination) => {
            const done = Boolean(vaccination.given);
            return (
              <button
                type="button"
                key={vaccination.id}
                className={`check-row ${done ? 'done' : ''} ${vaccination.overdue ? 'overdue' : ''}`}
                onClick={() => onToggle('vaccine', vaccination.id, !done)}
                aria-pressed={done}
              >
                <span className="check-box">{done ? <Check aria-hidden="true" /> : <Syringe aria-hidden="true" />}</span>
                <span className="check-text">
                  <strong>{vaccination.age}</strong>
                  <small>{vaccination.vaccines}</small>
                  <small>
                    {vaccination.given
                      ? `Given ${formatDate(new Date(vaccination.given.startedAt))}`
                      : vaccination.due
                        ? `${vaccination.overdue ? 'Was due' : 'Due'} ${formatDate(vaccination.due)}`
                        : 'Log birth to schedule'}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <p className="learn-footnote">Milestones and the immunization schedule are general references — your pediatrician's guidance comes first.</p>
    </main>
  );
}
