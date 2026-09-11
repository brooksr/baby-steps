import { useState } from 'react';
import type { MetricStats } from '../domain/firstYear';
import type { CareEventType } from '../domain/types';
import { BAR_LABEL_LIMIT, formatBarValue, formatDayLabel, formatParts, formatStat, type ChartPoint } from './chartFormat';

interface MiniChartProps {
  /** Which care event the chart is about — it colors the bars by family. */
  event: CareEventType;
  label: string;
  stats: MetricStats;
  suffix?: string;
  /** Sum across the charted span, shown next to the average. */
  total: number;
  /** Names for the stacked `parts`, in the same order. Drives the legend. */
  partLabels?: string[];
  /** Per-day averages per part, shown in the legend beside the headline average. */
  partAverages?: number[];
  /** Totals per part across the charted span, shown in the legend. */
  partTotals?: number[];
  /** True when bars average several days together, so a bar is not one day's total. */
  sampled?: boolean;
  values: ChartPoint[];
}

export function MiniChart({ event, label, stats, suffix = '', partAverages, partLabels, partTotals, sampled = false, total, values }: MiniChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const max = Math.max(1, ...values.map((point) => point.value));
  const cols = Math.max(1, values.length);
  const showBarLabels = values.length > 0 && values.length <= BAR_LABEL_LIMIT;
  // Defaults to the most recent bar so a day total is always on screen.
  const activePoint = values.length > 0 ? values[Math.min(activeIndex ?? values.length - 1, values.length - 1)] : null;
  const dayWord = sampled ? 'avg/day from' : '';

  return (
    <article className="chart-card" data-event={event}>
      <div className="chart-heading">
        <h3>{label}</h3>
        <strong>{formatStat(stats.average, suffix)} avg</strong>
        <small>{formatStat(total, suffix)} total</small>
      </div>
      <div
        className="chart-bars"
        aria-label={`${label} chart`}
        // `minmax(0, ...)`, not a pixel floor: a floor of a few px per column
        // plus the gaps is wider than the card once a period runs to months, and
        // the bars spill out the side. The gap tightens as columns multiply so
        // they stay distinguishable instead of merging into a block.
        style={{ gap: `${cols > 45 ? 1 : cols > 24 ? 2 : 4}px`, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {values.length === 0 ? (
          <p className="empty-state compact">No data</p>
        ) : (
          values.map((point, index) => {
            const readout = `${dayWord ? `${dayWord} ` : ''}${formatDayLabel(point.label)}: ${formatStat(point.value, suffix)}${formatParts(point, partLabels)}`;
            const barHeight = `${Math.max(8, (point.value / max) * 100)}%`;

            return (
              <button
                type="button"
                className={`chart-column${point === activePoint ? ' active' : ''}`}
                key={`${label}-${point.label}`}
                aria-label={readout}
                title={readout}
                onClick={() => setActiveIndex(index)}
              >
                {showBarLabels && <b className="chart-bar-value">{formatBarValue(point.value)}</b>}
                <span className="chart-bar">
                  {point.parts && point.value > 0 ? (
                    <span className="chart-bar-stack" style={{ height: barHeight }}>
                      {point.parts.map((part, partIndex) => (
                        <i
                          key={partLabels?.[partIndex] ?? partIndex}
                          className={`chart-bar-part-${partIndex}`}
                          style={{ height: `${(part / point.value) * 100}%` }}
                        />
                      ))}
                    </span>
                  ) : (
                    <i style={{ height: barHeight }} />
                  )}
                </span>
                {showBarLabels && <em className="chart-bar-day">{new Date(`${point.label}T12:00:00`).getDate()}</em>}
              </button>
            );
          })
        )}
      </div>
      {activePoint && (
        <p className="chart-readout">
          <span>{dayWord ? `${dayWord} ${formatDayLabel(activePoint.label)}` : formatDayLabel(activePoint.label)}</span>
          <strong>
            {formatStat(activePoint.value, suffix)}
            {formatParts(activePoint, partLabels)}
          </strong>
        </p>
      )}
      {partLabels && partTotals && (
        <div className="chart-legend">
          {partLabels.map((partLabel, index) => (
            <span className={`chart-legend-item chart-bar-part-${index}`} key={partLabel}>
              {partLabel}{' '}
              {partAverages ? `${formatStat(partAverages[index], suffix)} avg · ` : ''}
              {formatStat(partTotals[index], suffix)} total
            </span>
          ))}
        </div>
      )}
      <div className="chart-stats">
        <span>Min {formatStat(stats.min, suffix)}</span>
        <span>Max {formatStat(stats.max, suffix)}</span>
      </div>
    </article>
  );
}
