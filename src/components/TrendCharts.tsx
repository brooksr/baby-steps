import { useState } from 'react';
import { MiniChart, type MiniChartProps } from './MiniChart';

export interface TrendMetric {
  chart: MiniChartProps;
  /** The picker's word for it — "Feeds", "Sleep". */
  name: string;
}

interface TrendChartsProps {
  label: string;
  metrics: TrendMetric[];
}

/**
 * Feeds, sleep, diapers and milk per day in one card: a picker swaps which one
 * the chart draws, so the four share one slot instead of four stacked charts.
 * Each keeps its own heading, colors, stacked parts and readout.
 */
export function TrendCharts({ label, metrics }: TrendChartsProps) {
  const [selected, setSelected] = useState(metrics[0]?.name);
  const active = metrics.find((metric) => metric.name === selected) ?? metrics[0];

  if (!active) {
    return null;
  }

  const picker = (
    <div className="segmented-control trend-picker" aria-label={`${label}: metric`} style={{ gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))` }}>
      {metrics.map((metric) => (
        <button
          type="button"
          key={metric.name}
          aria-pressed={metric === active}
          className={metric === active ? 'active' : ''}
          onClick={() => setSelected(metric.name)}
        >
          {metric.name}
        </button>
      ))}
    </div>
  );

  return (
    <section className="trend-charts" aria-label={label}>
      {/* Keyed by metric, so a tapped bar does not carry over to the next chart. */}
      <MiniChart key={active.name} {...active.chart} picker={picker} />
    </section>
  );
}
