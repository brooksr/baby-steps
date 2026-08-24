import { DATE_RANGE_PRESETS, formatRangeLabel, getPresetRange, matchPreset, type DateRange } from '../domain/dateRange';

interface DateRangeFilterProps {
  /** Sits beside the range label — usually how much the range matched. */
  summary?: string;
  label?: string;
  range: DateRange;
  onChange: (range: DateRange) => void;
}

export function DateRangeFilter({ summary, label = 'Date range', range, onChange }: DateRangeFilterProps) {
  const activePreset = matchPreset(range);

  return (
    <section className="date-range" aria-label={label}>
      <div className="date-range-presets" role="group" aria-label={`${label} presets`}>
        {DATE_RANGE_PRESETS.map((preset) => (
          <button
            type="button"
            key={preset.id}
            aria-pressed={activePreset === preset.id}
            className={`range-chip${activePreset === preset.id ? ' active' : ''}`}
            onClick={() => onChange(getPresetRange(preset.id))}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="date-range-inputs">
        <label>
          <span>From</span>
          <input
            className="date-input"
            type="date"
            value={range.from}
            onChange={(event) => onChange({ ...range, from: event.target.value })}
          />
        </label>
        <label>
          <span>To</span>
          <input
            className="date-input"
            type="date"
            value={range.to}
            onChange={(event) => onChange({ ...range, to: event.target.value })}
          />
        </label>
      </div>

      <p className="date-range-summary">
        <strong>{formatRangeLabel(range)}</strong>
        {summary && <span>{summary}</span>}
      </p>
    </section>
  );
}
