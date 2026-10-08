import { Phone, Siren } from 'lucide-react';
import { useState } from 'react';
import { formatAgeSummary, getAgeDays } from '../domain/dates';
import { getEmergencyAgeGroup, getEmergencyGuides, type EmergencyAgeGroup } from '../domain/emergency';
import { getFirstName } from '../domain/family';
import { EMERGENCY_LINES } from '../domain/medicalInfo';
import type { BabyProfile } from '../domain/types';

interface EmergencyGuideProps {
  profile: BabyProfile;
}

/** The two that cannot wait for a tap to open them. */
const OPEN_BY_DEFAULT = new Set(['choking', 'cpr']);

function telHref(phone: string) {
  return `tel:${phone.replace(/\D/g, '')}`;
}

export function EmergencyGuide({ profile }: EmergencyGuideProps) {
  const ageDays = profile.birthDate ? getAgeDays(profile) : null;
  const ownGroup = getEmergencyAgeGroup(ageDays);
  // Switchable, for a sibling, a visiting cousin, or rehearsing ahead of a birthday.
  const [group, setGroup] = useState<EmergencyAgeGroup>(ownGroup);
  const guides = getEmergencyGuides(group, ageDays);
  const pediatrician = profile.careInfo?.pediatrician;
  const name = getFirstName(profile);

  const basis = group !== ownGroup
    ? `Showing steps for ${group === 'infant' ? 'a baby under 1' : 'a child over 1'}, not ${name}'s age.`
    : ageDays == null
      ? 'Showing steps for a baby under 1 — worth reading before the birth.'
      : `Tailored to ${name}: ${formatAgeSummary(profile)} old.`;

  return (
    <section className="section-block emergency-block">
      <div className="section-heading">
        <div>
          <h2>Emergency</h2>
          <span>{basis}</span>
        </div>
        <div className="segmented-control" aria-label="Age group">
          <button type="button" className={group === 'infant' ? 'active' : ''} onClick={() => setGroup('infant')}>Under 1</button>
          <button type="button" className={group === 'child' ? 'active' : ''} onClick={() => setGroup('child')}>1 year +</button>
        </div>
      </div>

      <div className="emergency-calls">
        {EMERGENCY_LINES.map((line) => (
          <a key={line.title} className={`emergency-call ${line.tel === '911' ? 'primary' : ''}`} href={`tel:${line.tel}`}>
            {line.tel === '911' ? <Siren aria-hidden="true" /> : <Phone aria-hidden="true" />}
            <span>
              <strong>{line.tel === '911' ? 'Call 911' : line.title}</strong>
              <small>{line.tel === '911' ? 'Not breathing, choking, unresponsive' : line.detail}</small>
            </span>
          </a>
        ))}
        {pediatrician?.phone && (
          <a className="emergency-call" href={telHref(pediatrician.phone)}>
            <Phone aria-hidden="true" />
            <span>
              <strong>Pediatrician</strong>
              <small>{pediatrician.name} · {pediatrician.phone}</small>
            </span>
          </a>
        )}
      </div>

      <div className="emergency-list">
        {guides.map((guide) => (
          // Keyed by group too, so switching age re-applies which cards start open.
          <details key={`${group}-${guide.id}`} className="emergency-guide" open={OPEN_BY_DEFAULT.has(guide.id)}>
            <summary>
              <strong>{guide.title}</strong>
              <small>{guide.when}</small>
            </summary>
            <div className="emergency-call-when">
              <h3>Call 911 if</h3>
              <ul>
                {guide.callWhen.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <ol className="emergency-steps">
              {guide.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            {guide.notes && (
              <ul className="emergency-notes">
                {guide.notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            )}
          </details>
        ))}
      </div>

      <p className="learn-footnote">
        First-aid steps for a lay rescuer, following American Heart Association and Red Cross guidance. Reading them is not
        the same as practising them — a hands-on infant and child CPR class is the best preparation there is. When in doubt,
        call 911.
      </p>
    </section>
  );
}
