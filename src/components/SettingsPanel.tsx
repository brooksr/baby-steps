import { BookOpen, Download, Moon, Sun, Upload } from 'lucide-react';
import { ChangeEvent, FormEvent, useMemo, useState } from 'react';
import { getTimezoneOptions } from '../domain/dates';
import type { Theme } from '../domain/theme';
import { babyGenderLabels, type BabyGender, type BabyProfile, type CareEvent, type TrackerExport } from '../domain/types';
import type { StoreStatus } from '../storage/store';

interface SettingsPanelProps {
  events: CareEvent[];
  profile: BabyProfile;
  storeStatus: StoreStatus | null;
  theme: Theme;
  onConnectSheet: () => Promise<void>;
  onExport: () => Promise<TrackerExport>;
  onImport: (data: TrackerExport) => Promise<void>;
  onOpenLearn: () => void;
  onSaveProfile: (profile: Partial<BabyProfile>) => Promise<void>;
  onThemeChange: (theme: Theme) => void;
}

const GENDERS = Object.keys(babyGenderLabels) as BabyGender[];

const THEMES: Array<{ icon: typeof Sun; id: Theme; label: string }> = [
  { icon: Sun, id: 'light', label: 'Light' },
  { icon: Moon, id: 'dark', label: 'Dark' }
];

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

export function SettingsPanel({ events, profile, storeStatus, theme, onConnectSheet, onExport, onImport, onOpenLearn, onSaveProfile, onThemeChange }: SettingsPanelProps) {
  const [name, setName] = useState(profile.name);
  const [dueDate, setDueDate] = useState(profile.dueDate);
  const [birthDate, setBirthDate] = useState(profile.birthDate?.slice(0, 10) ?? '');
  const [gender, setGender] = useState<BabyGender | ''>(profile.gender ?? '');
  const [timezone, setTimezone] = useState(profile.timezone);
  const [status, setStatus] = useState('');
  const [connecting, setConnecting] = useState(false);

  // Enumerating every zone is not free, and the saved one has to stay in the
  // list even when this browser wouldn't have offered it.
  const timezones = useMemo(() => getTimezoneOptions(profile.timezone), [profile.timezone]);

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSaveProfile({ birthDate: birthDate || undefined, dueDate, gender: gender || undefined, name, timezone });
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
          <label>
            Gender
            <select value={gender} onChange={(event) => setGender(event.target.value as BabyGender | '')}>
              <option value="">Not set</option>
              {GENDERS.map((option) => (
                <option key={option} value={option}>{babyGenderLabels[option]}</option>
              ))}
            </select>
          </label>
          <label className="form-grid-wide">
            Timezone
            <select value={timezone} onChange={(event) => setTimezone(event.target.value)} required>
              {timezones.map((zone) => (
                <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>
              ))}
            </select>
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
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Learn</h2>
            <span>What BabySteps tracks, what it will not do, and the reference tables behind it.</span>
          </div>
        </div>
        <button className="secondary-button learn-link" type="button" onClick={onOpenLearn}>
          <BookOpen aria-hidden="true" />
          <span>Open the Learn page</span>
        </button>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>Appearance</h2>
          <div className="segmented-control" aria-label="Theme">
            {THEMES.map((option) => {
              const Icon = option.icon;

              return (
                <button
                  type="button"
                  key={option.id}
                  aria-pressed={theme === option.id}
                  className={theme === option.id ? 'active' : ''}
                  onClick={() => onThemeChange(option.id)}
                >
                  <Icon aria-hidden="true" />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
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
