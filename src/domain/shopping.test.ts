import { describe, expect, it } from 'vitest';
import { getCatalogSeed, getFoodNames, groupByAisle, normalizeItemName } from './shopping';
import type { ShoppingItem } from './types';

function item(overrides: Partial<ShoppingItem>): ShoppingItem {
  return {
    category: 'pantry',
    createdAt: '2026-09-11T12:00:00.000Z',
    id: 'shop_1',
    isFood: false,
    name: 'Item',
    status: 'done',
    updatedAt: '2026-09-11T12:00:00.000Z',
    ...overrides
  };
}

describe('shopping list', () => {
  it('seeds the supplied catalogue as completed history', () => {
    const seed = getCatalogSeed();

    expect(seed.length).toBeGreaterThan(90);
    expect(seed).toContainEqual(expect.objectContaining({ isFood: true, name: 'Apples', status: 'done' }));
    expect(seed).toContainEqual(expect.objectContaining({ isFood: false, name: 'Diapers', status: 'done' }));
  });

  it('normalizes duplicates and exposes only food rows to input suggestions', () => {
    expect(normalizeItemName(' Oat-milk! ')).toBe('oat milk');
    expect(getFoodNames([item({ isFood: true, name: 'Oat milk' }), item({ id: 'shop_2', name: 'Paper towels' })]))
      .toEqual(['Oat milk']);
  });

  it('groups active items in store order and leaves completed items out', () => {
    const groups = groupByAisle([
      item({ category: 'pantry', id: 'shop_1', name: 'Rice', status: 'need' }),
      item({ category: 'produce', id: 'shop_2', name: 'Bananas', status: 'cart' }),
      item({ category: 'produce', id: 'shop_3', name: 'Apples', status: 'done' })
    ]);

    expect(groups.map((group) => group.category)).toEqual(['produce', 'pantry']);
    expect(groups[0].items.map((entry) => entry.name)).toEqual(['Bananas']);
  });
});
