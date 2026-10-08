import { X } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ReportDetail {
  event?: string;
  chartHtml?: string;
  notes: string[];
  title: string;
  value: string;
}

interface ReportExplorerProps {
  children: ReactNode;
}

function explanationFor(title: string) {
  const exact: Record<string, string> = {
    'Avg feed gap': 'The mean time between consecutive feeds in the selected period. Gaps longer than eight hours are treated as overnight breaks and left out.',
    'Bottle': 'Milk recorded from bottle feeds on the selected day. Nursing volume is not estimated.',
    'Cycle day': 'Days are counted from the first logged day of the current period.',
    'Cycle length': 'Measured start to start across recent counted cycles. Very short or long gaps are shown in history but excluded from predictions.',
    'Dirty': 'Dirty changes on the selected day. When sizes were logged, the weighted poop total keeps a small change from counting the same as a large one.',
    'Feeds': 'The number of feeds recorded in the selected period, including nursing and bottles.',
    'In bed': 'Average elapsed time from going to bed to getting up. Rest is lower because recorded wake-ups and settling time are subtracted.',
    'Inputs': 'Food and drinks logged in the selected period. Structured tags make entries comparable later; free text remains useful context.',
    'Longest sleep': 'The longest completed sleep entry in the full log, not only the currently selected period.',
    'Longest stretch': 'The average longest uninterrupted rest stretch per night. The supporting best value is the strongest single night in the period.',
    'Meds': 'Medication entries marked as given on the selected day.',
    'Night duty': 'Baby-care entries attributed to this parent between 10pm and 6am. Unattributed entries are not assigned to either parent.',
    'Nights logged': 'Nights with a usable parent sleep entry in the selected period.',
    'Nursing': 'Total recorded nursing time on the selected day. Sessions without a duration do not add minutes.',
    'Nursing L/R': 'The share of single-side nursing sessions recorded on the left and right. Sessions marked both are not forced onto either side.',
    'Outputs': 'Symptoms and body outputs logged in the selected period. Counts describe the log; they do not establish that an input caused an output.',
    'Period length': 'Average number of logged bleeding days in recent periods. Missed logging can make this look shorter.',
    'Pumped': 'Milk volume recorded from pumping sessions on the selected day.',
    'Ready to compare': 'The share of outputs with an input logged during the prior comparison window. This measures data coverage, not causation.',
    'Weight gain': 'The weekly rate between consecutive weight measurements. Closely spaced readings can vary with timing, feeding, and scale conditions.',
    'Wet': 'Wet changes recorded on the selected day. A change marked both wet and dirty contributes to both details.',
    'Wake-ups/night': 'Average recorded care interruptions during parent sleep. Nearby baby-care entries are grouped into one wake-up.'
  };

  if (exact[title]) {
    return exact[title];
  }

  if (title.startsWith('Feed →')) {
    return 'Average wait from a feed to the next matching diaper. Pairs more than six hours apart are treated as unrelated and excluded.';
  }

  if (title.includes('/day')) {
    return 'A per-day average for the selected span. Today is adjusted for how much of the day has elapsed, so an unfinished day does not drag the average down.';
  }

  if (title.includes('Sleep')) {
    return 'Sleep totals use completed logged sessions. Open timers and missing end times are not counted as completed sleep.';
  }

  if (title.includes('Diaper') || title.includes('Poops')) {
    return 'Diaper figures come from the changes logged in the selected period. Wet and dirty details may overlap when one change was both.';
  }

  return 'This expands the values calculated for the current report selection. Change the period or date on the Reports screen to recalculate it.';
}

function detailFromCard(card: HTMLElement): ReportDetail | null {
  const readText = (node: HTMLElement | null) => (node?.innerText ?? node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const title = readText(card.querySelector<HTMLElement>('.chart-heading h3, :scope > span'));
  const value = readText(card.querySelector<HTMLElement>('.chart-heading > strong, :scope > strong'));

  if (!title) {
    return null;
  }

  const notes = [...card.querySelectorAll<HTMLElement>('small, .chart-readout, .chart-legend-item, .chart-stats span')]
    .map(readText)
    .filter((note, index, all) => note && note !== value && all.indexOf(note) === index);

  return {
    chartHtml: card.classList.contains('chart-card') ? card.innerHTML : undefined,
    event: card.dataset.event,
    notes,
    title,
    value
  };
}

export function ReportExplorer({ children }: ReportExplorerProps) {
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const cards = rootRef.current?.querySelectorAll<HTMLElement>('.metric-card, .chart-card');
    cards?.forEach((card) => {
      card.classList.add('report-drilldown-trigger');
      if (card.classList.contains('metric-card')) {
        card.setAttribute('aria-haspopup', 'dialog');
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
      }
    });
  });

  useEffect(() => {
    if (!detail) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetail(null);
      }
    };
    window.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleEscape);
      triggerRef.current?.focus();
    };
  }, [detail]);

  function openCard(card: HTMLElement) {
    const nextDetail = detailFromCard(card);
    if (nextDetail) {
      triggerRef.current = card;
      setDetail(nextDetail);
    }
  }

  function handleClick(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>('.metric-card, .chart-card');
    if (!card || !rootRef.current?.contains(card)) {
      return;
    }

    // Chart columns, links, and controls keep their own behavior. The rest of
    // the card is the drill-down target.
    const explicitOpener = target.closest('[data-report-open]');
    if (target.closest('button, a, input, select, textarea') && !explicitOpener) {
      return;
    }

    openCard(card);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    const card = (event.target as HTMLElement).closest<HTMLElement>('.metric-card, .chart-card');
    if (card && event.target === card) {
      event.preventDefault();
      openCard(card);
    }
  }

  return (
    <>
      <main className="view-stack" ref={rootRef} onClick={handleClick} onKeyDown={handleKeyDown}>
        {children}
      </main>
      {detail && createPortal(
        <div className="report-detail-screen" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setDetail(null);
        }}>
          <section className="report-detail" role="dialog" aria-modal="true" aria-labelledby="report-detail-title" data-event={detail.event}>
            <header className="report-detail-header">
              <div>
                <span>Report detail</span>
                <h2 id="report-detail-title">{detail.title}</h2>
              </div>
              <button className="tool-button" type="button" onClick={() => setDetail(null)} aria-label="Close report detail" autoFocus>
                <X aria-hidden="true" />
              </button>
            </header>

            <div className="report-detail-body">
              <section className="report-detail-value" data-event={detail.event}>
                <span>{detail.title}</span>
                <strong>{detail.value || '—'}</strong>
              </section>

              {detail.chartHtml && (
                <section className="chart-card report-detail-chart" data-event={detail.event} aria-hidden="true" dangerouslySetInnerHTML={{ __html: detail.chartHtml }} />
              )}

              {detail.notes.length > 0 && (
                <section className="report-detail-section">
                  <h3>In this report</h3>
                  <ul>
                    {detail.notes.map((note) => <li key={note}>{note}</li>)}
                  </ul>
                </section>
              )}

              <section className="report-detail-section">
                <h3>How to read it</h3>
                <p>{explanationFor(detail.title)}</p>
              </section>
            </div>
          </section>
        </div>,
        document.body
      )}
    </>
  );
}
