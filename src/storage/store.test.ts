import { afterEach, describe, expect, it } from 'vitest';
import { THEO_DUE_DATE } from '../domain/types';
import { createLocalBabyTrackerStore, type BabyTrackerStore } from './store';

const stores: BabyTrackerStore[] = [];

function makeStore() {
  const store = createLocalBabyTrackerStore(`babysteps-test-${crypto.randomUUID()}`);
  stores.push(store);
  return store;
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map(async (store) => {
    await store.clear();
    store.close();
  }));
});

describe('local baby tracker store', () => {
  it('seeds the Theo profile', async () => {
    const store = makeStore();

    const profile = await store.initialize();

    expect(profile.name).toBe('Theo Roche');
    expect(profile.dueDate).toBe(THEO_DUE_DATE);
  });

  it('adds, lists, exports, and imports events', async () => {
    const source = makeStore();
    await source.addEvent({
      amountOz: 2.5,
      contents: 'breastmilk',
      method: 'bottle',
      startedAt: '2026-09-02T12:00:00.000Z',
      type: 'feed'
    });
    await source.addEvent({
      kind: 'wet',
      startedAt: '2026-09-02T13:00:00.000Z',
      type: 'diaper'
    });

    const sourceEvents = await source.listEvents();
    expect(sourceEvents.map((event) => event.type)).toEqual(['diaper', 'feed']);

    const exported = await source.exportData();
    const target = makeStore();
    await target.importData(exported, { mode: 'replace' });

    const importedEvents = await target.listEvents({ sort: 'asc' });
    expect(importedEvents.map((event) => event.type)).toEqual(['feed', 'diaper']);
    expect(importedEvents[0]).toMatchObject({ amountOz: 2.5, method: 'bottle', type: 'feed' });
  });

  it('reads pre-merge nursing and bottle entries as feedings', async () => {
    const store = makeStore();
    // Written the way the old schema stored them, as an existing device would have.
    await store.addEvent({ durationMinutes: 18, side: 'left', startedAt: '2026-09-02T12:00:00.000Z', type: 'breastfeed' } as never);
    await store.addEvent({ amountOz: 3, contents: 'formula', startedAt: '2026-09-02T15:00:00.000Z', type: 'bottle' } as never);

    const events = await store.listEvents({ sort: 'asc' });

    expect(events).toMatchObject([
      { durationMinutes: 18, method: 'nursing', side: 'left', type: 'feed' },
      { amountOz: 3, contents: 'formula', method: 'bottle', type: 'feed' }
    ]);
  });
});
