import { BarChart3, ClipboardCheck, Home, List, Settings } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyTheme, getInitialTheme, type Theme } from './domain/theme';
import { hasStoredGoogleGrant, keepGoogleSessionAlive } from './storage/googleSheetsAuth';
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
import { snapshotSignature } from './domain/snapshot';
import { type ActiveTimers, type TimerType, loadActiveTimers, saveActiveTimers } from './domain/timers';
import type { BabyProfile, CareEvent, CareEventType, CreateCareEventInput, TrackerExport, TrackerSnapshot } from './domain/types';
import { createHybridBabyTrackerStore } from './storage/hybridStore';
import type { StoreStatus } from './storage/store';

type View = 'dashboard' | 'log' | 'reports' | 'care' | 'learn' | 'settings';

// 'restoring' resumes a device that already granted Google, so a returning user
// sees a branded reconnect rather than a flash of the login screen.
type BootPhase = 'restoring' | 'signin' | 'ready';

const VIEWS: View[] = ['dashboard', 'log', 'reports', 'care', 'learn', 'settings'];

/** How often a foreground tab re-reads the shared sheet for other people's edits. */
const POLL_INTERVAL_MS = 45_000;
/** Silent reconnects to try at launch before falling back to the sign-in screen. */
const RESTORE_ATTEMPTS = 2;
const RESTORE_RETRY_MS = 1_500;
/** How often the reconnect screen retries on its own, so it can heal untouched. */
const RECONNECT_RETRY_MS = 20_000;

/**
 * Run `task` on a repeating delay, chained rather than on an interval so a slow
 * read can never stack up behind itself. Failures are swallowed to keep the
 * chain alive — a background sync that misses a beat just tries again.
 */
function startPolling(task: () => Promise<void>, intervalMs: number) {
  let stopped = false;
  let timer: number | undefined;

  const run = async () => {
    try {
      await task();
    } catch {
      // Transient — the next tick retries rather than alarming anyone.
    }

    if (!stopped) {
      timer = window.setTimeout(run, intervalMs);
    }
  };

  timer = window.setTimeout(run, intervalMs);

  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}

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
  const [editEvent, setEditEvent] = useState<CareEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [bootPhase, setBootPhase] = useState<BootPhase>(() => (hasStoredGoogleGrant() ? 'restoring' : 'signin'));
  const [sessionExpired, setSessionExpired] = useState(false);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [storeStatus, setStoreStatus] = useState<StoreStatus | null>(() => trackerStore.getStatus?.() ?? null);
  const [activeTimers, setActiveTimers] = useState<ActiveTimers>(loadActiveTimers);

  const hasActiveTimer = Object.keys(activeTimers).length > 0;
  useEffect(() => {
    if (!hasActiveTimer) return;
    const id = setInterval(() => setActiveTimers((t) => ({ ...t })), 1000);
    return () => clearInterval(id);
  }, [hasActiveTimer]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // What the UI is currently showing, so a poll that finds nothing new can bail
  // out without re-rendering the tree under someone's fingers.
  const signatureRef = useRef('');
  // Bumped before every write, so a read that started earlier can't reinstate
  // the rows it saw before that write landed.
  const mutationRef = useRef(0);

  const applySnapshot = useCallback((snapshot: TrackerSnapshot) => {
    const signature = snapshotSignature(snapshot.profile, snapshot.events);

    if (signature === signatureRef.current) {
      return;
    }

    signatureRef.current = signature;
    setProfile(snapshot.profile);
    setEvents(snapshot.events);
  }, []);

  const refresh = useCallback(async () => {
    applySnapshot(await trackerStore.snapshot());
    setStoreStatus(trackerStore.getStatus?.() ?? null);
  }, [applySnapshot]);

  /** A background read: same data, but it never touches connection status. */
  const syncFromSheet = useCallback(async () => {
    if (document.visibilityState !== 'visible' || navigator.onLine === false) {
      return;
    }

    const seen = mutationRef.current;
    const snapshot = await trackerStore.snapshot();

    if (mutationRef.current === seen) {
      applySnapshot(snapshot);
    }
  }, [applySnapshot]);

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

  const restoreSession = useCallback(async () => {
    await trackerStore.connect?.(false);
    await refresh();
  }, [refresh]);

  // Stay signed in: if Google was already granted on this device, silently
  // reconnect on launch instead of showing the login screen.
  useEffect(() => {
    if (bootPhase !== 'restoring') {
      return;
    }

    let cancelled = false;

    (async () => {
      // A cold network or a token Google retired early makes the first silent
      // attempt fail on a session that is otherwise perfectly good, so give it
      // a second go before showing anyone a sign-in screen.
      for (let attempt = 1; attempt <= RESTORE_ATTEMPTS; attempt += 1) {
        try {
          await restoreSession();

          if (!cancelled) {
            setBootPhase('ready');
          }

          return;
        } catch {
          if (cancelled) {
            return;
          }

          if (attempt < RESTORE_ATTEMPTS) {
            await new Promise((resolve) => window.setTimeout(resolve, RESTORE_RETRY_MS));
          }
        }
      }

      // Out of attempts — fall back to the sign-in screen so it's one tap to get
      // back in. Never pull back someone who already got in offline meanwhile.
      if (!cancelled) {
        setStoreStatus(trackerStore.getStatus?.() ?? null);
        setSessionExpired(true);
        setBootPhase((phase) => (phase === 'restoring' ? 'signin' : phase));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bootPhase, restoreSession]);

  // Keep trying quietly behind the reconnect screen: a grant that failed to
  // restore is usually a transient hiccup, and healing on its own is better
  // than making a parent hunt for the Reconnect button at 3am.
  useEffect(() => {
    if (bootPhase !== 'signin' || !sessionExpired || !hasStoredGoogleGrant()) {
      return;
    }

    let stopped = false;

    const stop = startPolling(async () => {
      await restoreSession();

      if (!stopped) {
        setSessionExpired(false);
        setBootPhase('ready');
      }
    }, RECONNECT_RETRY_MS);

    return () => {
      stopped = true;
      stop();
    };
  }, [bootPhase, restoreSession, sessionExpired]);

  // Renew the Google token ahead of expiry (and whenever the app is refocused)
  // so a long-lived session never drops the user back to sign-in. Attached from
  // launch, not just when ready, so it covers the reconnect screen too.
  useEffect(() => keepGoogleSessionAlive(), []);

  // Poll the shared sheet so an entry logged by someone else — or on another
  // device — lands here without a manual reload, and pull immediately whenever
  // the app comes back to the foreground or regains a connection.
  useEffect(() => {
    if (bootPhase !== 'ready' || !storeStatus?.connected) {
      return;
    }

    const stop = startPolling(syncFromSheet, POLL_INTERVAL_MS);
    const syncNow = () => {
      void syncFromSheet().catch(() => {
        // Transient — the polling chain picks it up on the next tick.
      });
    };

    document.addEventListener('visibilitychange', syncNow);
    window.addEventListener('focus', syncNow);
    window.addEventListener('online', syncNow);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', syncNow);
      window.removeEventListener('focus', syncNow);
      window.removeEventListener('online', syncNow);
    };
  }, [bootPhase, storeStatus?.connected, syncFromSheet]);

  async function loadOffline() {
    setLoading(true);
    setError('');
    try {
      await refresh();
      setBootPhase('ready');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load tracker data.');
    } finally {
      setLoading(false);
    }
  }

  function handleTimerStart(type: TimerType) {
    const next = { ...loadActiveTimers(), [type]: { startedAt: new Date().toISOString() } };
    saveActiveTimers(next);
    setActiveTimers(next);
    setDialogType(null);
  }

  function handleTimerStop(type: TimerType) {
    const next = { ...loadActiveTimers() };
    delete next[type];
    saveActiveTimers(next);
    setActiveTimers(next);
  }

  function closeDialog() {
    setDialogType(null);
    setEditEvent(null);
  }

  async function handleSaveEvent(input: CreateCareEventInput) {
    mutationRef.current += 1;

    if (editEvent) {
      await trackerStore.updateEvent({ ...editEvent, ...input } as CareEvent);
    } else {
      await trackerStore.addEvent(input);
    }

    if (input.type === 'birth') {
      await trackerStore.saveProfile({ birthDate: input.startedAt });
    }
    // Clear any active timer for this event type when saving
    if (!editEvent && input.type in activeTimers) {
      handleTimerStop(input.type as TimerType);
    }
    closeDialog();
    await refresh();
  }

  async function handleDeleteEvent(id: string) {
    mutationRef.current += 1;
    await trackerStore.deleteEvent(id);
    await refresh();
  }

  async function handleToggleRef(type: 'milestone' | 'vaccine', refId: string, on: boolean) {
    mutationRef.current += 1;

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
    mutationRef.current += 1;
    const saved = await trackerStore.saveProfile(profilePatch);
    setProfile(saved);
    // The signature is stale now, so the next poll reconciles rather than
    // deciding nothing changed.
    signatureRef.current = '';
  }

  async function handleExport() {
    return trackerStore.exportData();
  }

  async function handleImport(data: TrackerExport) {
    mutationRef.current += 1;
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
      setSessionExpired(false);
      setBootPhase('ready');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to connect Google Sheets.');
      setStoreStatus(trackerStore.getStatus?.() ?? null);
    } finally {
      setLoading(false);
    }
  }

  if (bootPhase !== 'ready') {
    return (
      <LoginSplash
        error={error}
        loading={loading}
        restoring={bootPhase === 'restoring'}
        sessionExpired={sessionExpired}
        storeStatus={storeStatus}
        onContinue={handleSplashContinue}
        onOffline={loadOffline}
      />
    );
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
      </header>

      {error && <p className="error-banner" role="alert">{error}</p>}

      {activeView === 'dashboard' && <Dashboard activeTimers={activeTimers} events={events} profile={profile} todayKey={todayKey} onAdd={setDialogType} />}

      {activeView === 'log' && (
        <Log
          events={events}
          firstYearEvents={firstYearEvents}
          profile={profile}
          onAdd={setDialogType}
          onDelete={handleDeleteEvent}
          onEdit={setEditEvent}
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
          theme={theme}
          onConnectSheet={handleConnectSheet}
          onExport={handleExport}
          onImport={handleImport}
          onOpenLearn={() => navigate('learn')}
          onSaveProfile={handleSaveProfile}
          onThemeChange={setTheme}
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

      <QuickAddDialog
        activeTimers={activeTimers}
        editEvent={editEvent}
        eventType={dialogType}
        onClose={closeDialog}
        onSave={handleSaveEvent}
        onTimerStart={handleTimerStart}
        onTimerStop={handleTimerStop}
      />
    </div>
  );
}

export default App;
