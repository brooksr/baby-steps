import { useState } from 'react';
import { Baby, ChevronDown, ChevronLeft, ChevronRight, Lightbulb, Milk, Moon, Ruler, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getFetalWeeks } from '../domain/reference';
import type { BabyProfile, CareEvent } from '../domain/types';
import { COVERAGE_END_DAYS, getBabyFirstName, getWhatToExpect, type ChildOutlook, type Outlook, type PregnancyOutlook } from '../domain/whatToExpect';

interface WhatToExpectProps {
  events?: CareEvent[];
  profile: BabyProfile;
  /** Overridable so a test can stand at a fixed point in the two years. */
  now?: Date;
}

interface Facet {
  icon: LucideIcon;
  label: string;
  text: string;
}

function Facets({ facets }: { facets: Facet[] }) {
  return (
    <div className="expect-facets">
      {facets.map((facet) => {
        const Icon = facet.icon;

        return (
          <article className="expect-facet" key={facet.label}>
            <Icon aria-hidden="true" />
            <div>
              <strong>{facet.label}</strong>
              <span>{facet.text}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** The researched, actionable bullets for this stage. */
function Facts({ facts }: { facts: string[] }) {
  if (facts.length === 0) {
    return null;
  }

  return (
    <ul className="expect-facts">
      {facts.map((fact) => (
        <li key={fact}>{fact}</li>
      ))}
    </ul>
  );
}

function dayWord(days: number) {
  return `${days} day${days === 1 ? '' : 's'}`;
}

function Pregnancy({ outlook }: { outlook: PregnancyOutlook }) {
  const { daysUntilDue, week } = outlook;
  const countdown =
    daysUntilDue > 0 ? `${dayWord(daysUntilDue)} to go` : daysUntilDue === 0 ? 'due today' : `${dayWord(-daysUntilDue)} past the due date`;

  return (
    <>
      <div className="expect-stage-heading">
        <div>
          <strong className="expect-title">Week {outlook.gestationWeeks}</strong>
          <span>
            {week.trimester} trimester · {countdown}
          </span>
        </div>
      </div>

      <Facets
        facets={[
          { icon: Ruler, label: 'About the size of', text: week.size },
          { icon: Baby, label: 'Developing now', text: week.development },
          { icon: Lightbulb, label: 'Heads up', text: week.headsUp }
        ]}
      />

      <Facts facts={week.facts} />
    </>
  );
}

function Child({ outlook, name }: { outlook: ChildOutlook; name: string }) {
  const { basis, gestation, stage } = outlook;

  if (!stage) {
    // Past two years there is no written copy yet, and inventing some would be
    // worse than saying so. The Care tab still tracks milestones and vaccines.
    return (
      <>
        <div className="expect-stage-heading">
          <div>
            <strong className="expect-title">Past two years</strong>
          </div>
        </div>
        <p>
          Day-to-day guidance here is written through age two. Beyond it, the Care tab still tracks milestones and
          immunisations, and your pediatrician is the better guide.
        </p>
      </>
    );
  }

  return (
    <>
      <div className="expect-stage-heading">
        <div>
          <strong className="expect-title">{stage.label}</strong>
          <span>{basis === 'corrected' ? 'At corrected age' : `${name} right now`}</span>
        </div>
      </div>

      <p className="expect-summary">{stage.summary}</p>

      <Facets
        facets={[
          { icon: Sparkles, label: 'Development', text: stage.development },
          { icon: Milk, label: 'Feeding', text: stage.feeding },
          { icon: Moon, label: 'Sleep', text: stage.sleep },
          { icon: Lightbulb, label: 'Heads up', text: stage.headsUp }
        ]}
      />

      <Facts facts={stage.facts} />

      {outlook.notes.length > 0 && (
        <ul className="expect-notes">
          {outlook.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {basis === 'corrected' && gestation && (
        <p className="expect-basis">
          Born at <strong>{gestation.label}</strong>
          {`, ${gestation.correctionDays} days early. `}
          {/* The stage cannot fall back below the newborn window, so while a
              corrected age is still behind it the card is held there rather
              than reading at either age — say which, instead of implying the
              corrected number picked this row. */}
          {outlook.stageAgeDays > outlook.correctedAgeDays
            ? `Corrected age is ${dayWord(outlook.correctedAgeDays)}, so this stays at the end of the newborn window until it catches up.`
            : `Skills are shown at ${name}\u2019s corrected age of ${dayWord(outlook.correctedAgeDays)}.`}
          {` Feeding and diapers still run on the actual ${dayWord(outlook.ageDays)}.`}
        </p>
      )}
    </>
  );
}

/**
 * The Home screen's orientation card: what is happening this week of the
 * pregnancy, or what this day / week / month of life usually looks like. The
 * copy is reference data (see `domain/whatToExpect.ts`) picked for the profile
 * and personalized with the baby's name and pronouns.
 *
 * A preterm birth changes which row is shown, not just the wording: past the
 * newborn window the stage follows corrected age, which is said on the card
 * rather than left for the reader to work out.
 *
 * Informational only — the footnote points back at the pediatrician, like every
 * other reference range in the app.
 */
export function WhatToExpect({ events = [], profile, now }: WhatToExpectProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [navigationDate, setNavigationDate] = useState<Date | null>(null);

  const currentDate = navigationDate ?? now ?? new Date();
  const outlook = getWhatToExpect(profile, currentDate, events);

  if (!outlook) {
    return null;
  }

  const name = getBabyFirstName(profile);
  const previousDate = getAdjacentDate(events, profile, outlook, currentDate, -1);
  const nextDate = getAdjacentDate(events, profile, outlook, currentDate, 1);

  return (
    <section className="section-block expect-card" aria-label="What to expect">
      <div className="section-heading expect-card-heading">
        <h2>What to expect</h2>
        <div className="expect-card-actions">
          {!collapsed && (
            <div className="expect-navigation" aria-label="Browse advice">
              <button className="secondary-button compact" type="button" disabled={!previousDate} onClick={() => previousDate && setNavigationDate(previousDate)}>
                <ChevronLeft aria-hidden="true" />
                Previous
              </button>
              {navigationDate && (
                <button className="secondary-button compact" type="button" onClick={() => setNavigationDate(null)}>
                  Today
                </button>
              )}
              <button className="secondary-button compact" type="button" disabled={!nextDate} onClick={() => nextDate && setNavigationDate(nextDate)}>
                Next
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          )}
          <button
            className="icon-button expect-collapse"
            type="button"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand what to expect' : 'Collapse what to expect'}
            onClick={() => setCollapsed((value) => !value)}
          >
            <ChevronDown aria-hidden="true" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="expect-content">
          {outlook.phase === 'pregnancy' ? <Pregnancy outlook={outlook} /> : <Child outlook={outlook} name={name} />}

          <p className="expect-footnote">
            General guidance, not a schedule to hit — every baby runs to their own clock. Bring anything that worries you to
            your pediatrician.
          </p>
        </div>
      )}
    </section>
  );
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Lands on the adjacent written band rather than making someone tap day by day. */
function getAdjacentDate(events: CareEvent[], profile: BabyProfile, outlook: Outlook, date: Date, direction: -1 | 1): Date | null {
  if (outlook.phase === 'pregnancy') {
    const weeks = getFetalWeeks();
    const boundary = direction === -1 ? weeks[0]?.week : weeks[weeks.length - 1]?.week;
    return boundary == null || (direction === -1 ? outlook.week.week <= boundary : outlook.week.week >= boundary)
      ? null
      : addDays(date, direction * 7);
  }

  if (!outlook.stage) {
    return direction === -1 ? addDays(date, COVERAGE_END_DAYS - outlook.stageAgeDays) : null;
  }

  const targetAge = direction === -1 ? outlook.stage.fromDays - 1 : outlook.stage.toDays + 1;
  if (targetAge < 0) {
    return null;
  }

  let candidate = addDays(date, targetAge - outlook.stageAgeDays);

  // During a preterm baby's handoff from chronological to corrected age, the
  // stage can be held at the newborn boundary for several weeks. Keep walking
  // until Previous/Next really does reach a different written band.
  for (let attempt = 0; attempt <= COVERAGE_END_DAYS; attempt += 1) {
    const adjacent = getWhatToExpect(profile, candidate, events);
    if (adjacent?.phase === 'child' && adjacent.stage?.label !== outlook.stage.label) {
      return candidate;
    }
    candidate = addDays(candidate, direction);
  }

  return null;
}
