import { Check, CircleSlash, Download, Sparkles } from 'lucide-react';
import { referenceSheets, type SheetCategory } from '../data/referenceSheets';
import { downloadText } from '../domain/download';
import { CsvTable } from './CsvTable';

const sheetGroups: Array<{ category: SheetCategory; title: string; blurb: string }> = [
  { blurb: 'WHO Child Growth Standards (2006), boys — the curves the growth charts compare against.', category: 'growth', title: 'Growth standards' },
  { blurb: 'Typical newborn output used for the first-weeks diaper & feed checks.', category: 'newborn', title: 'Newborn expectations' },
  { blurb: 'Data backing the planned features below — already bundled, ready to build on.', category: 'feature', title: 'Feature reference data' }
];

const monitors: Array<{ title: string; detail: string }> = [
  { detail: 'Nursing sessions and duration, bottle volume, and pumping output — with daily feed counts.', title: 'Feeding' },
  { detail: 'Wet, dirty, and mixed diapers with color notes, and totals per day.', title: 'Diapers' },
  { detail: 'Sleep sessions and total sleep time, including an in-progress nap timer.', title: 'Sleep' },
  { detail: 'Weight, length, and head circumference compared against WHO boy growth standards (−2 SD to +2 SD).', title: 'Growth' },
  { detail: 'In the first weeks, flags whether daily diapers and feeds meet typical newborn minimums for that day of life.', title: 'Newborn output' },
  { detail: 'Manually logged temperature with automatic °F/°C conversion and a fever flag (logging, not diagnosis).', title: 'Temperature' },
  { detail: 'Tummy-time minutes per session and per day.', title: 'Tummy time' },
  { detail: 'Mood / fussiness level (1–5) per entry.', title: 'Mood' },
  { detail: 'Scheduled / given / skipped doses with reminders for what is due soon.', title: 'Medications' },
  { detail: 'Developmental milestone checklist by age, with age-appropriate prompts.', title: 'Milestones' },
  { detail: 'Immunization schedule anchored to birth date, with due and overdue flags.', title: 'Vaccinations' },
  { detail: 'Upcoming visits with provider and location, plus the shared family calendar and photo album.', title: 'Appointments & calendar' },
  { detail: 'Free-text notes, plus first-year trend charts.', title: 'Notes & trends' }
];

const neverSupport: Array<{ title: string; detail: string }> = [
  { detail: 'Heart rate, breathing rate, blood oxygen, or continuous temperature require regulated medical sensors — a phone log cannot measure them.', title: 'Real-time vital signs' },
  { detail: 'Deciding whether a symptom (jaundice, dehydration, fever, infection) is dangerous is a clinical judgment that only a licensed clinician can make.', title: 'Diagnosing illness' },
  { detail: 'Recommending medications or doses is medical advice and must come from your pediatrician or pharmacist.', title: 'Medical advice & dosing' },
  { detail: 'Live audio/video baby monitoring needs dedicated camera hardware and is outside what a tracking log does.', title: 'Live baby monitoring' },
  { detail: 'Identifying allergies or interpreting reactions requires testing and clinical evaluation.', title: 'Allergy diagnosis' }
];

const feasible: Array<{ title: string; detail: string }> = [
  { detail: 'Freezer stash / pumped-milk inventory tracking.', title: 'Milk inventory' },
  { detail: 'Push reminders for feeds and medications.', title: 'Feed & med reminders' },
  { detail: 'A photo growth journal and PDF export to share with your pediatrician.', title: 'Photo journal & export' },
  { detail: 'Multi-caregiver shift handoff notes.', title: 'Caregiver handoffs' }
];

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
          not a medical device and does not diagnose, monitor vitals, or give medical advice.
        </p>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>What this app monitors</h2>
        </div>
        <div className="learn-list">
          {monitors.map((item) => (
            <article className="learn-item positive" key={item.title}>
              <Check aria-hidden="true" />
              <div>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>What it does not monitor</h2>
            <span>Things baby apps are often expected to do, but BabySteps will never support.</span>
          </div>
        </div>
        <div className="learn-list">
          {neverSupport.map((item) => (
            <article className="learn-item negative" key={item.title}>
              <CircleSlash aria-hidden="true" />
              <div>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Planned for V2</h2>
            <span>Feasible features deferred to a future version.</span>
          </div>
        </div>
        <div className="learn-list">
          {feasible.map((item) => (
            <article className="learn-item future" key={item.title}>
              <Sparkles aria-hidden="true" />
              <div>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </div>
            </article>
          ))}
        </div>
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
        Growth standards come from the WHO Child Growth Standards (2006), boys. Newborn diaper/feed ranges are general
        lactation guidelines. Always defer to your pediatrician.
      </p>
    </main>
  );
}
