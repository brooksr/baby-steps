import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TrendCharts } from './TrendCharts';

const stats = { average: 2, max: 3, min: 1 };
const values = [{ label: '2026-09-01', value: 1 }, { label: '2026-09-02', value: 3 }];

describe('TrendCharts', () => {
  it('draws one chart and swaps the metric from the picker', async () => {
    const { container } = render(
      <TrendCharts
        label="Recent trends"
        metrics={[
          { chart: { event: 'feed', label: 'Feeds/day', stats, total: 4, values }, name: 'Feeds' },
          { chart: { event: 'sleep', label: 'Sleep/day', stats, suffix: 'h', total: 4, values }, name: 'Sleep' }
        ]}
      />
    );

    expect(container.querySelectorAll('.chart-card')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Feeds/day' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Feeds' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Sleep' }));

    expect(screen.getByRole('heading', { name: 'Sleep/day' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Feeds/day' })).not.toBeInTheDocument();
    expect(container.querySelector('.chart-card')).toHaveAttribute('data-event', 'sleep');
  });
});
