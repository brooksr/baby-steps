import { afterEach, describe, expect, it } from 'vitest';
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
  it('seeds a neutral baby profile', async () => {
    const store = makeStore();

    const profile = await store.initialize();

    expect(profile.name).toBe('Baby');
    expect(profile.dueDate).toBeUndefined();
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

  it('keeps shopping and task rows in snapshots and exports', async () => {
    const source = makeStore();
    const seeded = await source.listShoppingItems();
    expect(seeded).toContainEqual(expect.objectContaining({ name: 'Apples', status: 'done' }));

    const apples = seeded.find((item) => item.name === 'Apples');
    await source.saveShoppingItem({ id: apples?.id, status: 'need' });
    await source.saveTask({ title: 'Wash bottles' });

    const snapshot = await source.snapshot();
    expect(snapshot.shopping).toContainEqual(expect.objectContaining({ name: 'Apples', status: 'need' }));
    expect(snapshot.tasks).toContainEqual(expect.objectContaining({ status: 'open', title: 'Wash bottles' }));

    const target = makeStore();
    await target.importData(await source.exportData(), { mode: 'replace' });
    expect(await target.listShoppingItems()).toContainEqual(expect.objectContaining({ name: 'Apples', status: 'need' }));
    expect(await target.listTasks()).toContainEqual(expect.objectContaining({ title: 'Wash bottles' }));
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

  it('keeps each child\'s entries to themselves', async () => {
    const store = makeStore();
    const avery = await store.initialize();
    const riley = await store.addProfile({ dueDate: '2028-03-04', name: 'Riley Example' });

    await store.addEvent({ kind: 'wet', startedAt: '2026-09-02T13:00:00.000Z', type: 'diaper' });
    await store.addEvent({ babyId: riley.id, kind: 'dirty', startedAt: '2028-03-05T13:00:00.000Z', type: 'diaper' });

    const firstSnapshot = await store.snapshot();
    const secondSnapshot = await store.snapshot({ babyId: riley.id });

    // No babyId means the first child, so an existing device is unaffected.
    expect(firstSnapshot.profile.id).toBe(avery.id);
    expect(firstSnapshot.events.map((event) => event.startedAt)).toEqual(['2026-09-02T13:00:00.000Z']);
    expect(secondSnapshot.profile.id).toBe(riley.id);
    expect(secondSnapshot.events.map((event) => event.startedAt)).toEqual(['2028-03-05T13:00:00.000Z']);
    // Both snapshots carry the whole switcher, oldest first.
    expect(firstSnapshot.profiles.map((child) => child.name)).toEqual(['Baby', 'Riley Example']);
  });

  it('patches the child a save names, not whoever is first', async () => {
    const store = makeStore();
    const avery = await store.initialize();
    const riley = await store.addProfile({ dueDate: '2028-03-04', name: 'Riley Example' });

    await store.saveProfile({ birthDate: '2028-03-06', id: riley.id });

    const profiles = await store.listProfiles();
    expect(profiles.find((child) => child.id === riley.id)?.birthDate).toBe('2028-03-06');
    expect(profiles.find((child) => child.id === avery.id)?.birthDate).toBeUndefined();
  });

  // Archiving is never a deletion. A family may be setting a profile aside for
  // the saddest of reasons, and everything has to still be there afterwards.
  it('archives without touching the profile or its entries, and can undo it', async () => {
    const store = makeStore();
    const avery = await store.initialize();
    const riley = await store.addProfile({ dueDate: '2028-03-04', name: 'Riley Example' });
    await store.addEvent({ babyId: riley.id, kind: 'wet', startedAt: '2028-03-05T13:00:00.000Z', type: 'diaper' });

    await store.archiveProfile(riley.id);

    const archived = (await store.listProfiles()).find((person) => person.id === riley.id);
    expect(archived?.archivedAt).toBeTruthy();
    expect(archived?.name).toBe('Riley Example');
    expect(await store.listEvents({ babyId: riley.id })).toHaveLength(1);
    // The switcher moves off them rather than opening on someone set aside.
    expect((await store.snapshot({ babyId: riley.id })).profile.id).toBe(avery.id);

    await store.restoreProfile(riley.id);

    expect((await store.listProfiles()).find((person) => person.id === riley.id)?.archivedAt).toBeUndefined();
  });

  it('exports and imports every child, not just the first', async () => {
    const source = makeStore();
    await source.initialize();
    const riley = await source.addProfile({ dueDate: '2028-03-04', name: 'Riley Example' });
    await source.addEvent({ kind: 'wet', startedAt: '2026-09-02T13:00:00.000Z', type: 'diaper' });
    await source.addEvent({ babyId: riley.id, kind: 'dirty', startedAt: '2028-03-05T13:00:00.000Z', type: 'diaper' });

    const exported = await source.exportData();
    expect(exported.profiles?.map((child) => child.name)).toEqual(['Baby', 'Riley Example']);
    expect(exported.events).toHaveLength(2);

    const target = makeStore();
    await target.importData(exported, { mode: 'replace' });

    expect((await target.listProfiles()).map((child) => child.name)).toEqual(['Baby', 'Riley Example']);
    expect(await target.listEvents({ babyId: riley.id })).toHaveLength(1);
  });

  // An export taken before the app tracked siblings carries one profile only.
  it('imports a single-child export', async () => {
    const source = makeStore();
    const profile = await source.initialize();
    await source.addEvent({ kind: 'wet', startedAt: '2026-09-02T13:00:00.000Z', type: 'diaper' });
    const { events } = await source.exportData();

    const target = makeStore();
    await target.importData({ events, exportedAt: new Date().toISOString(), profile, version: 1 }, { mode: 'replace' });

    expect((await target.listProfiles()).map((child) => child.name)).toEqual(['Baby']);
    expect(await target.listEvents()).toHaveLength(1);
  });
});
