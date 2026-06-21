import { useMemo, useState } from 'react';
import { careEventLabels, type BabyProfile, type CareEvent, type CareEventType } from '../domain/types';
import { Timeline } from './Timeline';

const PAGE_SIZE = 20;

type FilterGroup = 'all' | 'feeds' | 'diapers' | 'sleep' | 'health' | 'growth' | 'other';

const FILTER_OPTIONS: Array<{ id: FilterGroup; label: string; types: CareEventType[] | null }> = [
  { id: 'all', label: 'All types', types: null },
  { id: 'feeds', label: 'Feeds', types: ['breastfeed', 'bottle', 'pump'] },
  { id: 'diapers', label: 'Diapers', types: ['diaper'] },
  { id: 'sleep', label: 'Sleep', types: ['sleep'] },
  { id: 'health', label: 'Health', types: ['medication', 'temperature', 'vaccine'] },
  { id: 'growth', label: 'Growth', types: ['birth', 'growth', 'milestone', 'tummytime'] },
  { id: 'other', label: 'Other', types: ['appointment', 'mood', 'note'] }
];

function searchText(event: CareEvent): string {
  const parts: string[] = [careEventLabels[event.type]];

  switch (event.type) {
    case 'breastfeed':
      parts.push(event.side);
      break;
    case 'bottle':
      parts.push(event.contents, `${event.amountOz} oz`);
      break;
    case 'pump':
      parts.push(`${event.amountOz} oz`, event.side);
      break;
    case 'diaper':
      parts.push(event.kind, event.color ?? '');
      break;
    case 'medication':
      parts.push(event.medicationName, event.dose, event.status);
      break;
    case 'appointment':
      parts.push(event.reason, event.provider ?? '', event.location ?? '');
      break;
    case 'note':
      parts.push(event.title ?? '');
      break;
    case 'temperature':
      parts.push(String(event.celsius));
      break;
    case 'mood':
      parts.push(`level ${event.level}`);
      break;
    default:
      break;
  }

  if (event.notes) parts.push(event.notes);

  return parts.join(' ').toLowerCase();
}

interface LogProps {
  events: CareEvent[];
  firstYearEvents: CareEvent[];
  profile: BabyProfile;
  onAdd: (type: CareEventType) => void;
  onDelete: (id: string) => void;
}

export function Log({ events, firstYearEvents, profile, onAdd, onDelete }: LogProps) {
  const [scope, setScope] = useState<'all' | 'first-year'>('all');
  const [filter, setFilter] = useState<FilterGroup>('all');
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const scopedEvents = scope === 'all' ? events : firstYearEvents;

  const filtered = useMemo(() => {
    let result = scopedEvents;

    const filterOption = FILTER_OPTIONS.find((o) => o.id === filter);
    if (filterOption?.types) {
      const allowed = new Set(filterOption.types);
      result = result.filter((e) => allowed.has(e.type));
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((e) => searchText(e).includes(q));
    }

    return result;
  }, [scopedEvents, filter, search]);

  function handleSearch(value: string) {
    setSearch(value);
    setVisibleCount(PAGE_SIZE);
  }

  function handleFilter(value: FilterGroup) {
    setFilter(value);
    setVisibleCount(PAGE_SIZE);
  }

  const visible = filtered.slice(0, visibleCount);
  const remaining = filtered.length - visibleCount;
  const hasMore = remaining > 0;

  return (
    <main className="view-stack">
      <section className="section-block">
        <div className="section-heading">
          <div>
            <h1>Log</h1>
            <span>{filtered.length} of {scopedEvents.length}</span>
          </div>
          <div className="button-row">
            <div className="segmented-control" aria-label="Log scope">
              <button type="button" className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>All</button>
              <button type="button" className={scope === 'first-year' ? 'active' : ''} onClick={() => setScope('first-year')}>First year</button>
            </div>
            {!profile.birthDate && (
              <button className="secondary-button compact" type="button" onClick={() => onAdd('birth')}>Log birth</button>
            )}
            <button className="primary-button compact" type="button" onClick={() => onAdd('note')}>Add note</button>
          </div>
        </div>

        <div className="log-controls">
          <input
            className="log-search"
            type="search"
            placeholder="Search entries…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            aria-label="Search log entries"
          />
          <select
            className="log-filter"
            value={filter}
            onChange={(e) => handleFilter(e.target.value as FilterGroup)}
            aria-label="Filter by type"
          >
            {FILTER_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>

        <Timeline
          events={visible}
          onDelete={onDelete}
          emptyMessage={search || filter !== 'all' ? 'No matching entries.' : 'No entries yet.'}
        />

        {hasMore && (
          <button
            className="secondary-button load-more"
            type="button"
            onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
          >
            Load {Math.min(PAGE_SIZE, remaining)} more · {remaining} remaining
          </button>
        )}
      </section>
    </main>
  );
}
