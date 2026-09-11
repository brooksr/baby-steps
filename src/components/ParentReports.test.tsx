import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFamilyProfile } from '../domain/family';
import type { CareEvent } from '../domain/types';
import { ParentReports } from './ParentReports';

const jenni = createFamilyProfile({ kind: 'parent', name: 'Jenni Roche', parentRole: 'mom' });

/** Last night, 9:30pm to 5am. */
function lastNight() {
  const start = new Date();
  start.setDate(start.getDate() - 1);
  start.setHours(21, 30, 0, 0);
  const end = new Date(start.getTime() + 7.5 * 3600000);

  return { end, start };
}

function sleep(): CareEvent {
  const { end, start } = lastNight();
  return {
    babyId: jenni.id,
    createdAt: start.toISOString(),
    endedAt: end.toISOString(),
    id: 'sleep_1',
    startedAt: start.toISOString(),
    syncState: 'synced',
    type: 'sleep',
    updatedAt: start.toISOString()
  } as CareEvent;
}

function feed(hoursIntoNight: number, caregiverId?: string): CareEvent {
  const at = new Date(lastNight().start.getTime() + hoursIntoNight * 3600000);
  return {
    babyId: 'theo-roche',
    caregiverId,
    createdAt: at.toISOString(),
    id: `feed_${hoursIntoNight}`,
    method: 'nursing',
    startedAt: at.toISOString(),
    syncState: 'synced',
    type: 'feed',
    updatedAt: at.toISOString()
  } as CareEvent;
}

describe('ParentReports', () => {
  // Regression: these cards once showed the household totals as the parent's
  // own, which reads as credit for work someone else did.
  it('shows this parent\'s recorded share over the household total', () => {
    render(
      <ParentReports
        childEvents={[feed(4, jenni.id), feed(6, 'brooks-roche')]}
        events={[sleep()]}
        profile={jenni}
      />
    );

    const nightDuty = screen.getByText('Night duty').closest('.metric-card');
    expect(nightDuty).toHaveTextContent('1');
    expect(nightDuty).toHaveTextContent('of 2');
  });

  it('reports rest net of the wake-up and the settling after it', () => {
    render(<ParentReports childEvents={[feed(4, jenni.id)]} events={[sleep()]} profile={jenni} />);

    // 7h30 in bed, one wake-up, 15 minutes to settle.
    const inBed = screen.getByText('In bed').closest('.metric-card');
    expect(inBed).toHaveTextContent('7h 30m');
    expect(inBed).toHaveTextContent('15m of it awake');
  });

  // A wake-up the other parent got up for did not cost this one any sleep.
  it('sleeps through a wake-up recorded against someone else', () => {
    render(<ParentReports childEvents={[feed(4, 'brooks-roche')]} events={[sleep()]} profile={jenni} />);

    const inBed = screen.getByText('In bed').closest('.metric-card');
    expect(inBed).toHaveTextContent('0m of it awake');
  });
});
