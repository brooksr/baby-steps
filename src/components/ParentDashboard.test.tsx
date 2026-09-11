import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getLocalDateKey } from '../domain/dates';
import { createFamilyProfile } from '../domain/family';
import type { CareEvent } from '../domain/types';
import { ParentDashboard } from './ParentDashboard';

const brooks = createFamilyProfile({ kind: 'parent', name: 'Brooks Roche', parentRole: 'dad' });

/** Last night, 10:30pm to 5am — the span from the screenshot. */
function lastNight() {
  const start = new Date();
  start.setDate(start.getDate() - 1);
  start.setHours(22, 30, 0, 0);
  return { end: new Date(start.getTime() + 6.5 * 3600000), start };
}

function sleep(): CareEvent {
  const { end, start } = lastNight();
  return {
    babyId: brooks.id,
    createdAt: start.toISOString(),
    endedAt: end.toISOString(),
    id: 'sleep_1',
    startedAt: start.toISOString(),
    syncState: 'synced',
    type: 'sleep',
    updatedAt: start.toISOString()
  } as CareEvent;
}

function feed(hoursIn: number, caregiverId?: string): CareEvent {
  const at = new Date(lastNight().start.getTime() + hoursIn * 3600000);
  return {
    babyId: 'theo-roche',
    caregiverId,
    createdAt: at.toISOString(),
    id: `feed_${hoursIn}`,
    method: 'nursing',
    startedAt: at.toISOString(),
    syncState: 'synced',
    type: 'feed',
    updatedAt: at.toISOString()
  } as CareEvent;
}

function renderDashboard(childEvents: CareEvent[]) {
  return render(
    <ParentDashboard
      activeTimers={{}}
      childEvents={childEvents}
      events={[sleep()]}
      profile={brooks}
      todayKey={getLocalDateKey(new Date())}
      onAdd={vi.fn()}
    />
  );
}

describe('ParentDashboard', () => {
  // Charging a broken night to the parent who slept through it is what
  // recording a caregiver is there to prevent.
  it('does not charge wake-ups nobody was recorded for', () => {
    renderDashboard([feed(1), feed(3), feed(5)]);

    // The headline is the rest, and with nothing charged it is the whole span.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('6h 30m');
    expect(screen.getByText(/6h 30m in bed · 0 wake-ups/)).toBeInTheDocument();
  });

  it('charges the wake-ups recorded against this parent', () => {
    renderDashboard([feed(3, brooks.id)]);

    expect(screen.getByText(/6h 30m in bed · 1 wake-up/)).toBeInTheDocument();
  });

  // The sleep you just got up from started yesterday evening; keying it by the
  // day it started left the morning showing nothing logged.
  it('counts last night\'s sleep as today', () => {
    renderDashboard([]);

    expect(screen.getByText('1 entry')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing logged for Brooks today/)).toBeNull();
  });

  // Measuring from the start answered a question nobody asks — what you want to
  // know in the morning is how long you have been up.
  it('counts from the end of the last sleep', () => {
    renderDashboard([]);

    const { end } = lastNight();
    const hoursUp = Math.round((Date.now() - end.getTime()) / 3_600_000);

    expect(screen.getByText('Awake for')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`^${hoursUp}h`))).toBeInTheDocument();
  });

  it('counts from the start while a sleep is still running', () => {
    const running = { ...sleep(), endedAt: undefined } as CareEvent;

    render(
      <ParentDashboard
        activeTimers={{}}
        childEvents={[]}
        events={[running]}
        profile={brooks}
        todayKey={getLocalDateKey(new Date())}
        onAdd={vi.fn()}
      />
    );

    expect(screen.getByText('Asleep for')).toBeInTheDocument();
  });
});
