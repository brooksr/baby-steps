import { describe, expect, it } from 'vitest';
import { migrateStoredEvent, type StoredCareEvent } from './legacyEvents';

const base = {
  babyId: 'theo-roche',
  createdAt: '2026-09-20T08:00:00.000Z',
  id: 'diaper-1',
  startedAt: '2026-09-20T08:00:00.000Z',
  updatedAt: '2026-09-20T08:00:00.000Z'
};

function migrateDiaper(event: Partial<StoredCareEvent>) {
  const migrated = migrateStoredEvent({ ...base, kind: 'dirty', type: 'diaper', ...event } as StoredCareEvent);

  if (migrated.type !== 'diaper') {
    throw new Error('expected a diaper event');
  }

  return migrated;
}

describe('diaper rows', () => {
  it('resolves a free-text color to a reference id', () => {
    expect(migrateDiaper({ color: 'Mustard' }).color).toBe('normal');
  });

  it('fills color and size from the note when the fields are empty', () => {
    const migrated = migrateDiaper({ notes: 'huge green one after the bottle' });
    expect(migrated).toMatchObject({ color: 'green', poopSize: 'large' });
  });

  it('prefers the logged fields over the note', () => {
    const migrated = migrateDiaper({ color: 'black', notes: 'small green smear', poopSize: 'medium' });
    expect(migrated).toMatchObject({ color: 'black', poopSize: 'medium' });
  });

  it('leaves a wet change undescribed — there is no stool to read', () => {
    const migrated = migrateDiaper({ kind: 'wet', notes: 'big yellow leak up the back' });
    expect(migrated).toMatchObject({ color: undefined, poopSize: undefined });
  });

  it('drops a size that is not one of the three', () => {
    expect(migrateDiaper({ poopSize: 'enormous' }).poopSize).toBeUndefined();
  });
});

describe('pre-merge feed rows', () => {
  it('reads a breastfeed row as a nursing feed', () => {
    expect(migrateStoredEvent({ ...base, durationMinutes: 12, side: 'left', type: 'breastfeed' } as StoredCareEvent)).toMatchObject({
      method: 'nursing',
      side: 'left',
      type: 'feed'
    });
  });

  it('reads a bottle row as a bottle feed', () => {
    expect(migrateStoredEvent({ ...base, amountOz: 3, type: 'bottle' } as StoredCareEvent)).toMatchObject({
      contents: 'breastmilk',
      method: 'bottle',
      type: 'feed'
    });
  });
});
