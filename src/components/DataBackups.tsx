import { Download, Upload } from 'lucide-react';
import { ChangeEvent, type ReactNode, useState } from 'react';
import { getFirstName } from '../domain/family';
import type { BabyProfile, CareEvent, TrackerExport } from '../domain/types';

interface DataBackupsProps {
  /** Store-specific lines under the tools: the sheet's family id, invite link and connect button. */
  children?: ReactNode;
  events: CareEvent[];
  /** The person on screen — the CSV is their log. */
  profile: BabyProfile;
  profiles: BabyProfile[];
  /** Where the family's data lives, beside the heading. */
  source: string;
  /** How syncing stands, in a sentence. */
  summary?: string;
  onExport: () => Promise<TrackerExport>;
  onImport: (data: TrackerExport) => Promise<void>;
}

/** A filename that names the child, now that a download is one child's data. */
function fileSlug(profile: BabyProfile) {
  return (
    profile.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'tracker'
  );
}

function escapeCsv(value: unknown) {
  const text = value === undefined || value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function eventDetails(event: CareEvent) {
  const details = { ...event } as Record<string, unknown>;
  // `caregiverId` gets a column of its own, resolved to a name.
  for (const key of ['id', 'babyId', 'caregiverId', 'createdAt', 'updatedAt', 'syncState', 'startedAt', 'endedAt', 'notes', 'type']) {
    delete details[key];
  }

  return JSON.stringify(details);
}

function downloadFile(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function eventsToCsv(events: CareEvent[], profiles: BabyProfile[]) {
  const headers = ['id', 'type', 'startedAt', 'endedAt', 'loggedBy', 'notes', 'details'];
  const rows = events.map((event) =>
    [
      escapeCsv(event.id),
      escapeCsv(event.type),
      escapeCsv(event.startedAt),
      escapeCsv(event.endedAt),
      escapeCsv(profiles.find((person) => person.id === event.caregiverId)?.name),
      escapeCsv(event.notes),
      escapeCsv(eventDetails(event))
    ].join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}

/** Family backup, log export and import — on Settings for Sheets, on Account for the internal app. */
export function DataBackups({ children, events, profile, profiles, source, summary, onExport, onImport }: DataBackupsProps) {
  const [status, setStatus] = useState('');

  async function handleJsonExport() {
    const data = await onExport();
    downloadFile(`babysteps-${data.exportedAt.slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
    setStatus('JSON exported.');
  }

  // The CSV is what is on screen: this child's entries.
  function handleCsvExport() {
    downloadFile(`babysteps-${fileSlug(profile)}-events.csv`, eventsToCsv(events, profiles), 'text/csv');
    setStatus('CSV exported.');
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const data = JSON.parse(await file.text()) as TrackerExport;
    await onImport(data);
    event.target.value = '';
    setStatus('Import complete.');
  }

  return (
    <section className="section-block sync-note">
      <div className="section-heading">
        <h2>Data &amp; backups</h2>
        <span>{source}</span>
      </div>
      {summary && <p>{summary}</p>}
      <p className="field-note">Back up the whole family as JSON, or export {getFirstName(profile)}’s log as CSV. Import accepts a BabySteps JSON backup.</p>
      <div className="settings-actions" aria-label="Data tools">
        <button className="tool-button" type="button" onClick={handleJsonExport}>
          <Download aria-hidden="true" />
          <span>Family backup · JSON</span>
        </button>
        <button className="tool-button" type="button" onClick={handleCsvExport}>
          <Download aria-hidden="true" />
          <span>Current log · CSV</span>
        </button>
        <label className="tool-button file-tool">
          <Upload aria-hidden="true" />
          <span>Import backup</span>
          <input type="file" accept="application/json" onChange={handleImport} />
        </label>
      </div>
      {children}
      {status && <p className="toast" role="status">{status}</p>}
    </section>
  );
}
