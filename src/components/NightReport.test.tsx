import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

describe('NightReport', () => {
  it('opens on last night with its wakes and bedtime', () => {
    render(<NightReport events={events} now={now} />);

    expect(screen.getByText('Last night')).toBeInTheDocument();
    const wakes = within(screen.getByRole('list', { name: 'Wakes' }));
    expect(wakes.getAllByRole('listitem')).toHaveLength(3);
    expect(wakes.getByText(formatClock(at('2026-10-12T21:50')))).toBeInTheDocument();
    // Scoped to the card: the track's axis starts at the same clock time.
    expect(within(screen.getByText('Bedtime').closest('article') as HTMLElement).getByText(formatClock(at('2026-10-12T19:00')))).toBeInTheDocument();
  });

  it('steps back to an earlier night and stops at the newest', () => {
    render(<NightReport events={events} now={now} />);

    expect(screen.getByRole('button', { name: 'Next night' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous night' }));
    expect(screen.getByText('Night of')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Wakes' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('averages over the chosen span of nights', () => {
    render(<NightReport events={events} now={now} />);

    const averages = within(screen.getByLabelText('Averages over the last 7 nights'));
    expect(averages.getByText('Wakes/night')).toBeInTheDocument();
    expect(averages.getByText('2.5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '30 nights' }));
    expect(screen.getByLabelText('Averages over the last 30 nights')).toBeInTheDocument();
  });

  it('shows what the sensor heard as a suggestion once it loads', async () => {
    render(<NightReport events={events} loadNursery={async () => nursery} now={now} />);

    expect(await screen.findByText(/listening 98% of noon to noon/)).toBeInTheDocument();
    expect(screen.getByText(/Possible wake with nothing logged: /)).toHaveTextContent(formatClock(at('2026-10-13T02:30')));
  });

  it('says so when nothing was logged around a night', () => {
    render(<NightReport events={[]} now={now} />);

    expect(screen.getByText('Nothing logged around this night.')).toBeInTheDocument();
    expect(screen.getByText('No finished night logged in the last 7.')).toBeInTheDocument();
  });
});
