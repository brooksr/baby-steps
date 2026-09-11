import { getShoppingCatalog } from './reference';
import {
  shoppingCategoryLabels,
  type ShoppingCategory,
  type ShoppingItem,
  type ShoppingStatus
} from './types';

/**
 * The shopping list. An item is a row with a state, not something that happened
 * at a time, which is why it is not a `CareEvent` — see `domain/types.ts`.
 *
 * The one rule everything else follows from: **buying something does not remove
 * it.** It goes to `done` and stays, so the list is also the household's
 * catalogue — next week's trip re-adds it with a tap instead of a retype, and
 * the edible rows are what the intake picker suggests from.
 */

/** Store order, not alphabetical: this is the order a trip actually happens in. */
export const SHOPPING_CATEGORIES: ShoppingCategory[] = [
  'produce',
  'bakery',
  'meat',
  'dairy',
  'frozen',
  'pantry',
  'drinks',
  'snacks',
  'baby',
  'health',
  'household',
  'cleaning',
  'personal',
  'pet'
];

/** Where an item lands when nothing says otherwise. */
export const DEFAULT_SHOPPING_CATEGORY: ShoppingCategory = 'pantry';

/** The statuses that mean "still to buy" — what the trip is. */
const ACTIVE_STATUSES: ShoppingStatus[] = ['need', 'cart'];

export function isShoppingCategory(value: string | undefined): value is ShoppingCategory {
  return SHOPPING_CATEGORIES.includes(value as ShoppingCategory);
}

/**
 * Two names are the same item when they differ only by case, spacing or
 * punctuation. Used to stop "Oat milk" and "oat milk " becoming two rows — the
 * whole value of the catalogue is that an item has exactly one row.
 */
export function normalizeItemName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function findItemByName(items: ShoppingItem[], name: string): ShoppingItem | undefined {
  const key = normalizeItemName(name);
  return key ? items.find((item) => normalizeItemName(item.name) === key) : undefined;
}

export function isActive(item: ShoppingItem): boolean {
  return ACTIVE_STATUSES.includes(item.status);
}

/** Still to buy, in store order and alphabetical within each aisle. */
export function getActiveItems(items: ShoppingItem[]): ShoppingItem[] {
  return sortForAisle(items.filter(isActive));
}

/**
 * Everything bought, most recent first — the half that makes re-adding cheap.
 * An item with no `completedAt` (seeded, or bought before the stamp existed)
 * sorts by name at the end rather than jumping to the top of the list.
 */
export function getBoughtItems(items: ShoppingItem[]): ShoppingItem[] {
  return items
    .filter((item) => item.status === 'done')
    .sort((left, right) => {
      if (left.completedAt && right.completedAt) {
        return right.completedAt.localeCompare(left.completedAt);
      }

      if (left.completedAt || right.completedAt) {
        return left.completedAt ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
}

function sortForAisle(items: ShoppingItem[]): ShoppingItem[] {
  return [...items].sort((left, right) => {
    const byAisle = SHOPPING_CATEGORIES.indexOf(left.category) - SHOPPING_CATEGORIES.indexOf(right.category);
    return byAisle !== 0 ? byAisle : left.name.localeCompare(right.name);
  });
}

export interface ShoppingAisle {
  category: ShoppingCategory;
  label: string;
  items: ShoppingItem[];
}

/** The active list broken into aisles, empty ones dropped. */
export function groupByAisle(items: ShoppingItem[]): ShoppingAisle[] {
  const sorted = sortForAisle(items.filter(isActive));

  return SHOPPING_CATEGORIES.map((category) => ({
    category,
    items: sorted.filter((item) => item.category === category),
    label: shoppingCategoryLabels[category]
  })).filter((aisle) => aisle.items.length > 0);
}

/**
 * Names to offer while someone types, newest-relevant first: what is already on
 * the list is excluded, since suggesting it would only add it twice.
 */
export function suggestItems(items: ShoppingItem[], query: string, limit = 8): ShoppingItem[] {
  const key = normalizeItemName(query);

  if (!key) {
    return [];
  }

  const candidates = items.filter((item) => !isActive(item) && normalizeItemName(item.name).includes(key));

  // A name that starts with what was typed is the likelier match, so it leads.
  return candidates
    .sort((left, right) => {
      const leftStarts = normalizeItemName(left.name).startsWith(key);
      const rightStarts = normalizeItemName(right.name).startsWith(key);

      if (leftStarts !== rightStarts) {
        return leftStarts ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    })
    .slice(0, limit);
}

/** The edible rows, for the "what you ate" picker. See `ShoppingItem.isFood`. */
export function getFoodNames(items: ShoppingItem[]): string[] {
  return [...new Set(items.filter((item) => item.isFood).map((item) => item.name))].sort((left, right) =>
    left.localeCompare(right)
  );
}

export interface ShoppingCounts {
  need: number;
  cart: number;
  done: number;
}

export function getShoppingCounts(items: ShoppingItem[]): ShoppingCounts {
  return items.reduce(
    (counts, item) => {
      counts[item.status] += 1;
      return counts;
    },
    { cart: 0, done: 0, need: 0 }
  );
}

/**
 * The shipped catalogue as rows, for the one time the list is empty. Anything
 * the sheet already holds wins — this never overwrites a live list.
 */
export function getCatalogSeed(): Array<Pick<ShoppingItem, 'category' | 'isFood' | 'name' | 'status'>> {
  return getShoppingCatalog().map((row) => ({
    category: isShoppingCategory(row.category) ? row.category : DEFAULT_SHOPPING_CATEGORY,
    isFood: row.food,
    name: row.name,
    // Seeded as bought, not as needed: this is the household's history of what
    // it buys, and starting a hundred items on the list would be useless.
    status: 'done' as const
  }));
}
