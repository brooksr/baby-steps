import { MiniChart, type MiniChartProps } from './MiniChart';

interface TrendChartsProps {
  charts: MiniChartProps[];
  label: string;
}

/**
 * Feeds, sleep, diapers and milk per day in one card, side by side — four
 * columns where there is room, two by two on a phone. Each column is still its
 * own chart card inside, so it keeps its heading, colors, stacked parts and
 * expand-to-detail.
 */
export function TrendCharts({ charts, label }: TrendChartsProps) {
  return (
    <section className="trend-card" aria-label={label}>
      {charts.map((chart) => (
        <MiniChart key={chart.label} {...chart} compact />
      ))}
    </section>
  );
}
