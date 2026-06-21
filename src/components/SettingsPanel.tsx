import { Download, FlaskConical, Upload } from 'lucide-react';
import { ChangeEvent, FormEvent, useState } from 'react';
import { buildFirstMonthSeed } from '../domain/seed/firstMonthSeed';
import { buildFullYearSeed } from '../domain/seed/fullYearSeed';
import type { BabyProfile, CareEvent, TrackerExport } from '../domain/types';
import type { StoreStatus } from '../storage/store';

interface SettingsPanelProps {
  events: CareEvent[];
  profile: BabyProfile;
  storeStatus: StoreStatus | null;
  onConnectSheet: () => Promise<void>;
  onExport: () => Promise<TrackerExport>;
  onImport: (data: TrackerExport) => Promise<void>;
  onSaveProfile: (profile: Partial<BabyProfile>) => Promise<void>;
}

function escapeCsv(value: unknown) {
  const text = value === undefined || value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function eventDetails(event: CareEvent) {
  const details = { ...event } as Record<string, unknown>;
  for (const key of ['id', 'babyId', 'createdAt', 'updatedAt', 'syncState', 'startedAt', 'endedAt', 'notes', 'type']) {
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

function eventsToCsv(events: CareEvent[]) {
  const headers = ['id', 'type', 'startedAt', 'endedAt', 'notes', 'details'];
  const rows = events.map((event) =>
    [
      escapeCsv(event.id),
      escapeCsv(event.type),
      escapeCsv(event.startedAt),
      escapeCsv(event.endedAt),
      escapeCsv(event.notes),
      escapeCsv(eventDetails(event))
    ].join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}

export function SettingsPanel({ events, profile, storeStatus, onConnectSheet, onExport, onImport, onSaveProfile }: SettingsPanelProps) {
  const [name, setName] = useState(profile.name);
  const [dueDate, setDueDate] = useState(profile.dueDate);
  const [birthDate, setBirthDate] = useState(profile.birthDate?.slice(0, 10) ?? '');
  const [timezone, setTimezone] = useState(profile.timezone);
  const [status, setStatus] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [seeding, setSeeding] = useState<'' | 'month' | 'year'>('');

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSaveProfile({ birthDate: birthDate || undefined, dueDate, name, timezone });
    setStatus('Profile saved.');
  }

  async function handleJsonExport() {
    const data = await onExport();
    downloadFile(`babysteps-theo-${data.exportedAt.slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
    setStatus('JSON exported.');
  }

  function handleCsvExport() {
    downloadFile(`babysteps-theo-events.csv`, eventsToCsv(events), 'text/csv');
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

  async function handleSeedMonth() {
    if (!window.confirm('Add a full month of sample events (including planted warnings and a fever) to the current data? This also sets a birth date.')) {
      return;
    }

    setSeeding('month');
    try {
      const seed = buildFirstMonthSeed();
      await onImport(seed);
      setStatus(`Loaded ${seed.events.length} sample events.`);
    } finally {
      setSeeding('');
    }
  }

  async function handleSeedYear() {
    if (!window.confirm('Load a full year of sample data? This replaces the current profile birth date and adds 365 days of events.')) {
      return;
    }

    setSeeding('year');
    try {
      const seed = buildFullYearSeed();
      await onImport(seed);
      setStatus(`Loaded ${seed.events.length} sample events (full year).`);
    } finally {
      setSeeding('');
    }
  }

  async function handleConnectSheet() {
    setConnecting(true);
    try {
      await onConnectSheet();
      setStatus('Google Sheet connected.');
    } finally {
      setConnecting(false);
    }
  }

  return (
    <main className="view-stack">
      <section className="section-block">
        <div className="section-heading">
          <h1>Settings</h1>
          <span>{events.length} entries</span>
        </div>

        <form className="form-grid" onSubmit={handleSaveProfile}>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            Due date
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required />
          </label>
          <label>
            Birth date
            <input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
          </label>
          <label className="form-grid-wide">
            Timezone
            <input value={timezone} onChange={(event) => setTimezone(event.target.value)} required />
          </label>
          <button className="primary-button form-grid-wide" type="submit">
            Save profile
          </button>
        </form>
      </section>

      <section className="settings-actions" aria-label="Data tools">
        <button className="tool-button" type="button" onClick={handleJsonExport}>
          <Download aria-hidden="true" />
          <span>JSON</span>
        </button>
        <button className="tool-button" type="button" onClick={handleCsvExport}>
          <Download aria-hidden="true" />
          <span>CSV</span>
        </button>
        <label className="tool-button file-tool">
          <Upload aria-hidden="true" />
          <span>Import</span>
          <input type="file" accept="application/json" onChange={handleImport} />
        </label>
        <button className="tool-button" type="button" onClick={handleSeedMonth} disabled={seeding !== ''}>
          <FlaskConical aria-hidden="true" />
          <span>{seeding === 'month' ? 'Loading' : 'Sample month'}</span>
        </button>
        <button className="tool-button" type="button" onClick={handleSeedYear} disabled={seeding !== ''}>
          <FlaskConical aria-hidden="true" />
          <span>{seeding === 'year' ? 'Loading' : 'Sample year'}</span>
        </button>
      </section>

      <section className="section-block sync-note">
        <div className="section-heading">
          <h2>Storage</h2>
          <span>{storeStatus?.backend === 'google-sheets' ? 'Google Sheets' : 'Local'}</span>
        </div>
        <p>{storeStatus?.message}</p>
        {storeStatus?.sheetUrl && (
          <a className="sheet-link" href={storeStatus.sheetUrl} target="_blank" rel="noreferrer">
            Open sheet
          </a>
        )}
        {storeStatus?.configured && !storeStatus.connected && (
          <button className="primary-button sheet-connect" type="button" onClick={handleConnectSheet} disabled={connecting}>
            {connecting ? 'Connecting' : 'Connect Google Sheet'}
          </button>
        )}
      </section>

      {status && <p className="toast" role="status">{status}</p>}
    </main>
  );
}
