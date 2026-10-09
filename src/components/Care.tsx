import { Check, Pencil, Syringe } from 'lucide-react';
import { useState } from 'react';
import { getAgeDays, getLocalDateKey } from '../domain/dates';
import { getMilestones, getVaccinationSchedule } from '../domain/reference';
import type { BabyProfile, CareEvent } from '../domain/types';
import { EmergencyGuide } from './EmergencyGuide';
import { KeyInfo } from './KeyInfo';

interface CareProps {
  /** Someone minding the children: Key info and Emergency, read-only. */
  caregiverView?: boolean;
  events: CareEvent[];
  profile: BabyProfile;
  /** Everyone tracked — the parents among them are the guardians. */
  profiles?: BabyProfile[];
  onEdit: (event: CareEvent) => void;
  onSaveProfile: (patch: Partial<BabyProfile>) => Promise<void>;
  onToggle: (type: 'milestone' | 'vaccine', refId: string, on: boolean) => Promise<void>;
}

type CareTab = 'emergency' | 'key-info' | 'milestones' | 'vaccinations';

const CARE_TABS: Array<{ id: CareTab; label: string }> = [
  { id: 'key-info', label: 'Key info' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'vaccinations', label: 'Vaccines' },
  { id: 'emergency', label: 'Emergency' }
];

const AVG_DAYS_PER_MONTH = 365.25 / 12;

function formatDate(date: Date) {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function addMonths(birthDate: string, months: number) {
  const date = new Date(`${getLocalDateKey(birthDate)}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return date;
}

const CAREGIVER_CARE_TABS = new Set<CareTab>(['emergency', 'key-info']);

export function Care({ caregiverView = false, events, profile, profiles = [], onEdit, onSaveProfile, onToggle }: CareProps) {
  const [tab, setTab] = useState<CareTab>('key-info');
  const tabs = caregiverView ? CARE_TABS.filter((item) => CAREGIVER_CARE_TABS.has(item.id)) : CARE_TABS;
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
        <div className="segmented-control care-tabs" role="tablist" aria-label="Care sections">
          {tabs.map((item) => (
            <button
              type="button"
              key={item.id}
              role="tab"
              id={`care-tab-${item.id}`}
              aria-controls="care-panel"
              aria-selected={tab === item.id}
              className={`${tab === item.id ? 'active' : ''} ${item.id === 'emergency' ? 'emergency-tab' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <div className="view-stack" id="care-panel" role="tabpanel" aria-labelledby={`care-tab-${tab}`}>
        {tab === 'key-info' && <KeyInfo profile={profile} profiles={profiles} onSave={caregiverView ? undefined : onSaveProfile} />}

        {tab === 'milestones' && (
          <section className="section-block" data-event="milestone">
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
        )}

        {tab === 'vaccinations' && (
          <section className="section-block" data-event="vaccine">
            <div className="section-heading">
              <div>
                <h2>Vaccinations</h2>
                <span>{nextDue ? `Next: ${nextDue.age}` : 'All marked given'}</span>
              </div>
            </div>

            <div className="care-group">
              {vaccinations.map((vaccination) => {
                const given = vaccination.given;
                const done = Boolean(given);
                return (
                  <div
                    key={vaccination.id}
                    className={`check-row ${done ? 'done' : ''} ${vaccination.overdue ? 'overdue' : ''}`}
                  >
                    <button type="button" className="check-row-main" onClick={() => onToggle('vaccine', vaccination.id, !done)} aria-pressed={done}>
                      <span className="check-box">{done ? <Check aria-hidden="true" /> : <Syringe aria-hidden="true" />}</span>
                      <span className="check-text">
                        <strong>{vaccination.age}</strong>
                        <small>{vaccination.vaccines}</small>
                        <small>
                          {given
                            ? `Given ${formatDate(new Date(given.startedAt))}`
                            : vaccination.due
                              ? `${vaccination.overdue ? 'Was due' : 'Due'} ${formatDate(vaccination.due)}`
                              : 'Log birth to schedule'}
                        </small>
                      </span>
                    </button>
                    {given && (
                      <button type="button" className="icon-button subtle" onClick={() => onEdit(given)} aria-label={`Edit ${vaccination.vaccines}`}>
                        <Pencil aria-hidden="true" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {tab === 'emergency' && <EmergencyGuide profile={profile} />}

        {(tab === 'milestones' || tab === 'vaccinations') && (
          <p className="learn-footnote">Milestones and the immunization schedule are general references — your pediatrician's guidance comes first.</p>
        )}
      </div>
    </main>
  );
}
