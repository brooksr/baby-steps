import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrendCharts } from './TrendCharts';

const stats = { average: 2, max: 3, min: 1 };
const values = [{ label: '2026-09-01', value: 1 }, { label: '2026-09-02', value: 3 }];

describe('TrendCharts', () => {
  it('shows every daily chart at once in one card', () => {
    const { container } = render(
      <TrendCharts
        charts={[
          { event: 'feed', label: 'Feeds/day', stats, total: 4, values },
          { event: 'sleep', label: 'Sleep/day', stats, suffix: 'h', total: 4, values }
        ]}
        label="Recent trends"
      />
    );

    expect(container.querySelectorAll('.trend-card')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Feeds/day' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sleep/day' })).toBeInTheDocument();
    // Narrow columns drop the per-bar numbers; the readout still names a bar.
    expect(container.querySelector('.chart-bar-value')).toBeNull();
  });
});
