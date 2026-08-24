import { useState } from 'react';
import { assessLatestGrowth, getGestationInfo, getGrowthMeasurements, getMetricPlots, type AgeBasis, type GrowthBand } from '../domain/growth/assess';
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
  const [basis, setBasis] = useState<AgeBasis>('actual');

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
  const gestation = getGestationInfo(profile);
  // WHO standards assume a term birth, so the corrected view only earns its
  // place when there is actually gestation to correct for.
  const showCorrected = Boolean(gestation?.preterm && gestation.correctionDays > 0);
  const activeBasis: AgeBasis = showCorrected ? basis : 'actual';
  const assessments = assessLatestGrowth(profile, events, activeBasis);

  return (
    <>
      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Growth standards</h2>
            <span>WHO boys · {measurements.length} measurement{measurements.length === 1 ? '' : 's'}</span>
          </div>
          {showCorrected && gestation && (
            <div className="segmented-control" aria-label="Age basis">
              <button type="button" className={activeBasis === 'actual' ? 'active' : ''} onClick={() => setBasis('actual')}>
                Actual age
              </button>
              <button type="button" className={activeBasis === 'corrected' ? 'active' : ''} onClick={() => setBasis('corrected')}>
                Corrected
              </button>
            </div>
          )}
        </div>

        {/* Only the boys' WHO curves are bundled. Say so rather than quietly
            charting a girl against the wrong reference. */}
        {profile.gender === 'girl' && (
          <p className="gestation-note">
            Only the WHO <strong>boys&rsquo;</strong> curves ship with this app, so these bands compare against the
            boys&rsquo; reference.
            <span>Read them alongside your pediatrician&rsquo;s own chart.</span>
          </p>
        )}

        {showCorrected && gestation && (
          <p className="gestation-note">
            Born at <strong>{gestation.label}</strong>
            {gestation.latePreterm ? ' (late preterm)' : ' (preterm)'} — corrected age subtracts {gestation.correctionDays} days.
            <span>
              {activeBasis === 'corrected'
                ? 'Comparing against babies at the same developmental age.'
                : 'Comparing against full-term babies with the same birthday.'}
            </span>
          </p>
        )}

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
                  {assessment.value.toFixed(1)} {assessment.unit} at {assessment.ageMonths.toFixed(1)} mo
                  {activeBasis === 'corrected' ? ' corrected' : ''} · median{' '}
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
              <GrowthChart standard={standard} plots={plots} showCorrected={showCorrected} />
              {showCorrected && (
                <div className="chart-legend">
                  <span className="chart-legend-item growth-legend-actual">Actual age</span>
                  <span className="chart-legend-item growth-legend-corrected">Corrected age</span>
                </div>
              )}
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
