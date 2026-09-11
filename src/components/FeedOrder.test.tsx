import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatMinutesOfDay } from '../domain/dates';
import { FEED_DAY_MIN_FEEDS } from '../domain/feedOrder';
import type { CareEvent } from '../domain/types';
import { FeedOrder } from './FeedOrder';

const base = {
  babyId: 'theo-roche',
  createdAt: '2025-06-10T12:00:00.000Z',
  method: 'nursing' as const,
  syncState: 'local' as const,
  type: 'feed' as const,
  updatedAt: '2025-06-10T12:00:00.000Z'
};

const pad = (value: number) => String(value).padStart(2, '0');

function day(dateKey: string, hours: number[]): CareEvent[] {
  return hours.map((hour, index) => ({
    ...base,
    id: `${dateKey}-${index}`,
    startedAt: new Date(`${dateKey}T${pad(hour)}:00:00`).toISOString()
  }));
}

/** An ordinary day: nine feeds on the hour from `start`, so it clears the filter. */
function fullDay(dateKey: string, start: number): CareEvent[] {
  return day(dateKey, Array.from({ length: FEED_DAY_MIN_FEEDS }, (_, index) => start + index));
}

/** Three ordinary days, plus one that ran to a tenth feed. */
const events: CareEvent[] = [
  ...day('2025-06-10', [...Array.from({ length: FEED_DAY_MIN_FEEDS }, (_, i) => 6 + i), 22]),
  ...fullDay('2025-06-11', 8),
  ...fullDay('2025-06-12', 7)
];

const rowsIn = () => within(document.querySelector('.feed-order-list') as HTMLElement);

describe('FeedOrder', () => {
  it('lists each feed of the day with its average clock time', () => {
    render(<FeedOrder events={events} scopeLabel="this week" />);

    // Scoped to the rows: the axis below them carries clock labels of its own.
    const rows = rowsIn();

    expect(rows.getByText('Feed 1')).toBeInTheDocument();
    // 6a, 8a and 7a average to 7a, and each later index follows an hour on.
    expect(rows.getByText(formatMinutesOfDay(7 * 60))).toBeInTheDocument();
    expect(rows.getByText(formatMinutesOfDay(8 * 60))).toBeInTheDocument();
  });

  it('shows each row’s spread and the days behind it', () => {
    render(<FeedOrder events={events} scopeLabel="this week" />);

    expect(
      screen.getByLabelText(
        `Feed 1 averages ${formatMinutesOfDay(7 * 60)}, between ${formatMinutesOfDay(6 * 60)} and ${formatMinutesOfDay(
          8 * 60
        )} across 3 days`
      )
    ).toBeInTheDocument();
    // The tenth feed only ever happened once, so it reads as the thin evidence it is.
    const sparse = document.querySelectorAll('.feed-order-row.sparse');
    expect(sparse).toHaveLength(1);
    expect(sparse[0].querySelector('small')?.textContent).toBe('+8h · 1 day');
  });

  it('says which days it counted', () => {
    render(<FeedOrder events={[...events, ...day('2025-06-13', [9])]} scopeLabel="this week" />);

    // The stray one-feed day is logged but not counted.
    expect(
      screen.getByText(`3 of 4 days · only days with 9–11 feeds · day starts ${formatMinutesOfDay(5 * 60)}`)
    ).toBeInTheDocument();
  });

  it('places a small-hours feed at the end of its day, not the start', () => {
    render(
      <FeedOrder
        events={[...day('2025-06-10', [7, 9, 11, 13, 15, 17, 19, 22]), ...day('2025-06-11', [1])]}
        scopeLabel="this week"
      />
    );

    // Eight feeds from 7am plus the 1am after them are one nine-feed day.
    expect(rowsIn().getByText('Feed 9')).toBeInTheDocument();
    expect(rowsIn().getByText(formatMinutesOfDay(60))).toBeInTheDocument();
    // Twenty hours into a day that began at 5am — the right-hand end of the track.
    const mark = document.querySelectorAll('.feed-order-row')[8].querySelector('.feed-order-mark');
    expect((mark as HTMLElement).style.left).toBe(`${(20 / 24) * 100}%`);
  });

  it('says so rather than describing a stray day when none is ordinary', () => {
    render(<FeedOrder events={day('2025-06-10', [7, 12])} scopeLabel="this week" />);

    expect(
      screen.getByText('This week: no day logged 9–11 feeds, so there is no ordinary day to describe (1 day logged).')
    ).toBeInTheDocument();
    expect(document.querySelector('.feed-order-list')).toBeNull();
  });

  it('says so rather than listing nothing with no feeds logged', () => {
    render(<FeedOrder events={[]} scopeLabel="today" />);

    expect(screen.getByText('Today: no feeds logged.')).toBeInTheDocument();
  });
});
