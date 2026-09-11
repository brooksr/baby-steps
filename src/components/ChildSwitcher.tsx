import { getActiveProfiles, getFirstName } from '../domain/family';
import type { BabyProfile } from '../domain/types';

interface ChildSwitcherProps {
  activeId: string;
  profiles: BabyProfile[];
  onSelect: (babyId: string) => void;
}

/**
 * Which child the app is showing. Sits in the header rather than in Settings
 * because it is read as often as it is tapped — with two babies in the house,
 * knowing whose feed you are about to log matters more than saving a tap.
 *
 * Rendered only when there is more than one child, so a single-baby tracker
 * looks exactly as it did.
 */
export function ChildSwitcher({ activeId, profiles, onSelect }: ChildSwitcherProps) {
  // Archived profiles are set aside, not gone: they keep their entries and stay
  // in Settings, but the switcher is for whoever is being tracked now.
  const showing = getActiveProfiles(profiles);

  if (showing.length < 2) {
    return null;
  }

  return (
    <div className="child-switcher" role="group" aria-label="Family">
      {showing.map((child) => {
        const selected = child.id === activeId;

        return (
          <button
            type="button"
            key={child.id}
            aria-pressed={selected}
            className={selected ? 'active' : ''}
            onClick={() => onSelect(child.id)}
          >
            {getFirstName(child)}
          </button>
        );
      })}
    </div>
  );
}
