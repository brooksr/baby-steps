import { beforeEach, describe, expect, it } from 'vitest';
import { loadActiveTimers, saveActiveTimers } from './timers';

const STORAGE_KEY = 'babysteps-timers';

describe('active timers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // Twins can each be nursing, so a running timer belongs to a child.
  it("keeps each child's timers to themselves", () => {
    saveActiveTimers('avery-example', { feed: { startedAt: '2026-09-02T12:00:00.000Z' } });
    saveActiveTimers('riley-example', { sleep: { startedAt: '2026-09-02T13:00:00.000Z' } });

    expect(loadActiveTimers('avery-example')).toEqual({ feed: { startedAt: '2026-09-02T12:00:00.000Z' } });
    expect(loadActiveTimers('riley-example')).toEqual({ sleep: { startedAt: '2026-09-02T13:00:00.000Z' } });
  });

  it('forgets a child with nothing running', () => {
    saveActiveTimers('avery-example', { feed: { startedAt: '2026-09-02T12:00:00.000Z' } });
    saveActiveTimers('avery-example', {});

    expect(loadActiveTimers('avery-example')).toEqual({});
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({});
  });

  // A device upgrading mid-feed had one flat map for the one baby it tracked.
  it('hands a pre-multi-child timer to the child that asks, then stores it nested', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ feed: { startedAt: '2026-09-02T12:00:00.000Z' } }));

    expect(loadActiveTimers('avery-example')).toEqual({ feed: { startedAt: '2026-09-02T12:00:00.000Z' } });

    saveActiveTimers('avery-example', { feed: { startedAt: '2026-09-02T12:00:00.000Z' } });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      'avery-example': { feed: { startedAt: '2026-09-02T12:00:00.000Z' } }
    });
  });

  // Retired keys (breastfeed/bottle) must not stick around with nothing able
  // to stop them.
  it('drops timer types the app no longer has', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'avery-example': { breastfeed: { startedAt: '2026-09-02T12:00:00.000Z' }, feed: { startedAt: '2026-09-02T12:30:00.000Z' } } })
    );

    expect(loadActiveTimers('avery-example')).toEqual({ feed: { startedAt: '2026-09-02T12:30:00.000Z' } });
  });
});
