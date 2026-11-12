import { useState } from 'react';
import { getAgeDays } from '../domain/dates';
import { getFirstName } from '../domain/family';
import { assessLatestGrowth, estimateSdScore, getGestationInfo, getGrowthMeasurements, getMetricPlots, interpolateStandard, sdScoreToPercentile, type AgeBasis, type GrowthBand } from '../domain/growth/assess';
import { getGrowthStandardSex, getGrowthStandards } from '../domain/growth/standards';
import type { GrowthMetric } from '../domain/growth/whoBoyStandards';
import type { BabyProfile, CareEvent, PreferredUnits } from '../domain/types';
import { centimetersToInches, formatLength, formatWeight, getPreferredUnits, kilogramsToOunces } from '../domain/units';
import { GrowthChart, type GrowthSeries } from './GrowthChart';

interface GrowthStandardsProps {
  events: CareEvent[];
  profile: BabyProfile;
}

const METRIC_ORDER: GrowthMetric[] = ['weight', 'length', 'head'];
const METRIC_LABELS: Record<GrowthMetric, string> = { head: 'Head', length: 'Length', weight: 'Weight' };
const AVG_DAYS_PER_MONTH = 365.25 / 12;

const bandLabel: Record<GrowthBand, string> = {
  above: 'Above range',
  below: 'Below range',
  within: 'On track'
};

function displayGrowthValue(metric: GrowthMetric, value: number, preferredUnits: PreferredUnits) {
  return metric === 'weight'
    ? formatWeight(kilogramsToOunces(value), preferredUnits)
    : formatLength(centimetersToInches(value), preferredUnits.system);
}

export function GrowthStandards({ events, profile }: GrowthStandardsProps) {
  // Corrected age is the honest default for a preterm baby: the WHO curves are
  // built on term births. `activeBasis` falls back to actual when there is no
  // gestation to correct for, so a term profile never sees the difference.
  const [basis, setBasis] = useState<AgeBasis>('corrected');
  const firstName = getFirstName(profile);
  const preferredUnits = getPreferredUnits(profile);
  const standardSex = getGrowthStandardSex(profile.gender);
  const standards = getGrowthStandards(profile.gender);

  if (!profile.birthDate) {
    return (
      <section className="section-block growth-overview">
        <div className="section-heading">
          <h2>Growth standards</h2>
        </div>
        <p className="empty-state">Log {firstName}'s birth to compare measurements against WHO {standardSex === 'girls' ? 'girl' : 'boy'} growth standards.</p>
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
  const actualAssessments = new Map(assessLatestGrowth(profile, events, 'actual').map((assessment) => [assessment.metric, assessment]));
  const correctedAssessments = new Map(assessLatestGrowth(profile, events, 'corrected').map((assessment) => [assessment.metric, assessment]));
  const latestAgeMonths = measurements[measurements.length - 1]?.ageMonths ?? 0;
  const chartMaxAgeMonths = Math.max(1, getAgeDays(profile) / AVG_DAYS_PER_MONTH, latestAgeMonths);
  // One chart for all three: each reading is placed by its SD score at the age
  // the comparison is read at, since kilograms and centimeters share no axis.
  const series: GrowthSeries[] = METRIC_ORDER.map((metric) => ({
    label: METRIC_LABELS[metric],
    metric,
    points: getMetricPlots(measurements, metric).map((plot) => {
      const ageMonths = activeBasis === 'corrected' ? plot.correctedAgeMonths : plot.ageMonths;
      const score = estimateSdScore(plot.value, interpolateStandard(standards[metric], ageMonths));
      return {
        ageMonths,
        score,
        title: `${METRIC_LABELS[metric]} ${displayGrowthValue(metric, plot.value, preferredUnits)} · P${sdScoreToPercentile(score)} at ${ageMonths.toFixed(1)} months`
      };
    })
  }));

  return (
    <>
      <section className="section-block growth-overview">
        <div className="section-heading">
          <div>
            <h2>Growth standards</h2>
            <span>WHO {standardSex} · {measurements.length} measurement{measurements.length === 1 ? '' : 's'}</span>
          </div>

        </div>

        {/* WHO publishes boys' and girls' tables only. With no sex recorded the
            boys' curves stand in — say so rather than comparing silently. */}
        {profile.gender !== 'boy' && profile.gender !== 'girl' && (
          <p className="gestation-note">
            WHO growth standards are published for boys and girls, so these bands use the <strong>boys&rsquo;</strong>{' '}
            reference.
            <span>Set {firstName}&rsquo;s sex in Settings to compare against the matching curves.</span>
          </p>
        )}

        {showCorrected && <details className="reference-details growth-age-options"><summary>Age comparison</summary>
          {showCorrected && gestation && (
            <div className="segmented-control" aria-label="Age basis">
              <button
                type="button"
                aria-pressed={activeBasis === 'actual'}
                className={activeBasis === 'actual' ? 'active' : ''}
                onClick={() => setBasis('actual')}
              >
                Actual age
              </button>
              <button
                type="button"
                aria-pressed={activeBasis === 'corrected'}
                className={activeBasis === 'corrected' ? 'active' : ''}
                onClick={() => setBasis('corrected')}
              >
                Corrected
              </button>
            </div>
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
        </details>}


        {assessments.length === 0 ? (
          <p className="empty-state">Add a growth entry (weight, length, or head) to see how {firstName} compares.</p>
        ) : (
          <div className="assess-list">
            {assessments.map((assessment) => (
              <article className={`assess-row band-${assessment.band}`} key={assessment.metric}>
                <div className="assess-head">
                  <strong>{assessment.label}</strong>
                  <span className={`assess-pill band-${assessment.band}`}>{bandLabel[assessment.band]}</span>
                </div>
                <p className="growth-reading">{displayGrowthValue(assessment.metric, assessment.value, preferredUnits)} <span className="growth-percentile" aria-label={`Estimated percentile P${assessment.percentile}`}>· P{assessment.percentile}</span></p>
                <details className="reference-details growth-detail"><summary>Percentiles & reference</summary>
                <p>
                  Median{' '}
                  {displayGrowthValue(assessment.metric, assessment.standard.median, preferredUnits)} (range{' '}
                  {displayGrowthValue(assessment.metric, assessment.standard.p2, preferredUnits)}–
                  {displayGrowthValue(assessment.metric, assessment.standard.p98, preferredUnits)})
                </p>
                <small>
                  Estimated P{actualAssessments.get(assessment.metric)?.percentile} actual age
                  {showCorrected ? ` · P${correctedAssessments.get(assessment.metric)?.percentile} corrected age` : ''}
                </small>
                <small>{assessment.summary}</small>
                </details>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="chart-card growth-combined" aria-label="WHO growth standard chart">
        <div className="chart-heading">
          <h3>Weight, length &amp; head</h3>
          <small>Against WHO, by age · the band is the usual range, the dashed line the median</small>
        </div>
        <GrowthChart maxAgeMonths={chartMaxAgeMonths} series={series} />
        <div className="chart-legend">
          {series.map((line) => (
            <span className="chart-legend-item growth-legend" data-metric={line.metric} key={line.metric}>
              {line.label}
            </span>
          ))}
        </div>
        <div className="chart-stats">
          <span>WHO reference · −2 to +2 SD{showCorrected ? ` · ${activeBasis === 'corrected' ? 'corrected' : 'actual'} age` : ''}</span>
          <span>{series.reduce((sum, line) => sum + line.points.length, 0)} plotted</span>
        </div>
      </section>
    </>
  );
}
