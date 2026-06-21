import { assessLatestGrowth, getGrowthMeasurements, getMetricPlots, type GrowthBand } from '../domain/growth/assess';
import { boyGrowthStandards, type GrowthMetric } from '../domain/growth/whoBoyStandards';
import type { BabyProfile, CareEvent } from '../domain/types';
import { GrowthChart } from './GrowthChart';

interface GrowthStandardsProps {
  events: CareEvent[];
  profile: BabyProfile;
}

const METRIC_ORDER: GrowthMetric[] = ['weight', 'length', 'head'];

const bandLabel: Record<GrowthBand, string> = {
  above: 'Above range',
  below: 'Below range',
  within: 'On track'
};

export function GrowthStandards({ events, profile }: GrowthStandardsProps) {
  if (!profile.birthDate) {
    return (
      <section className="section-block">
        <div className="section-heading">
          <h2>Growth standards</h2>
        </div>
        <p className="empty-state">Log Theo's birth to compare measurements against WHO boy growth standards.</p>
      </section>
    );
  }

  const measurements = getGrowthMeasurements(profile, events);
  const assessments = assessLatestGrowth(profile, events);

  return (
    <>
      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Growth standards</h2>
            <span>WHO boys · {measurements.length} measurement{measurements.length === 1 ? '' : 's'}</span>
          </div>
        </div>

        {assessments.length === 0 ? (
          <p className="empty-state">Add a growth entry (weight, length, or head) to see how Theo compares.</p>
        ) : (
          <div className="assess-list">
            {assessments.map((assessment) => (
              <article className={`assess-row band-${assessment.band}`} key={assessment.metric}>
                <div className="assess-head">
                  <strong>{assessment.label}</strong>
                  <span className={`assess-pill band-${assessment.band}`}>{bandLabel[assessment.band]}</span>
                </div>
                <p>
                  {assessment.value.toFixed(1)} {assessment.unit} at {assessment.ageMonths.toFixed(1)} mo · median{' '}
                  {assessment.standard.median.toFixed(1)} {assessment.unit} (range {assessment.standard.p2.toFixed(1)}–
                  {assessment.standard.p98.toFixed(1)})
                </p>
                <small>{assessment.summary}</small>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="chart-grid" aria-label="WHO growth standard charts">
        {METRIC_ORDER.map((metric) => {
          const standard = boyGrowthStandards[metric];
          const plots = getMetricPlots(measurements, metric);

          return (
            <article className="chart-card" key={metric}>
              <div className="chart-heading">
                <h3>{standard.label}</h3>
                <strong>{standard.unit}</strong>
              </div>
              <GrowthChart standard={standard} plots={plots} />
              <div className="chart-stats">
                <span>WHO -2 SD…+2 SD band</span>
                <span>{plots.length} plotted</span>
              </div>
            </article>
          );
        })}
      </section>
    </>
  );
}
