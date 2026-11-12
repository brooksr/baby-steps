import type { GrowthMetric } from '../domain/growth/whoBoyStandards';

export interface GrowthSeriesPoint {
  ageMonths: number;
  /** Approximate SD score against the WHO standard at that age. */
  score: number;
  /** The reading as the profile shows it, for the point's tooltip. */
  title: string;
}

export interface GrowthSeries {
  label: string;
  metric: GrowthMetric;
  points: GrowthSeriesPoint[];
}

interface GrowthChartProps {
  maxAgeMonths: number;
  series: GrowthSeries[];
}

const WIDTH = 320;
const HEIGHT = 200;
const PAD_LEFT = 44;
const PAD_RIGHT = 10;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;
/** The band always shows with room either side; an outlier widens the scale. */
const BASE_SCORE_LIMIT = 3;

/**
 * Weight, length and head on one chart. Their units cannot share an axis, so
 * each reading is placed by where it sits against the WHO standard for its age
 * — the shaded band is −2 to +2 SD for all three, and the dashed line is the
 * median. The readings themselves, in the profile's units, are listed above the
 * chart and on each point's tooltip.
 */
export function GrowthChart({ maxAgeMonths, series }: GrowthChartProps) {
  const scores = series.flatMap((line) => line.points.map((point) => Math.abs(point.score)));
  const limit = Math.max(BASE_SCORE_LIMIT, Math.ceil(Math.max(0, ...scores) * 2) / 2 + 0.5);
  const maxMonth = Math.max(1, maxAgeMonths);
  const x = (month: number) => PAD_LEFT + (Math.min(month, maxMonth) / maxMonth) * (WIDTH - PAD_LEFT - PAD_RIGHT);
  const y = (score: number) => PAD_TOP + ((limit - score) / (2 * limit)) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
  const left = x(0);
  const right = x(maxMonth);
  const xTicks = [0, maxMonth / 2, maxMonth];
  const yTicks = [
    { label: '+2 SD', score: 2 },
    { label: 'Median', score: 0 },
    { label: '−2 SD', score: -2 }
  ];

  return (
    <svg
      className="growth-chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Weight, length and head against WHO standards: ${series.map((line) => `${line.label} ${line.points.length} plotted`).join(', ')}`}
    >
      <rect className="growth-band" x={left} y={y(2)} width={right - left} height={y(-2) - y(2)} />
      <line className="growth-median" x1={left} x2={right} y1={y(0)} y2={y(0)} />

      {yTicks.map((tick) => (
        <text key={tick.label} className="growth-axis-label" x={PAD_LEFT - 4} y={y(tick.score) + 3} textAnchor="end">
          {tick.label}
        </text>
      ))}

      {xTicks.map((tick, index) => (
        <text key={`x-${index}`} className="growth-axis-label" x={x(tick)} y={HEIGHT - 6} textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}>
          {Number.isInteger(tick) ? tick : tick.toFixed(1)}m
        </text>
      ))}

      {series.map((line) => (
        <g className="growth-series" data-metric={line.metric} key={line.metric}>
          {line.points.length > 1 && (
            <polyline className="growth-line" fill="none" points={line.points.map((point) => `${x(point.ageMonths)},${y(point.score)}`).join(' ')} />
          )}
          {line.points.map((point, index) => (
            <circle className="growth-point" cx={x(point.ageMonths)} cy={y(point.score)} key={index} r={3.5}>
              <title>{point.title}</title>
            </circle>
          ))}
        </g>
      ))}
    </svg>
  );
}
