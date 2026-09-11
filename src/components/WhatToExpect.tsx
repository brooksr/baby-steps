import { Baby, Lightbulb, Milk, Moon, Ruler, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BabyProfile } from '../domain/types';
import { getBabyFirstName, getWhatToExpect, type ChildOutlook, type PregnancyOutlook } from '../domain/whatToExpect';

interface WhatToExpectProps {
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
      <div className="section-heading">
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
        <div className="section-heading">
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
      <div className="section-heading">
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
export function WhatToExpect({ profile, now }: WhatToExpectProps) {
  const outlook = getWhatToExpect(profile, now);

  if (!outlook) {
    return null;
  }

  const name = getBabyFirstName(profile);

  return (
    <section className="section-block expect-card" aria-label="What to expect">
      {outlook.phase === 'pregnancy' ? <Pregnancy outlook={outlook} /> : <Child outlook={outlook} name={name} />}

      <p className="expect-footnote">
        General guidance, not a schedule to hit — every baby runs to their own clock. Bring anything that worries you to
        your pediatrician.
      </p>
    </section>
  );
}
