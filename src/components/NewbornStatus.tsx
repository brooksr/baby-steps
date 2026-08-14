import { Check, Hourglass, TriangleAlert } from 'lucide-react';
import { assessNewbornDay, type NewbornMetricCheck } from '../domain/growth/assess';
import type { BabyProfile, CareEvent } from '../domain/types';

interface NewbornStatusProps {
  events: CareEvent[];
  profile: BabyProfile;
  dateKey: string;
  /** Heading shown above the checks. */
  heading?: string;
}

const checkIcons = {
  below: TriangleAlert,
  pending: Hourglass,
  within: Check
};

function checkTarget(check: NewbornMetricCheck, dayComplete: boolean) {
  // Mid-day, the pace target is the number that actually matters.
  if (!dayComplete && check.status !== 'within') {
    return `${check.expectedByNow} by now · ${check.expectedMin} by bedtime`;
  }

  return `expect ≥ ${check.expectedMin}`;
}

export function NewbornStatus({ events, profile, dateKey, heading = 'Newborn check' }: NewbornStatusProps) {
  const assessment = assessNewbornDay(profile, events, dateKey);
  if (!assessment) {
    return null;
  }

  // A day still in progress is judged on pace only — half the diapers by noon
  // is exactly what it should look like, so it stays neutral rather than red.
  const behind = !assessment.onTrack;
  const onPace = assessment.onTrack && assessment.stillCounting;
  const tone = behind ? 'attention' : onPace ? 'counting' : 'on-track';
  const pill = behind ? 'Below expected' : onPace ? 'On pace so far' : 'Within expected';
  const pillBand = behind ? 'band-below' : onPace ? 'band-pending' : 'band-within';
  const percentElapsed = Math.round(assessment.dayProgress * 100);

  return (
    <section className={`section-block newborn-card ${tone}`} aria-label="Newborn daily expectations">
      <div className="section-heading">
        <div>
          <h2>{heading}</h2>
          <span>
            Day {assessment.dayOfLife} of life
            {assessment.dayComplete ? '' : ` · ${percentElapsed}% of the day so far`}
          </span>
        </div>
        <span className={`assess-pill ${pillBand}`}>{pill}</span>
      </div>

      <div className="newborn-checks">
        {assessment.checks.map((check) => {
          const Icon = checkIcons[check.status];

          return (
            <article className={`newborn-check status-${check.status}`} key={check.label}>
              <Icon aria-hidden="true" />
              <div>
                <strong>{check.count}</strong>
                <span>{check.label}</span>
              </div>
              <small>{checkTarget(check, assessment.dayComplete)}</small>
            </article>
          );
        })}
      </div>

      <p className="newborn-note">{assessment.expectation.note}</p>
      {behind && (
        <p className="newborn-guidance">
          {assessment.dayComplete
            ? 'A quiet day or two can be normal — keep offering feeds and watch the next nappies. If the low days continue or Theo seems unwell, check in with your pediatrician.'
            : 'Running behind the usual pace for this point in the day — offer a feed and watch the next nappy. If it stays low or Theo seems unwell, check in with your pediatrician.'}
        </p>
      )}
    </section>
  );
}
