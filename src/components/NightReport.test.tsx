import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

  it('labels each bar with its length and start, and logs estimated sleep one bar or all at once', async () => {
    const onLogSleep = vi.fn();
    const onLogSleeps = vi.fn(async () => undefined);
    render(<NightReport averageRange={week} events={events} now={now} onLogSleep={onLogSleep} onLogSleeps={onLogSleeps} scopeLabel="this week" />);

    // The logged bedtime stretch is labelled too, but only estimated ones are buttons.
    expect(document.querySelector('.night-sleep-length')).toHaveTextContent('2h 50m');
    expect(document.querySelector('.night-sleep-labels')).toHaveTextContent(formatClock(at('2026-10-12T22:30')));
    const bars = screen.getAllByRole('button', { name: /^Log estimated sleep/ });
    expect(bars).toHaveLength(3);

    fireEvent.click(bars[0]);
    expect(onLogSleep).toHaveBeenCalledWith({ endedAt: at('2026-10-13T01:13'), startedAt: at('2026-10-12T22:30') });

    fireEvent.click(screen.getByRole('button', { name: 'Log 3 estimated sleeps' }));
    expect(onLogSleeps).toHaveBeenCalledWith([
      { endedAt: at('2026-10-13T01:13'), startedAt: at('2026-10-12T22:30') },
      { endedAt: at('2026-10-13T03:08'), startedAt: at('2026-10-13T01:48') },
      { endedAt: at('2026-10-13T07:00'), startedAt: at('2026-10-13T03:43') }
    ]);
    expect(await screen.findByRole('button', { name: 'Log 3 estimated sleeps' })).toBeEnabled();
  });

  it('shows the day after the night, with its naps and room to log one', () => {
    const onLogSleep = vi.fn();
    const day = [...events, feed('2026-10-13T08:00'), sleep('2026-10-13T09:30', '2026-10-13T11:00'), feed('2026-10-13T11:10')];
    render(<NightReport averageRange={week} events={day} now={now} onLogSleep={onLogSleep} scopeLabel="this week" />);

    expect(screen.getByRole('heading', { name: 'Night & Day' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /day: 1 nap, 1h 30m/ })).toBeInTheDocument();
    expect(screen.getByText(/1 nap · 1h 30m in all · longest 1h 30m/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: `Log a nap from ${formatClock(at('2026-10-13T11:45'))}` }));
    expect(onLogSleep).toHaveBeenCalledWith({ endedAt: null, startedAt: at('2026-10-13T11:45') });
  });

  it('opens a heard cry for the log’s context and marks it, or all of them, in Mood', async () => {
    const onMarkCries = vi.fn(async () => undefined);
    render(<NightReport averageRange={week} events={events} loadNursery={async () => nursery} now={now} onMarkCries={onMarkCries} scopeLabel="this week" />);

    const chip = await screen.findByRole('button', { name: `${formatClock(at('2026-10-13T02:30'))} · 1m` });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    // Picked from the chip or the tick, it is the same cry.
    expect(screen.getByRole('button', { name: `Crying heard ${formatClock(at('2026-10-13T02:30'))}` })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/nothing logged near it/)).toBeInTheDocument();
    expect(screen.getByText(/^fed 1h 17m before/)).toBeInTheDocument();
    expect(screen.getByText(/The sensor hears that a baby cried, not why/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark in Mood' }));
    expect(onMarkCries).toHaveBeenCalledWith([
      { notes: expect.stringMatching(/^Crying heard by the nursery sensor, .* · fed 1h 17m before/), startedAt: at('2026-10-13T02:30') }
    ]);
    expect(await screen.findByRole('button', { name: 'Mark all 1 in Mood' })).toBeEnabled();
  });

  it('shows a cry already in Mood as marked', async () => {
    const mood = { ...base, id: 'mood_1', level: 4, startedAt: at('2026-10-13T02:31'), type: 'mood' } as CareEvent;
    render(<NightReport averageRange={week} events={[...events, mood]} loadNursery={async () => nursery} now={now} onMarkCries={vi.fn()} scopeLabel="this week" />);

    fireEvent.click(await screen.findByRole('button', { name: /· 1m in Mood/ }));
    expect(screen.getByText('In Mood as crying.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Mark/ })).not.toBeInTheDocument();
  });

  it('is read-only without a way to log', () => {
    render(<NightReport averageRange={week} events={events} now={now} scopeLabel="this week" />);

    expect(screen.queryByRole('button', { name: /estimated sleep/ })).not.toBeInTheDocument();
  });

  it('says so when nothing was logged around a night', () => {
    render(<NightReport averageRange={getRecentNightsRange([], 7, now)} events={[]} now={now} scopeLabel="this week" />);

    expect(screen.getByText('Nothing logged around this night.')).toBeInTheDocument();
    expect(screen.getByText('No finished night logged this week.')).toBeInTheDocument();
  });
});
