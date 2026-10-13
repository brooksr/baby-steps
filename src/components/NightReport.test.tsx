import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getRecentNightsRange } from '../domain/babyNights';
import { formatClock } from '../domain/dates';
import type { NurseryData } from '../domain/nurserySensor';
import type { CareEvent } from '../domain/types';
import { NightReport } from './NightReport';

const base = { babyId: 'avery-example', createdAt: '2026-10-01T00:00:00.000Z', syncState: 'synced' as const, updatedAt: '2026-10-01T00:00:00.000Z' };
const at = (local: string) => new Date(local).toISOString();
const feed = (local: string): CareEvent => ({ ...base, durationMinutes: 20, id: `feed_${local}`, method: 'nursing', startedAt: at(local), type: 'feed' }) as CareEvent;
const sleep = (from: string, to: string): CareEvent => ({ ...base, endedAt: at(to), id: `sleep_${from}`, startedAt: at(from), type: 'sleep' }) as CareEvent;

const events: CareEvent[] = [
  feed('2026-10-11T23:00'),
  feed('2026-10-12T03:00'),
  sleep('2026-10-12T19:00', '2026-10-12T21:50'),
  feed('2026-10-12T21:55'),
  feed('2026-10-13T01:13'),
  feed('2026-10-13T03:08')
];

const nursery: NurseryData = {
  episodes: [{ endedAt: at('2026-10-13T02:31'), label: 'baby_cry', maxScore: 0.7, startedAt: at('2026-10-13T02:30') }],
  nights: [{ coveragePercent: 97.6, cryEpisodes: 1, nightOf: '2026-10-12', status: 'complete' }]
};

const now = new Date('2026-10-13T15:00');

const week = getRecentNightsRange(events, 7, now);

describe('NightReport', () => {
  it('opens on last night with its wakes on the track and its bedtime', () => {
    render(<NightReport averageRange={week} events={events} now={now} scopeLabel="this week" />);

    expect(screen.getByText('Last night')).toBeInTheDocument();
    const track = screen.getByRole('img', { name: /3 wakes/ });
    expect(track).toHaveAccessibleName(expect.stringContaining(`${formatClock(at('2026-10-12T21:50'))}, Feeding`));
    // One dot per logged entry, in the entry's own color.
    expect(track.querySelectorAll('.night-entry[data-event="feed"]')).toHaveLength(3);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    // Scoped to the card: the track's axis starts at the same clock time.
    expect(within(screen.getByText('Bedtime').closest('article') as HTMLElement).getByText(formatClock(at('2026-10-12T19:00')))).toBeInTheDocument();
  });

  it('steps back to an earlier night and stops at the newest', () => {
    render(<NightReport averageRange={week} events={events} now={now} scopeLabel="this week" />);

    expect(screen.getByRole('button', { name: 'Next night' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous night' }));
    expect(screen.getByText('Night of')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /2 wakes/ })).toBeInTheDocument();
  });

  it('averages over the Reports period, and over nothing on Day', () => {
    const { rerender } = render(<NightReport averageRange={week} events={events} now={now} scopeLabel="this week" />);

    const averages = within(screen.getByLabelText('Night averages this week'));
    expect(averages.getByText('Wakes/night')).toBeInTheDocument();
    expect(averages.getByText('2.5')).toBeInTheDocument();
    expect(screen.getByText('2 of 7 nights logged · 2 with sleep estimated')).toBeInTheDocument();

    rerender(<NightReport averageRange={null} events={events} now={now} scopeLabel="today" />);
    expect(screen.queryByText('Averages')).not.toBeInTheDocument();
  });

  it('shows what the sensor heard as a suggestion once it loads', async () => {
    render(<NightReport averageRange={week} events={events} loadNursery={async () => nursery} now={now} scopeLabel="this week" />);

    expect(await screen.findByText(/listening 98% of noon to noon/)).toHaveTextContent('1 with nothing logged, outlined');
    expect(document.querySelector('.night-heard.possible')).not.toBeNull();
  });

  it('says so when nothing was logged around a night', () => {
    render(<NightReport averageRange={getRecentNightsRange([], 7, now)} events={[]} now={now} scopeLabel="this week" />);

    expect(screen.getByText('Nothing logged around this night.')).toBeInTheDocument();
    expect(screen.getByText('No finished night logged this week.')).toBeInTheDocument();
  });
});
