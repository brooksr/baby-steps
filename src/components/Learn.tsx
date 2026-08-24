import { Check, CircleSlash, Cloud, Download, Sparkles } from 'lucide-react';
import { referenceSheets, type SheetCategory } from '../data/referenceSheets';
import { downloadText } from '../domain/download';
import { CsvTable } from './CsvTable';

const sheetGroups: Array<{ category: SheetCategory; title: string; blurb: string }> = [
  { blurb: 'WHO Child Growth Standards (2006), boys — the curves the growth charts compare against.', category: 'growth', title: 'Growth standards' },
  { blurb: 'Typical newborn output used for the first-weeks diaper & feed checks.', category: 'newborn', title: 'Newborn expectations' },
  { blurb: 'The tables behind the milestone, vaccine, temperature, tummy-time and mood features.', category: 'feature', title: 'Feature reference data' }
];

/** Things you enter by hand. One row per event type the log accepts. */
const tracked: Array<{ title: string; detail: string }> = [
  { detail: 'Nursing (side and duration) or bottle (volume and contents), as one feeding entry. Start a timer and it fills the duration in for you.', title: 'Feeding' },
  { detail: 'Pumping output in ounces, per side or both.', title: 'Pumping' },
  { detail: 'Wet, dirty, or both, with an optional colour note.', title: 'Diapers' },
  { detail: 'Sleep sessions, with a running timer for a nap in progress.', title: 'Sleep' },
  { detail: 'Bath entries, counted in days rather than hours.', title: 'Baths' },
  { detail: 'Weight, length, and head circumference, plus the birth measurements.', title: 'Growth measurements' },
  { detail: 'Temperature in °F or °C — stored once in °C, so both devices agree.', title: 'Temperature' },
  { detail: 'Minutes per tummy-time session.', title: 'Tummy time' },
  { detail: 'A 1–5 mood / fussiness level per entry.', title: 'Mood' },
  { detail: 'Scheduled, given, or skipped doses with the medication name and dose.', title: 'Medications' },
  { detail: 'Upcoming visits with provider, location, and reason.', title: 'Appointments' },
  { detail: 'Free-text notes with an optional title.', title: 'Notes' },
  { detail: 'Tick off developmental milestones and immunisations from the bundled schedules.', title: 'Milestones & vaccines' }
];

/** Things the app derives from the entries above — nothing extra to log. */
const derived: Array<{ title: string; detail: string }> = [
  { detail: 'In the first weeks, checks the day’s diapers and feeds against typical newborn minimums for that day of life — judged on pace while the day is still running, so a half-done day stays neutral rather than alarming.', title: 'Newborn daily check' },
  { detail: 'Plots weight, length and head circumference against the WHO boys’ curves (−2 SD to +2 SD), with a corrected-age view when the birth was preterm.', title: 'Growth charts' },
  { detail: 'Learns the recent gap between changes — weighted so a changing routine shows up fast — and projects the next one with a window and a confidence. It stays quiet under four intervals rather than guessing.', title: 'Next-diaper prediction' },
  { detail: 'Average wait from a feed to the next wet and the next dirty diaper, ignoring pairs more than six hours apart.', title: 'Feed → diaper timing' },
  { detail: 'A quiet nudge when a feed is past about three hours or a bath is past about three days. Nothing fires while a timer is running or with no earlier entry to measure from.', title: 'Gentle rhythm reminders' },
  { detail: 'Flags a logged temperature in the fever band, and says so more urgently under three months old. Logging and comparison only — never a diagnosis.', title: 'Fever flag' },
  { detail: 'Daily totals, first-year trend charts, and per-day averages for feeds, diapers, sleep and milk — by day, week, month, year, or a date range you pick.', title: 'Reports & trends' },
  { detail: 'Search the log, filter by type, and narrow to a date range.', title: 'Log filters' }
];

const storage: Array<{ title: string; detail: string }> = [
  { detail: 'Every entry reads and writes one shared Google Sheet, so several caregivers see the same log.', title: 'Shared Google Sheet' },
  { detail: 'The app re-reads the sheet in the background, so an entry logged on someone else’s phone appears here without a reload.', title: 'Live updates' },
  { detail: 'Installable as an app, and it keeps working without a connection — reference tables are bundled, not fetched.', title: 'Works offline' },
  { detail: 'Download everything as JSON or CSV at any time, and import a JSON export back.', title: 'Your data, exportable' }
];

const neverSupport: Array<{ title: string; detail: string }> = [
  { detail: 'Heart rate, breathing rate, blood oxygen, or continuous temperature require regulated medical sensors — a phone log cannot measure them.', title: 'Real-time vital signs' },
  { detail: 'Deciding whether a symptom (jaundice, dehydration, fever, infection) is dangerous is a clinical judgment that only a licensed clinician can make.', title: 'Diagnosing illness' },
  { detail: 'Recommending medications or doses is medical advice and must come from your pediatrician or pharmacist.', title: 'Medical advice & dosing' },
  { detail: 'Live audio/video baby monitoring needs dedicated camera hardware and is outside what a tracking log does.', title: 'Live baby monitoring' },
  { detail: 'Identifying allergies or interpreting reactions requires testing and clinical evaluation.', title: 'Allergy diagnosis' }
];

interface LearnListProps {
  items: Array<{ title: string; detail: string }>;
  tone: 'positive' | 'negative' | 'derived';
  icon: typeof Check;
}

function LearnList({ items, tone, icon: Icon }: LearnListProps) {
  return (
    <div className="learn-list">
      {items.map((item) => (
        <article className={`learn-item ${tone}`} key={item.title}>
          <Icon aria-hidden="true" />
          <div>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

export function Learn() {
  return (
    <main className="view-stack learn-view">
      <section className="section-block first-year-block">
        <div className="section-heading">
          <div>
            <h1>Learn</h1>
            <span>What BabySteps does — and what it deliberately leaves to your care team.</span>
          </div>
        </div>
        <p>
          BabySteps is a shared care log. It records what you enter and surfaces simple, well-established patterns. It is
          not a medical device and does not diagnose, monitor vitals, or give medical advice. Everything below is
          shipped and working today.
        </p>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>What you can log</h2>
            <span>Entries you make yourself, from the Home screen or the Log.</span>
          </div>
        </div>
        <LearnList items={tracked} tone="positive" icon={Check} />
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>What it works out for you</h2>
            <span>Derived from the entries above — nothing extra to log.</span>
          </div>
        </div>
        <LearnList items={derived} tone="derived" icon={Sparkles} />
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Where your data lives</h2>
          </div>
        </div>
        <LearnList items={storage} tone="positive" icon={Cloud} />
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>What it does not monitor</h2>
            <span>Things baby apps are often expected to do, but BabySteps will never support.</span>
          </div>
        </div>
        <LearnList items={neverSupport} tone="negative" icon={CircleSlash} />
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Reference data (spreadsheets)</h2>
            <span>The exact tables BabySteps uses — view inline or download the CSV.</span>
          </div>
        </div>

        {sheetGroups.map((group) => (
          <div className="sheet-group" key={group.category}>
            <h3 className="sheet-group-title">{group.title}</h3>
            <p className="sheet-group-blurb">{group.blurb}</p>
            {referenceSheets
              .filter((sheet) => sheet.category === group.category)
              .map((sheet) => (
                <details className="sheet-details" key={sheet.id}>
                  <summary>
                    <span>
                      <strong>{sheet.title}</strong>
                      <small>{sheet.description}</small>
                    </span>
                  </summary>
                  <div className="sheet-body">
                    <button
                      type="button"
                      className="tool-button sheet-download"
                      onClick={() => downloadText(sheet.filename, sheet.text)}
                    >
                      <Download aria-hidden="true" />
                      <span>Download {sheet.filename}</span>
                    </button>
                    <CsvTable text={sheet.text} />
                  </div>
                </details>
              ))}
          </div>
        ))}
      </section>

      <p className="learn-footnote">
        Growth standards come from the WHO Child Growth Standards (2006), boys — the girls&rsquo; curves are not bundled
        yet, so a profile set to girl is still charted against the boys&rsquo; reference. Newborn diaper/feed ranges are
        general lactation guidelines. Always defer to your pediatrician.
      </p>
    </main>
  );
}
