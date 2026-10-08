import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ReportExplorer } from './ReportExplorer';

describe('ReportExplorer', () => {
  it('opens a report card as a full-screen detail and closes it', async () => {
    const user = userEvent.setup();
    render(
      <ReportExplorer>
        <article className="metric-card" data-event="feed">
          <span>Feeds/day</span>
          <strong>7.2</strong>
          <small>5–9 range</small>
          <small>36 total</small>
        </article>
      </ReportExplorer>
    );

    const card = screen.getByRole('button', { name: /Feeds\/day/i });
    expect(card).toHaveAttribute('aria-haspopup', 'dialog');

    await user.click(card);

    const dialog = screen.getByRole('dialog', { name: 'Feeds/day' });
    expect(dialog).toHaveTextContent('7.2');
    expect(dialog).toHaveTextContent('5–9 range');
    expect(dialog).toHaveTextContent('36 total');
    expect(dialog).toHaveTextContent(/per-day average/i);

    await user.click(screen.getByRole('button', { name: 'Close report detail' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps chart buttons interactive instead of opening the detail', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ReportExplorer>
        <article className="chart-card">
          <div className="chart-heading"><h3>Sleep/day</h3><strong>8h avg</strong></div>
          <div className="chart-bars"><button type="button">Select Monday</button></div>
        </article>
      </ReportExplorer>
    );

    await user.click(screen.getByRole('button', { name: 'Select Monday' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(container.querySelector('.chart-card') as HTMLElement);
    expect(screen.getByRole('dialog', { name: 'Sleep/day' }).querySelector('.report-detail-chart .chart-bars')).toBeInTheDocument();
  });
});
