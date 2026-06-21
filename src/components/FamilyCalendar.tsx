import { CalendarPlus, CalendarDays } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getCalendarEmbedUrl, SHARED_CALENDAR_SUBSCRIBE_URL } from '../domain/calendar';

export function FamilyCalendar() {
  const [open, setOpen] = useState(false);
  const embedUrl = useMemo(() => getCalendarEmbedUrl(), []);

  return (
    <section className="section-block" aria-label="Family calendar">
      <div className="section-heading">
        <div>
          <h2>Family calendar</h2>
          <span>Shared appointments &amp; reminders</span>
        </div>
        <button className="secondary-button compact" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          <CalendarDays aria-hidden="true" />
          <span>{open ? 'Hide' : 'Show'}</span>
        </button>
      </div>

      {open ? (
        <div className="calendar-frame">
          <iframe title="Shared family calendar" src={embedUrl} loading="lazy" />
        </div>
      ) : (
        <p className="empty-state compact">Tap Show to load the shared Google Calendar.</p>
      )}

      <a className="sheet-link" href={SHARED_CALENDAR_SUBSCRIBE_URL} target="_blank" rel="noreferrer">
        <CalendarPlus aria-hidden="true" />
        <span>Add to your Google Calendar</span>
      </a>
    </section>
  );
}
