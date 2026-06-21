import { BarChart3, BookOpen, ClipboardCheck, Home, Images, List, Moon, Settings, Sun } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PHOTO_ALBUM_URL } from './domain/media';
import { applyTheme, getInitialTheme, type Theme } from './domain/theme';
import { hasStoredGoogleGrant } from './storage/googleSheetsAuth';
import { Care } from './components/Care';
import { Dashboard } from './components/Dashboard';
import { Learn } from './components/Learn';
import { Log } from './components/Log';
import { LoginSplash } from './components/LoginSplash';
import { QuickAddDialog } from './components/QuickAddDialog';
import { Reports } from './components/Reports';
import { SettingsPanel } from './components/SettingsPanel';
import { getLocalDateKey } from './domain/dates';
import { getFirstYearEvents } from './domain/firstYear';
import type { BabyProfile, CareEvent, CareEventType, CreateCareEventInput, TrackerExport } from './domain/types';
import { createHybridBabyTrackerStore } from './storage/hybridStore';
import type { StoreStatus } from './storage/store';

type View = 'dashboard' | 'log' | 'reports' | 'care' | 'learn' | 'settings';

const VIEWS: View[] = ['dashboard', 'log', 'reports', 'care', 'learn', 'settings'];

function viewFromHash(): View {
  const hash = window.location.hash.slice(1) as View;
  return VIEWS.includes(hash) ? hash : 'dashboard';
}

const trackerStore = createHybridBabyTrackerStore();

const tabs = [
  { icon: Home, id: 'dashboard', label: 'Home' },
  { icon: List, id: 'log', label: 'Log' },
  { icon: BarChart3, id: 'reports', label: 'Reports' },
  { icon: ClipboardCheck, id: 'care', label: 'Care' },
  { icon: Settings, id: 'settings', label: 'Settings' }
] satisfies Array<{ icon: typeof Home; id: View; label: string }>;

function App() {
  const [profile, setProfile] = useState<BabyProfile | null>(null);
  const [events, setEvents] = useState<CareEvent[]>([]);
  const [activeView, setActiveView] = useState<View>(viewFromHash);
  const [dialogType, setDialogType] = useState<CareEventType | null>(null);
  const [loading, setLoading] = useState(false);
  const [splashComplete, setSplashComplete] = useState(false);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [storeStatus, setStoreStatus] = useState<StoreStatus | null>(() => trackerStore.getStatus?.() ?? null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const refresh = useCallback(async () => {
    const [nextProfile, nextEvents] = await Promise.all([trackerStore.initialize(), trackerStore.listEvents()]);
    setProfile(nextProfile);
    setEvents(nextEvents);
    setStoreStatus(trackerStore.getStatus?.() ?? null);
  }, []);

  const todayKey = useMemo(() => getLocalDateKey(new Date()), []);

  const navigate = useCallback((view: View) => {
    setActiveView(view);
    history.pushState(null, '', `#${view}`);
  }, []);

  useEffect(() => {
    const onPopState = () => setActiveView(viewFromHash());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Stay signed in: if Google was already granted on this device, silently
  // reconnect on launch instead of showing the login screen.
  useEffect(() => {
    if (splashComplete || !hasStoredGoogleGrant()) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        await trackerStore.connect?.(false);
        await refresh();
        if (!cancelled) {
          setSplashComplete(true);
        }
      } catch {
        // Silent reconnect failed (e.g. the device's Google session expired) —
        // fall back to the splash so the user can reconnect with one tap.
        if (!cancelled) {
          setStoreStatus(trackerStore.getStatus?.() ?? null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refresh, splashComplete]);

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

  async function handleToggleRef(type: 'milestone' | 'vaccine', refId: string, on: boolean) {
    if (on) {
      await trackerStore.addEvent({ refId, startedAt: new Date().toISOString(), type } as CreateCareEventInput);
    } else {
      const existing = events.find((event) => event.type === type && 'refId' in event && event.refId === refId);
      if (existing) {
        await trackerStore.deleteEvent(existing.id);
      }
    }
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-wordmark">BabySteps</span>
        <div className="header-actions">
          <button
            type="button"
            className={`header-link ${activeView === 'learn' ? 'active' : ''}`}
            onClick={() => navigate('learn')}
            aria-pressed={activeView === 'learn'}
          >
            <BookOpen aria-hidden="true" />
            <span>Learn</span>
          </button>
          <button
            type="button"
            className="header-link icon-only"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </button>
          <a className="header-link" href={PHOTO_ALBUM_URL} target="_blank" rel="noreferrer">
            <Images aria-hidden="true" />
            <span>Album</span>
          </a>
        </div>
      </header>

      {error && <p className="error-banner" role="alert">{error}</p>}

      {activeView === 'dashboard' && <Dashboard events={events} profile={profile} todayKey={todayKey} onAdd={setDialogType} />}

      {activeView === 'log' && (
        <Log
          events={events}
          firstYearEvents={firstYearEvents}
          profile={profile}
          onAdd={setDialogType}
          onDelete={handleDeleteEvent}
        />
      )}

      {activeView === 'reports' && <Reports events={events} profile={profile} />}

      {activeView === 'care' && <Care events={events} profile={profile} onSaveProfile={handleSaveProfile} onToggle={handleToggleRef} />}

      {activeView === 'learn' && <Learn />}

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
            <button type="button" key={tab.id} aria-pressed={selected} className={selected ? 'active' : ''} onClick={() => navigate(tab.id)}>
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
