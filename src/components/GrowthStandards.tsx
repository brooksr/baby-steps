import { useState } from 'react';
import { getAgeDays } from '../domain/dates';
import { getFirstName } from '../domain/family';
import { assessLatestGrowth, getGestationInfo, getGrowthMeasurements, getMetricPlots, type AgeBasis, type GrowthBand, type MetricPlot } from '../domain/growth/assess';
import { getGrowthStandardSex, getGrowthStandards } from '../domain/growth/standards';
import type { GrowthMetric, GrowthStandard } from '../domain/growth/whoBoyStandards';
import type { BabyProfile, CareEvent, PreferredUnits } from '../domain/types';
import { centimetersToInches, formatLength, formatWeight, getPreferredUnits, kilogramsToOunces } from '../domain/units';
import { GrowthChart } from './GrowthChart';

interface GrowthStandardsProps {
  events: CareEvent[];
  profile: BabyProfile;
}

const METRIC_ORDER: GrowthMetric[] = ['weight', 'length', 'head'];
const AVG_DAYS_PER_MONTH = 365.25 / 12;

const bandLabel: Record<GrowthBand, string> = {
  above: 'Above range',
  below: 'Below range',
  within: 'On track'
};

/** WHO standards are canonical in kg/cm; charts plot whatever the profile reads in. */
function convertGrowthValue(metric: GrowthMetric, value: number, preferredUnits: PreferredUnits) {
  if (preferredUnits.system === 'metric') {
    return value;
  }

  if (metric !== 'weight') {
    return centimetersToInches(value);
  }

  const ounces = kilogramsToOunces(value);
  return preferredUnits.weightDisplay === 'ounces' ? ounces : ounces / 16;
}

function growthUnitLabel(metric: GrowthMetric, preferredUnits: PreferredUnits) {
  if (metric !== 'weight') {
    return 'in';
  }

  return preferredUnits.weightDisplay === 'ounces' ? 'oz' : 'lb';
}

function displayGrowthValue(metric: GrowthMetric, value: number, preferredUnits: PreferredUnits) {
  return metric === 'weight'
    ? formatWeight(kilogramsToOunces(value), preferredUnits)
    : formatLength(centimetersToInches(value), preferredUnits.system);
}

function displayPlots(plots: MetricPlot[], metric: GrowthMetric, preferredUnits: PreferredUnits): MetricPlot[] {
  return plots.map((plot) => ({ ...plot, value: convertGrowthValue(metric, plot.value, preferredUnits) }));
}

function displayStandard(standard: GrowthStandard, preferredUnits: PreferredUnits): GrowthStandard {
  if (preferredUnits.system === 'metric') {
    return standard;
  }

  return {
    ...standard,
    points: standard.points.map((point) => ({
      median: convertGrowthValue(standard.metric, point.median, preferredUnits),
      month: point.month,
      p2: convertGrowthValue(standard.metric, point.p2, preferredUnits),
      p98: convertGrowthValue(standard.metric, point.p98, preferredUnits)
    })),
    unit: growthUnitLabel(standard.metric, preferredUnits)
  };
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
      <section className="section-block">
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

  return (
    <>
      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Growth standards</h2>
            <span>WHO {standardSex} · {measurements.length} measurement{measurements.length === 1 ? '' : 's'}</span>
          </div>
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
          <p className="empty-state">Add a growth entry (weight, length, or head) to see how {firstName} compares.</p>
        ) : (
          <div className="assess-list">
            {assessments.map((assessment) => (
              <article className={`assess-row band-${assessment.band}`} key={assessment.metric}>
                <div className="assess-head">
                  <strong>{assessment.label}</strong>
                  <span className={`assess-pill band-${assessment.band}`}>{bandLabel[assessment.band]}</span>
                </div>
                <p>
                  {displayGrowthValue(assessment.metric, assessment.value, preferredUnits)} at {assessment.ageMonths.toFixed(1)} mo
                  {activeBasis === 'corrected' ? ' corrected' : ''} · median{' '}
                  {displayGrowthValue(assessment.metric, assessment.standard.median, preferredUnits)} (range{' '}
                  {displayGrowthValue(assessment.metric, assessment.standard.p2, preferredUnits)}–
                  {displayGrowthValue(assessment.metric, assessment.standard.p98, preferredUnits)})
                </p>
                <small>
                  Estimated P{actualAssessments.get(assessment.metric)?.percentile} actual age
                  {showCorrected ? ` · P${correctedAssessments.get(assessment.metric)?.percentile} corrected age` : ''}
                </small>
                <small>{assessment.summary}</small>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="chart-grid" aria-label="WHO growth standard charts">
        {METRIC_ORDER.map((metric) => {
          const standard = displayStandard(standards[metric], preferredUnits);
          const plots = displayPlots(getMetricPlots(measurements, metric), metric, preferredUnits);

          return (
            <article className="chart-card" key={metric}>
              <div className="chart-heading">
                <h3>{standard.label}</h3>
                <strong>{standard.unit}</strong>
              </div>
              <GrowthChart maxAgeMonths={chartMaxAgeMonths} standard={standard} plots={plots} showCorrected={showCorrected} />
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
