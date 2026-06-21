import { useMemo } from 'react';
import type { GrowthStandard } from '../domain/growth/whoBoyStandards';
import type { MetricPlot } from '../domain/growth/assess';

interface GrowthChartProps {
  standard: GrowthStandard;
  plots: MetricPlot[];
}

const WIDTH = 320;
const HEIGHT = 200;
const PAD_LEFT = 34;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;

export function GrowthChart({ standard, plots }: GrowthChartProps) {
  const geometry = useMemo(() => {
    const months = standard.points.map((point) => point.month);
    const minMonth = months[0];
    const maxMonth = months[months.length - 1];

    const lows = standard.points.map((point) => point.p2);
    const highs = standard.points.map((point) => point.p98);
    const plotValues = plots.map((plot) => plot.value);
    let minValue = Math.min(...lows, ...plotValues);
    let maxValue = Math.max(...highs, ...plotValues);
    const valuePad = (maxValue - minValue) * 0.08 || 1;
    minValue -= valuePad;
    maxValue += valuePad;

    const x = (month: number) =>
      PAD_LEFT + ((month - minMonth) / (maxMonth - minMonth || 1)) * (WIDTH - PAD_LEFT - PAD_RIGHT);
    const y = (value: number) =>
      PAD_TOP + (1 - (value - minValue) / (maxValue - minValue || 1)) * (HEIGHT - PAD_TOP - PAD_BOTTOM);

    const line = (selector: (index: number) => number) =>
      standard.points.map((point, index) => `${x(point.month)},${y(selector(index))}`).join(' ');

    const bandPath = [
      ...standard.points.map((point) => `${x(point.month)},${y(point.p98)}`),
      ...[...standard.points].reverse().map((point) => `${x(point.month)},${y(point.p2)}`)
    ].join(' ');

    return {
      band: bandPath,
      maxMonth,
      maxValue,
      median: line((index) => standard.points[index].median),
      minMonth,
      minValue,
      points: plots.map((plot) => ({ cx: x(plot.ageMonths), cy: y(plot.value) })),
      x,
      y
    };
  }, [plots, standard]);

  const yTicks = [geometry.minValue, (geometry.minValue + geometry.maxValue) / 2, geometry.maxValue];
  const xTicks = [geometry.minMonth, geometry.maxMonth / 2, geometry.maxMonth].map((value) => Math.round(value));

  return (
    <svg className="growth-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${standard.label} chart in ${standard.unit}`}>
      <polygon className="growth-band" points={geometry.band} />
      <polyline className="growth-median" points={geometry.median} fill="none" />

      {yTicks.map((tick) => (
        <text key={`y-${tick}`} className="growth-axis-label" x={PAD_LEFT - 4} y={geometry.y(tick) + 3} textAnchor="end">
          {tick.toFixed(tick < 10 ? 1 : 0)}
        </text>
      ))}

      {xTicks.map((tick) => (
        <text key={`x-${tick}`} className="growth-axis-label" x={geometry.x(tick)} y={HEIGHT - 6} textAnchor="middle">
          {tick}m
        </text>
      ))}

      {geometry.points.map((point, index) => (
        <circle key={index} className="growth-point" cx={point.cx} cy={point.cy} r={3.5} />
      ))}
    </svg>
  );
}
