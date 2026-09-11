import { Check, Plus, RotateCcw, ShoppingCart, Trash2, X } from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';
import { getCaregiverName } from '../domain/family';
import {
  DEFAULT_SHOPPING_CATEGORY,
  SHOPPING_CATEGORIES,
  findItemByName,
  getActiveItems,
  getBoughtItems,
  getShoppingCounts,
  groupByAisle,
  suggestItems
} from '../domain/shopping';
import { shoppingCategoryLabels, type BabyProfile, type ShoppingCategory, type ShoppingItem } from '../domain/types';
import type { ShoppingItemInput } from '../storage/store';

interface ShoppingListProps {
  items: ShoppingItem[];
  /** Everyone tracked, so an item can say who put it on the list. */
  profiles?: BabyProfile[];
  /** Who is on screen — what a new item is stamped with. */
  profile?: BabyProfile;
  onSave: (input: ShoppingItemInput) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

/** How many bought items to show before the list asks to be expanded. */
const RECENT_BOUGHT = 12;

/**
 * The shared shopping list, and — because nothing is thrown away when it is
 * bought — the household's catalogue of what it buys. Adding is a type-ahead
 * over everything ever added, so the second trip is taps rather than typing.
 */
export function ShoppingList({ items, onRemove, onSave, profile, profiles = [] }: ShoppingListProps) {
  const [draft, setDraft] = useState('');
  const [category, setCategory] = useState<ShoppingCategory>(DEFAULT_SHOPPING_CATEGORY);
  const [isFood, setIsFood] = useState(false);
  const [showAllBought, setShowAllBought] = useState(false);

  const active = useMemo(() => getActiveItems(items), [items]);
  const aisles = useMemo(() => groupByAisle(active), [active]);
  const bought = useMemo(() => getBoughtItems(items), [items]);
  const counts = useMemo(() => getShoppingCounts(items), [items]);
  const suggestions = useMemo(() => suggestItems(items, draft), [draft, items]);
  // An exact match is not a suggestion — submitting already does that, and
  // offering it would read as a different item with the same name.
  const exact = useMemo(() => findItemByName(items, draft), [draft, items]);

  async function addItem(input: ShoppingItemInput) {
    setDraft('');
    setIsFood(false);
    await onSave({ addedBy: profile?.id, status: 'need', ...input });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draft.trim();

    if (!name) {
      return;
    }

    // A name already on file keeps its own category and food flag — the picker
    // above is for something the list has never seen.
    await addItem(exact ? { id: exact.id } : { category, isFood, name });
  }

  return (
    <main className="view-stack">
      <section className="section-block">
        <div className="section-heading wrap">
          <div>
            <h1>Shopping</h1>
            <span>
              {counts.need + counts.cart} to buy · {counts.done} on file
            </span>
          </div>
        </div>

        <form className="list-add" onSubmit={handleSubmit}>
          <label className="list-add-field">
            <span className="visually-hidden">Item</span>
            <input
              placeholder="Add an item"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoComplete="off" />
          </label>
          <label className="list-add-field">
            <span className="visually-hidden">Aisle</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as ShoppingCategory)}>
              {SHOPPING_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {shoppingCategoryLabels[option]}
                </option>
              ))}
            </select>
          </label>
          {!exact && (
            <label className="checkbox-line compact">
              <input type="checkbox" checked={isFood} onChange={(event) => setIsFood(event.target.checked)} />
              <span>Food or drink</span>
            </label>
          )}
          <button className="primary-button" type="submit" disabled={!draft.trim()}>
            <Plus aria-hidden="true" />
            <span>Add</span>
          </button>
        </form>

        {/* Everything bought before is a tap, not a retype — which is the whole
            reason a bought item keeps its row. */}
        {suggestions.length > 0 && (
          <div className="tag-picker" role="group" aria-label="Add something bought before">
            {suggestions.map((item) => (
              <button className="tag-chip" type="button" key={item.id} onClick={() => addItem({ id: item.id })}>
                {item.name}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>To buy</h2>
          <span>{active.length} item{active.length === 1 ? '' : 's'}</span>
        </div>

        {aisles.length === 0 ? (
          <p className="empty-state">Nothing on the list. Start typing above — everything bought before is one tap.</p>
        ) : (
          aisles.map((aisle) => (
            <div className="list-aisle" key={aisle.category}>
              <h3>{aisle.label}</h3>
              <ul className="check-list">
                {aisle.items.map((item) => {
                  const addedBy = getCaregiverName(profiles, item.addedBy);

                  return (
                    <li className={item.status === 'cart' ? 'check-row in-cart' : 'check-row'} key={item.id}>
                      <button
                        className="check-box"
                        type="button"
                        aria-pressed={item.status === 'cart'}
                        aria-label={item.status === 'cart' ? `Mark ${item.name} bought` : `Put ${item.name} in the cart`}
                        onClick={() =>
                          onSave(
                            item.status === 'cart'
                              ? { completedAt: new Date().toISOString(), id: item.id, status: 'done' }
                              : { id: item.id, status: 'cart' }
                          )
                        }
                      >
                        {item.status === 'cart' ? <Check aria-hidden="true" /> : <ShoppingCart aria-hidden="true" />}
                      </button>
                      <div className="check-body">
                        <strong>{item.name}</strong>
                        <small>
                          {[item.quantity, item.status === 'cart' ? 'in the cart' : null, addedBy ? `added by ${addedBy}` : null]
                            .filter(Boolean)
                            .join(' · ') || shoppingCategoryLabels[item.category]}
                        </small>
                      </div>
                      {/* Off the list, not out of the catalogue: this is the
                          "we don't need it after all" button, and the item is
                          still there to re-add next week. */}
                      <button
                        className="icon-button subtle"
                        type="button"
                        aria-label={`Take ${item.name} off the list`}
                        onClick={() => onSave({ id: item.id, status: 'done' })}
                      >
                        <X aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>Bought before</h2>
          <span>{bought.length}</span>
        </div>

        {bought.length === 0 ? (
          <p className="empty-state">Nothing bought yet.</p>
        ) : (
          <>
            <ul className="check-list">
              {(showAllBought ? bought : bought.slice(0, RECENT_BOUGHT)).map((item) => (
                <li className="check-row done" key={item.id}>
                  <button
                    className="check-box"
                    type="button"
                    aria-label={`Put ${item.name} back on the list`}
                    onClick={() => onSave({ completedAt: undefined, id: item.id, status: 'need' })}
                  >
                    <RotateCcw aria-hidden="true" />
                  </button>
                  <div className="check-body">
                    <strong>{item.name}</strong>
                    <small>{shoppingCategoryLabels[item.category]}</small>
                  </div>
                  <button
                    className="icon-button subtle"
                    type="button"
                    aria-label={`Forget ${item.name}`}
                    onClick={() => onRemove(item.id)}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            {bought.length > RECENT_BOUGHT && (
              <button className="secondary-button" type="button" onClick={() => setShowAllBought((current) => !current)}>
                {showAllBought ? 'Show recent only' : `Show all ${bought.length}`}
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}
