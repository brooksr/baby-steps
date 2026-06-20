import { BarChart3, Home, List, Settings } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { LoginSplash } from './components/LoginSplash';
import { QuickAddDialog } from './components/QuickAddDialog';
import { Reports } from './components/Reports';
import { SettingsPanel } from './components/SettingsPanel';
import { Timeline } from './components/Timeline';
import { getLocalDateKey } from './domain/dates';
import { getFirstYearEvents } from './domain/firstYear';
import type { BabyProfile, CareEvent, CareEventType, CreateCareEventInput, TrackerExport } from './domain/types';
import { createHybridBabyTrackerStore } from './storage/hybridStore';
import type { StoreStatus } from './storage/store';

type View = 'dashboard' | 'log' | 'reports' | 'settings';

const trackerStore = createHybridBabyTrackerStore();

const tabs = [
  { icon: Home, id: 'dashboard', label: 'Home' },
  { icon: List, id: 'log', label: 'Log' },
  { icon: BarChart3, id: 'reports', label: 'Reports' },
  { icon: Settings, id: 'settings', label: 'Settings' }
] satisfies Array<{ icon: typeof Home; id: View; label: string }>;

function App() {
  const [profile, setProfile] = useState<BabyProfile | null>(null);
  const [events, setEvents] = useState<CareEvent[]>([]);
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [logScope, setLogScope] = useState<'all' | 'first-year'>('all');
  const [dialogType, setDialogType] = useState<CareEventType | null>(null);
  const [loading, setLoading] = useState(false);
  const [splashComplete, setSplashComplete] = useState(false);
  const [error, setError] = useState('');
  const [storeStatus, setStoreStatus] = useState<StoreStatus | null>(() => trackerStore.getStatus?.() ?? null);

  const refresh = useCallback(async () => {
    const [nextProfile, nextEvents] = await Promise.all([trackerStore.initialize(), trackerStore.listEvents()]);
    setProfile(nextProfile);
    setEvents(nextEvents);
    setStoreStatus(trackerStore.getStatus?.() ?? null);
  }, []);

  const todayKey = useMemo(() => getLocalDateKey(new Date()), []);

  async function loadOffline() {
    setLoading(true);
    setError('');
    try {
      await refresh();
      setSplashComplete(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load tracker data.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddEvent(input: CreateCareEventInput) {
    await trackerStore.addEvent(input);
    if (input.type === 'birth') {
      await trackerStore.saveProfile({ birthDate: input.startedAt });
    }
    setDialogType(null);
    await refresh();
  }

  async function handleDeleteEvent(id: string) {
    await trackerStore.deleteEvent(id);
    await refresh();
  }

  async function handleSaveProfile(profilePatch: Partial<BabyProfile>) {
    const saved = await trackerStore.saveProfile(profilePatch);
    setProfile(saved);
  }

  async function handleExport() {
    return trackerStore.exportData();
  }

  async function handleImport(data: TrackerExport) {
    await trackerStore.importData(data, { mode: 'merge' });
    await refresh();
  }

  async function handleConnectSheet() {
    setError('');
    try {
      await trackerStore.connect?.();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to connect Google Sheets.');
      setStoreStatus(trackerStore.getStatus?.() ?? null);
    }
  }

  async function handleSplashContinue() {
    setLoading(true);
    setError('');
    try {
      await trackerStore.connect?.();
      await refresh();
      setSplashComplete(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to connect Google Sheets.');
      setStoreStatus(trackerStore.getStatus?.() ?? null);
    } finally {
      setLoading(false);
    }
  }

  if (!splashComplete) {
    return <LoginSplash error={error} loading={loading} storeStatus={storeStatus} onContinue={handleSplashContinue} onOffline={loadOffline} />;
  }

  if (loading || !profile) {
    return (
      <div className="app-shell loading-shell">
        <div className="loader" />
        <p>Loading BabySteps</p>
      </div>
    );
  }

  const firstYearEvents = getFirstYearEvents(profile, events);
  const logEvents = logScope === 'first-year' ? firstYearEvents : events;

  return (
    <div className="app-shell">
      {error && <p className="error-banner" role="alert">{error}</p>}

      {activeView === 'dashboard' && <Dashboard events={events} profile={profile} todayKey={todayKey} onAdd={setDialogType} />}

      {activeView === 'log' && (
        <main className="view-stack">
          <section className="section-block">
            <div className="section-heading">
              <div>
                <h1>Log</h1>
                <span>{events.length} total · {firstYearEvents.length} first-year</span>
              </div>
              <div className="button-row">
                <div className="segmented-control" aria-label="Log scope">
                  <button type="button" className={logScope === 'all' ? 'active' : ''} onClick={() => setLogScope('all')}>
                    All
                  </button>
                  <button type="button" className={logScope === 'first-year' ? 'active' : ''} onClick={() => setLogScope('first-year')}>
                    First year
                  </button>
                </div>
                {!profile.birthDate && (
                  <button className="secondary-button compact" type="button" onClick={() => setDialogType('birth')}>
                    Log birth
                  </button>
                )}
                <button className="primary-button compact" type="button" onClick={() => setDialogType('note')}>
                  Add note
                </button>
              </div>
            </div>
            <Timeline events={logEvents} onDelete={handleDeleteEvent} />
          </section>
        </main>
      )}

      {activeView === 'reports' && <Reports events={events} profile={profile} />}

      {activeView === 'settings' && (
        <SettingsPanel
          events={events}
          profile={profile}
          storeStatus={storeStatus}
          onConnectSheet={handleConnectSheet}
          onExport={handleExport}
          onImport={handleImport}
          onSaveProfile={handleSaveProfile}
        />
      )}

      <nav className="bottom-nav" aria-label="Primary">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = activeView === tab.id;

          return (
            <button type="button" key={tab.id} aria-pressed={selected} className={selected ? 'active' : ''} onClick={() => setActiveView(tab.id)}>
              <Icon aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <QuickAddDialog eventType={dialogType} onClose={() => setDialogType(null)} onSave={handleAddEvent} />
    </div>
  );
}

export default App;
