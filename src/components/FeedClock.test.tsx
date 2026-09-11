import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CareEvent } from '../domain/types';
import { FeedClock } from './FeedClock';

const base = {
  babyId: 'theo-roche',
  createdAt: '2025-06-10T12:00:00.000Z',
  method: 'nursing' as const,
  syncState: 'local' as const,
  type: 'feed' as const,
  updatedAt: '2025-06-10T12:00:00.000Z'
};

const pad = (value: number) => String(value).padStart(2, '0');

function feed(id: string, dateKey: string, hour: number, durationMinutes?: number): CareEvent {
  return {
    ...base,
    durationMinutes,
    id,
    startedAt: new Date(`${dateKey}T${pad(hour)}:00:00`).toISOString()
  };
}

/** Three short morning feeds and three long late-evening ones, on one day. */
const events: CareEvent[] = [
  ...[10, 12, 14].map((minutes, index) => feed(`morning-${index}`, '2025-06-10', 7, minutes)),
  ...[40, 44, 48].map((minutes, index) => feed(`night-${index}`, '2025-06-10', 22, minutes))
];

describe('FeedClock', () => {
  it('names the busiest time and the average length of a feed', () => {
    render(<FeedClock events={events} scopeLabel="this week" />);

    expect(screen.getByText('This week: 6 feeds, most often around 6–9a.')).toBeInTheDocument();
    expect(screen.getByText('Busiest 6–9a')).toBeInTheDocument();
    // Longest and shortest are a whole band apart, not one outlying feed.
    expect(screen.getByText('Longest 9p–12a')).toBeInTheDocument();
    expect(screen.getByText('Shortest 6–9a')).toBeInTheDocument();
    expect(screen.getByText('28m')).toBeInTheDocument();
  });

  it('reads out the feeds and their lengths for a band on tap', async () => {
    render(<FeedClock events={events} scopeLabel="this week" />);

    await userEvent.click(screen.getByLabelText('9p–12a: 3 feeds · 3/day'));
    await userEvent.click(screen.getByLabelText('9p–12a: 44m avg · 40m–48m · 3 timed'));

    expect(screen.getAllByText('9p–12a').length).toBeGreaterThan(0);
    expect(screen.getByText('44m avg · 40m–48m · 3 timed')).toBeInTheDocument();
  });

  it('re-buckets the charts when a narrower band is picked', async () => {
    render(<FeedClock events={events} scopeLabel="this week" />);

    expect(screen.getByLabelText('6–9a: 3 feeds · 3/day')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '1h' }));

    // The same three morning feeds now sit in their own hour.
    expect(screen.queryByLabelText('6–9a: 3 feeds · 3/day')).not.toBeInTheDocument();
    expect(screen.getByLabelText('7–8a: 3 feeds · 3/day')).toBeInTheDocument();
    expect(screen.getByLabelText('10–11p: 3 feeds · 3/day')).toBeInTheDocument();
    expect(screen.getByLabelText('10–11p: 44m avg · 40m–48m · 3 timed')).toBeInTheDocument();
  });

  it('says so rather than charting nothing with no feeds logged', () => {
    render(<FeedClock events={[]} scopeLabel="today" />);

    expect(screen.getByText('Today: no feeds logged.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Feeds by time of day chart')).not.toBeInTheDocument();
  });
});
