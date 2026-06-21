import { Check, TriangleAlert } from 'lucide-react';
import { assessNewbornDay } from '../domain/growth/assess';
import type { BabyProfile, CareEvent } from '../domain/types';

interface NewbornStatusProps {
  events: CareEvent[];
  profile: BabyProfile;
  dateKey: string;
  /** Heading shown above the checks. */
  heading?: string;
}

export function NewbornStatus({ events, profile, dateKey, heading = 'Newborn check' }: NewbornStatusProps) {
  const assessment = assessNewbornDay(profile, events, dateKey);
  if (!assessment) {
    return null;
  }

  return (
    <section className={`section-block newborn-card ${assessment.onTrack ? 'on-track' : 'attention'}`} aria-label="Newborn daily expectations">
      <div className="section-heading">
        <div>
          <h2>{heading}</h2>
          <span>Day {assessment.dayOfLife} of life</span>
        </div>
        <span className={`assess-pill ${assessment.onTrack ? 'band-within' : 'band-below'}`}>
          {assessment.onTrack ? 'Within expected' : 'Below expected'}
        </span>
      </div>

      <div className="newborn-checks">
        {assessment.checks.map((check) => (
          <article className={`newborn-check status-${check.status}`} key={check.label}>
            {check.status === 'within' ? <Check aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
            <div>
              <strong>{check.count}</strong>
              <span>{check.label}</span>
            </div>
            <small>expect ≥ {check.expectedMin}</small>
          </article>
        ))}
      </div>

      <p className="newborn-note">{assessment.expectation.note}</p>
      {!assessment.onTrack && (
        <p className="newborn-guidance">
          A quiet day or two can be normal — keep offering feeds and watch the next nappies. If the low days continue or Theo seems unwell, check in with your pediatrician.
        </p>
      )}
    </section>
  );
}
