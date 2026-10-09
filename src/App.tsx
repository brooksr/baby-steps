import { BarChart3, ClipboardCheck, Home, List, ListTodo, Settings, ShoppingCart } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyTheme, getInitialTheme, type Theme } from './domain/theme';
import { fetchGoogleEmail, getStoredGoogleEmail, hasStoredGoogleGrant, keepGoogleSessionAlive, signOutGoogle } from './storage/googleSheetsAuth';
import { Care } from './components/Care';
import { Dashboard } from './components/Dashboard';
import { Learn } from './components/Learn';
import { Log } from './components/Log';
import { FamilySetup } from './components/FamilySetup';
import { LoginSplash } from './components/LoginSplash';
import { QuickAddDialog } from './components/QuickAddDialog';
import { Reports } from './components/Reports';
import { SettingsPanel } from './components/SettingsPanel';
import { ChildSwitcher } from './components/ChildSwitcher';
import { ParentDashboard } from './components/ParentDashboard';
import { ParentReports } from './components/ParentReports';
import { ShoppingList } from './components/ShoppingList';
import { Todos } from './components/Todos';
import { CAREGIVER_EVENT_TYPES, getAccess } from './domain/access';
import { getActiveProfiles, isCaregiverAccount, isChild, isParent, getStoredActiveProfileId, storeActiveProfileId, storeEmergencyChild, type NewProfileInput } from './domain/family';
import { DEFAULT_SLEEP_WINDOW, planAttribution, planParentSleeps, type Shift, type ShiftPlan, type ShiftResult } from './domain/nightShift';
import { getLocalDateKey } from './domain/dates';
import { getFirstYearEvents } from './domain/firstYear';
import { snapshotSignature } from './domain/snapshot';
import { getFoodNames } from './domain/shopping';
import { type ActiveTimers, type TimerType, loadActiveTimers, saveActiveTimers } from './domain/timers';
import type { BabyProfile, CareEvent, CareEventType, CreateCareEventInput, ShoppingItem, TaskItem, TrackerExport, TrackerSnapshot } from './domain/types';
import { takeJoinParam } from './storage/familyDirectory';
import { createHybridBabyTrackerStore, NoFamilyError, type NewFamilyInput } from './storage/hybridStore';
import type { StoreStatus } from './storage/store';

type View = 'dashboard' | 'log' | 'reports' | 'care' | 'shopping' | 'todos' | 'learn' | 'settings';

// 'restoring' resumes a device that already granted Google, so a returning user
// sees a branded reconnect rather than a flash of the login screen. 'nofamily'
// is a signed-in account no family has added: it sees nobody's log.
type BootPhase = 'restoring' | 'signin' | 'nofamily' | 'ready';

const VIEWS: View[] = ['dashboard', 'log', 'reports', 'care', 'shopping', 'todos', 'learn', 'settings'];

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

// An invite link names the family to try first; read it before anything connects.
takeJoinParam();
const trackerStore = createHybridBabyTrackerStore();

const tabs = [
  { icon: Home, id: 'dashboard', label: 'Home' },
  { icon: List, id: 'log', label: 'Log' },
  { icon: BarChart3, id: 'reports', label: 'Reports' },
  { icon: ClipboardCheck, id: 'care', label: 'Care' },
  { icon: ShoppingCart, id: 'shopping', label: 'Shopping' },
  { icon: ListTodo, id: 'todos', label: 'To-do' },
  { icon: Settings, id: 'settings', label: 'Settings' }
] satisfies Array<{ icon: typeof Home; id: View; label: string }>;

/** Household lists belong to the parent views; Care belongs to a child. */
const PARENT_TABS = new Set<View>(['dashboard', 'log', 'reports', 'shopping', 'todos', 'settings']);
const CHILD_TABS = new Set<View>(['dashboard', 'log', 'reports', 'care', 'settings']);
/** Someone minding the children: log on Home, and read Key info and Emergency. */
const CAREGIVER_TABS = new Set<View>(['dashboard', 'care']);

function App() {
  const [profile, setProfile] = useState<BabyProfile | null>(null);
  // Everyone on the tracker, for the switcher; `profile` is the one on screen.
  const [profiles, setProfiles] = useState<BabyProfile[]>([]);
  const [events, setEvents] = useState<CareEvent[]>([]);
  // The babies' entries, carried only while a parent is on screen.
  const [childEvents, setChildEvents] = useState<CareEvent[]>([]);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [activeView, setActiveView] = useState<View>(viewFromHash);
  const [logTypeFilter, setLogTypeFilter] = useState<CareEventType | null>(null);
  const [dialogType, setDialogType] = useState<CareEventType | null>(null);
  const [editEvent, setEditEvent] = useState<CareEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [bootPhase, setBootPhase] = useState<BootPhase>(() => (hasStoredGoogleGrant() ? 'restoring' : 'signin'));
  const [sessionExpired, setSessionExpired] = useState(false);
  const [noFamily, setNoFamily] = useState<NoFamilyError | null>(null);
  // Opened from the sign-in screen. It stays up through a restore finishing
  // behind it — the screen must not jump to Home under someone doing CPR.
  const [splashEmergency, setSplashEmergency] = useState(false);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [storeStatus, setStoreStatus] = useState<StoreStatus | null>(() => trackerStore.getStatus?.() ?? null);
  const [activeTimers, setActiveTimers] = useState<ActiveTimers>({});
  // Who signed in, which decides between the full app and the caregiver view.
  const [signedInEmail, setSignedInEmail] = useState<string | undefined>(getStoredGoogleEmail);
  // Offline, the profiles on screen are this device's own copy, which need not
  // carry anyone's email — only a connected family can say someone is not in it.
  const connected = Boolean(storeStatus?.connected);
  const access = useMemo(() => {
    const result = getAccess(profiles, signedInEmail);
    return result.role === 'none' && !connected ? { role: 'full' as const } : result;
  }, [connected, profiles, signedInEmail]);
  const caregiverMode = access.role === 'caregiver';

  const hasActiveTimer = Object.keys(activeTimers).length > 0;
  useEffect(() => {
    if (!hasActiveTimer) return;
    const id = setInterval(() => setActiveTimers((t) => ({ ...t })), 1000);
    return () => clearInterval(id);
  }, [hasActiveTimer]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Remember the child on screen (or, from a parent's view, the first child) so
  // the sign-in screen's Emergency guide can be tailored before any sign-in.
  useEffect(() => {
    const child = profile && isChild(profile) ? profile : getActiveProfiles(profiles).find(isChild);
    if (child) storeEmergencyChild(child);
  }, [profile, profiles]);

  // Timers belong to a child, not to the device — follow whoever is on screen.
  const activeChildId = profile?.id;
  useEffect(() => {
    setActiveTimers(activeChildId ? loadActiveTimers(activeChildId) : {});
  }, [activeChildId]);

  // What the UI is currently showing, so a poll that finds nothing new can bail
  // out without re-rendering the tree under someone's fingers.
  const signatureRef = useRef('');
  // Bumped before every write, so a read that started earlier can't reinstate
  // the rows it saw before that write landed.
  const mutationRef = useRef(0);
  // Which child every read is about. A ref as well as state, because a poll
  // scheduled before a switch must read the child that is on screen now.
  const activeChildRef = useRef<string | undefined>(getStoredActiveProfileId());

  const applySnapshot = useCallback((snapshot: TrackerSnapshot) => {
    const signature = snapshotSignature(
      snapshot.profile,
      [...snapshot.events, ...(snapshot.childEvents ?? [])],
      snapshot.profiles,
      snapshot.shopping,
      snapshot.tasks
    );

    if (signature === signatureRef.current) {
      return;
    }

    signatureRef.current = signature;
    // The stored person may have been removed on another device, so follow what
    // the snapshot actually resolved to rather than insisting on the old id.
    activeChildRef.current = snapshot.profile.id;
    setProfile(snapshot.profile);
    setProfiles(snapshot.profiles);
    setEvents(snapshot.events);
    setChildEvents(snapshot.childEvents ?? []);
    setShopping(snapshot.shopping);
    setTasks(snapshot.tasks);
  }, []);

  const refresh = useCallback(async () => {
    applySnapshot(await trackerStore.snapshot({ babyId: activeChildRef.current }));
    setStoreStatus(trackerStore.getStatus?.() ?? null);
  }, [applySnapshot]);

  /** A background read: same data, but it never touches connection status. */
  const syncFromSheet = useCallback(async () => {
    if (document.visibilityState !== 'visible' || navigator.onLine === false) {
      return;
    }

    const seen = mutationRef.current;
    const child = activeChildRef.current;
    const snapshot = await trackerStore.snapshot({ babyId: child });

    // A switch that happened while this read was in flight wins — its own read
    // is already on the way, and this one is about the previous child.
    if (mutationRef.current === seen && activeChildRef.current === child) {
      applySnapshot(snapshot);
    }
  }, [applySnapshot]);

  const selectChild = useCallback(
    async (babyId: string) => {
      if (babyId === activeChildRef.current) {
        return;
      }

      activeChildRef.current = babyId;
      storeActiveProfileId(babyId);
      // The events on screen belong to the other child, so drop the fingerprint
      // rather than letting an identical-looking read decide nothing moved.
      signatureRef.current = '';
      await refresh();
    },
    [refresh]
  );

  // A caregiver has no parent screens, so a device whose stored choice is a
  // parent (or whose sign-in just turned out to be a caregiver's) moves to the
  // first child.
  const firstChildId = getActiveProfiles(profiles).find(isChild)?.id;
  useEffect(() => {
    if (caregiverMode && profile && !isChild(profile) && firstChildId) {
      void selectChild(firstChildId);
    }
  }, [caregiverMode, firstChildId, profile, selectChild]);

  const todayKey = useMemo(() => getLocalDateKey(new Date()), []);

  const navigate = useCallback((view: View) => {
    setActiveView(view);
    history.pushState(null, '', `#${view}`);
  }, []);

  const openFilteredLog = useCallback((type: CareEventType) => {
    setLogTypeFilter(type);
    navigate('log');
  }, [navigate]);

  useEffect(() => {
    const onPopState = () => setActiveView(viewFromHash());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  /** Ask Google who is signed in. A failure keeps whatever this device last knew. */
  const refreshIdentity = useCallback(() => {
    void fetchGoogleEmail().then(setSignedInEmail);
  }, []);

  const restoreSession = useCallback(async () => {
    await trackerStore.connect?.(false);
    // Connecting asked Google who this is; use that before the first render.
    setSignedInEmail(getStoredGoogleEmail());
    await refresh();
    refreshIdentity();
  }, [refresh, refreshIdentity]);

  /** Not a failure to retry: this account belongs to no family yet. */
  const showNoFamily = useCallback((error: NoFamilyError) => {
    setNoFamily(error);
    setSignedInEmail(error.email);
    setSessionExpired(false);
    setBootPhase('nofamily');
  }, []);

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
        } catch (caught) {
          if (cancelled) {
            return;
          }

          if (caught instanceof NoFamilyError) {
            showNoFamily(caught);
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
  }, [bootPhase, restoreSession, showNoFamily]);

  // Keep trying quietly behind the reconnect screen: a grant that failed to
  // restore is usually a transient hiccup, and healing on its own is better
  // than making a parent hunt for the Reconnect button at 3am.
  useEffect(() => {
    if (bootPhase !== 'signin' || !sessionExpired || !hasStoredGoogleGrant()) {
      return;
    }

    let stopped = false;

    const stop = startPolling(async () => {
      try {
        await restoreSession();
      } catch (caught) {
        if (caught instanceof NoFamilyError && !stopped) {
          showNoFamily(caught);
        }

        throw caught;
      }

      if (!stopped) {
        setSessionExpired(false);
        setBootPhase('ready');
      }
    }, RECONNECT_RETRY_MS);

    return () => {
      stopped = true;
      stop();
    };
  }, [bootPhase, restoreSession, sessionExpired, showNoFamily]);

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
    if (!activeChildId) {
      return;
    }

    const next = { ...loadActiveTimers(activeChildId), [type]: { startedAt: new Date().toISOString() } };
    saveActiveTimers(activeChildId, next);
    setActiveTimers(next);
    setDialogType(null);
  }

  function handleTimerStop(type: TimerType) {
    if (!activeChildId) {
      return;
    }

    const next = { ...loadActiveTimers(activeChildId) };
    delete next[type];
    saveActiveTimers(activeChildId, next);
    setActiveTimers(next);
  }

  function closeDialog() {
    setDialogType(null);
    setEditEvent(null);
  }

  async function handleSaveEvent(input: CreateCareEventInput) {
    mutationRef.current += 1;

    if (editEvent) {
      // An edit keeps the child it was logged against, even mid-switch.
      await trackerStore.updateEvent({ ...editEvent, ...input } as CareEvent);
    } else {
      await trackerStore.addEvent({ ...input, babyId: input.babyId ?? activeChildId });
    }

    if (input.type === 'birth') {
      await trackerStore.saveProfile({ birthDate: input.startedAt, id: activeChildId });
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

  async function handleSaveShoppingItem(input: Parameters<typeof trackerStore.saveShoppingItem>[0]) {
    mutationRef.current += 1;
    await trackerStore.saveShoppingItem(input);
    signatureRef.current = '';
    await refresh();
  }

  async function handleRemoveShoppingItem(id: string) {
    mutationRef.current += 1;
    await trackerStore.removeShoppingItem(id);
    signatureRef.current = '';
    await refresh();
  }

  async function handleSaveTask(input: Parameters<typeof trackerStore.saveTask>[0]) {
    mutationRef.current += 1;
    await trackerStore.saveTask(input);
    signatureRef.current = '';
    await refresh();
  }

  async function handleRemoveTask(id: string) {
    mutationRef.current += 1;
    await trackerStore.removeTask(id);
    signatureRef.current = '';
    await refresh();
  }

  async function handleToggleRef(type: 'milestone' | 'vaccine', refId: string, on: boolean) {
    mutationRef.current += 1;

    if (on) {
      await trackerStore.addEvent({ babyId: activeChildId, refId, startedAt: new Date().toISOString(), type } as CreateCareEventInput);
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
    // Always name the child being edited — without an id the store would patch
    // whichever one happens to be first, which is the wrong baby on a switch.
    const before = profiles.find((person) => person.id === (profilePatch.id ?? activeChildId));
    const saved = await trackerStore.saveProfile({ ...profilePatch, id: profilePatch.id ?? activeChildId });

    if (saved.email && saved.email !== before?.email) {
      await shareWithPerson(saved);
    }

    setProfile(saved);
    setProfiles((current) => current.map((child) => (child.id === saved.id ? saved : child)));
    // The signature is stale now, so the next poll reconciles rather than
    // deciding nothing changed.
    signatureRef.current = '';
  }

  /**
   * Someone given an email on a family the app created is shared on its sheet,
   * with an invite link. The build's own sheet was not made by the app, so its
   * owner still shares it by hand — say so rather than leave them unable to sign in.
   */
  async function shareWithPerson(person: Pick<BabyProfile, 'email' | 'kind' | 'name'>) {
    if (!person.email || !(isParent(person) || isCaregiverAccount(person))) {
      return;
    }

    if ((await trackerStore.shareFamily(person.email)) === 'manual') {
      setError(`Share the family's Google Sheet with ${person.email} so ${person.name} can sign in.`);
    }
  }

  async function handleAddChild(input: NewProfileInput) {
    mutationRef.current += 1;
    const added = await trackerStore.addProfile(input);
    await shareWithPerson(added);
    // Land on the new child: whoever just added one is about to log for them.
    await selectChild(added.id);
  }

  /**
   * Sets someone aside. Their profile and every entry of theirs stay exactly
   * where they are, and `handleRestoreProfile` brings them back — a family may
   * be archiving a profile for the saddest of reasons, and nothing here deletes
   * a person.
   */
  async function handleArchiveProfile(babyId: string) {
    mutationRef.current += 1;
    await trackerStore.archiveProfile(babyId);
    signatureRef.current = '';

    const remaining = getActiveProfiles(profiles.filter((person) => person.id !== babyId));

    if (babyId === activeChildRef.current && remaining[0]) {
      await selectChild(remaining[0].id);
      return;
    }

    await refresh();
  }

  async function handleRestoreProfile(babyId: string) {
    mutationRef.current += 1;
    await trackerStore.restoreProfile(babyId);
    signatureRef.current = '';
    await refresh();
  }

  /**
   * Backfills a household that splits the night: one sleep entry per night for
   * whoever is on each shift, then the babies' entries in those hours recorded
   * against them. Reads the whole log rather than the active person's, since it
   * is about everyone at once.
   */
  async function handleApplyShifts(plan: ShiftPlan): Promise<ShiftResult> {
    mutationRef.current += 1;

    const shifts = [plan.night, plan.morning].filter((shift): shift is Shift => Boolean(shift?.caregiverId));
    const everything = await trackerStore.exportData();
    const childIds = new Set(everything.profiles?.filter(isChild).map((person) => person.id) ?? []);
    const result: ShiftResult = { attributed: 0, skipped: 0, sleepsAdded: 0 };

    // Sleeps first: their ids are derived from the night, so a second run
    // proposes the same entries and the merge simply finds them already there.
    // **Every parent named gets the same hours in bed** — the shifts say who
    // gets up, not who is asleep.
    const window = plan.sleep ?? DEFAULT_SLEEP_WINDOW;
    const sleepers = [...new Set(shifts.map((shift) => shift.caregiverId))];
    const today = getLocalDateKey(new Date());
    const napper = plan.nap?.caregiverId
      ? everything.profiles?.find((person) => person.id === plan.nap?.caregiverId)
      : undefined;
    const sleeps = [
      ...sleepers.flatMap((id) => {
        const parent = everything.profiles?.find((person) => person.id === id);
        return parent ? planParentSleeps(parent, window, plan.from, today) : [];
      }),
      // The night-shift parent's morning nap, while the other one is on.
      ...(napper && plan.nap ? planParentSleeps(napper, plan.nap, plan.from, today) : [])
    ];
    const known = new Set(everything.events.map((event) => event.id));
    const missing = sleeps.filter((sleep) => !known.has(sleep.id as string));

    if (missing.length > 0) {
      await trackerStore.importData(
        { events: missing as CareEvent[], exportedAt: new Date().toISOString(), profile: everything.profile, profiles: everything.profiles, version: 1 },
        { mode: 'merge' }
      );
      result.sleepsAdded = missing.length;
    }

    const babyEvents = everything.events.filter((event) => childIds.has(event.babyId));
    const attribution = planAttribution(babyEvents, shifts, plan.from);
    result.attributed = attribution.assignments.length;
    result.skipped = attribution.alreadyAttributed + attribution.uncovered;

    if (attribution.assignments.length > 0) {
      await trackerStore.assignCaregivers(
        attribution.assignments.map(({ caregiverId, event }) => ({ caregiverId, id: event.id }))
      );
    }

    signatureRef.current = '';
    await refresh();
    return result;
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
      refreshIdentity();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to connect Google Sheets.');
      setStoreStatus(trackerStore.getStatus?.() ?? null);
    }
  }

  // Forget the token, grant and email, then reload: the sheet store lives in
  // memory and the next boot, with no grant left, opens on the sign-in screen.
  // Entries cached on the device stay — signing out is not a wipe. The hash is
  // dropped so signing back in lands on Home rather than Settings.
  function handleSignOut() {
    signOutGoogle();
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    window.location.reload();
  }

  async function handleSplashContinue() {
    setLoading(true);
    setError('');
    try {
      await trackerStore.connect?.();
      setSignedInEmail(getStoredGoogleEmail());
      await refresh();
      refreshIdentity();
      setSessionExpired(false);
      setBootPhase('ready');
    } catch (caught) {
      if (caught instanceof NoFamilyError) {
        showNoFamily(caught);
        return;
      }

      setError(caught instanceof Error ? caught.message : 'Unable to connect Google Sheets.');
      setStoreStatus(trackerStore.getStatus?.() ?? null);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateFamily(input: NewFamilyInput) {
    setLoading(true);
    setError('');
    try {
      await trackerStore.createFamily(input);
      await enterFamily();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to set up the family.');
    } finally {
      setLoading(false);
    }
  }

  async function handleClaimFamily(familyId: string, parentId: string) {
    setLoading(true);
    setError('');
    try {
      await trackerStore.claimFamily(familyId, parentId);
      await enterFamily();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to open the family.');
    } finally {
      setLoading(false);
    }
  }

  /** After a family is created or claimed: the store is connected to it now. */
  async function enterFamily() {
    // The previous family's screen (if any) is not this one's.
    signatureRef.current = '';
    activeChildRef.current = undefined;
    setSignedInEmail(getStoredGoogleEmail());
    await refresh();
    refreshIdentity();
    setNoFamily(null);
    setBootPhase('ready');
  }

  // A signed-in account no family has added — at sign-in, or taken off the
  // family's profiles while the app was open. Nothing of any family shows.
  if ((bootPhase === 'nofamily' || (bootPhase === 'ready' && access.role === 'none')) && !splashEmergency) {
    return (
      <FamilySetup
        claim={noFamily?.claim}
        email={noFamily?.email ?? signedInEmail}
        error={error}
        loading={loading}
        onClaim={handleClaimFamily}
        onCreate={handleCreateFamily}
        onSignOut={handleSignOut}
      />
    );
  }

  if (bootPhase !== 'ready' || splashEmergency) {
    return (
      <LoginSplash
        emergencyOpen={splashEmergency}
        error={error}
        loading={loading}
        restoring={bootPhase === 'restoring'}
        sessionExpired={sessionExpired}
        storeStatus={storeStatus}
        onContinue={handleSplashContinue}
        onEmergencyChange={setSplashEmergency}
        onOffline={loadOffline}
        onSignOut={handleSignOut}
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
  const parentMode = isParent(profile);
  const allowedTabs = caregiverMode ? CAREGIVER_TABS : parentMode ? PARENT_TABS : CHILD_TABS;
  // The switcher's people: a caregiver is minding the children, nobody else.
  const switchable = getActiveProfiles(profiles).filter((person) => !caregiverMode || isChild(person));
  const visibleTabs = tabs.filter((tab) => allowedTabs.has(tab.id));
  // A profile switch can make the current tab inapplicable. Land somewhere
  // useful instead of leaving a hidden household/child view on screen.
  const view = allowedTabs.has(activeView) ? activeView : 'dashboard';

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-wordmark">BabySteps</span>
        {switchable.length > 1 && <ChildSwitcher activeId={profile.id} profiles={switchable} onSelect={selectChild} />}
      </header>

      {error && <p className="error-banner" role="alert">{error}</p>}

      {view === 'dashboard' &&
        (parentMode ? (
          <ParentDashboard
            activeTimers={activeTimers}
            childEvents={childEvents}
            events={events}
            profile={profile}
            profiles={profiles}
            todayKey={todayKey}
            onAdd={setDialogType}
          />
        ) : (
          <Dashboard
            activeTimers={activeTimers}
            allowedTypes={caregiverMode ? CAREGIVER_EVENT_TYPES : undefined}
            events={events}
            profile={profile}
            profiles={profiles}
            todayKey={todayKey}
            onAdd={setDialogType}
            onOpenLog={caregiverMode ? undefined : openFilteredLog}
          />
        ))}

      {view === 'log' && (
        <Log
          events={events}
          firstYearEvents={firstYearEvents}
          initialType={logTypeFilter}
          profile={profile}
          profiles={profiles}
          onAdd={setDialogType}
          onDelete={handleDeleteEvent}
          onEdit={setEditEvent}
        />
      )}

      {view === 'reports' &&
        (parentMode ? (
          <ParentReports childEvents={childEvents} events={events} profile={profile} profiles={profiles} />
        ) : (
          <Reports events={events} profile={profile} profiles={profiles} />
        ))}

      {view === 'care' && (
        <Care
          caregiverView={caregiverMode}
          events={events}
          profile={profile}
          profiles={profiles}
          onEdit={setEditEvent}
          onSaveProfile={handleSaveProfile}
          onToggle={handleToggleRef}
        />
      )}

      {view === 'shopping' && (
        <ShoppingList
          items={shopping}
          profile={profile}
          profiles={profiles}
          onRemove={handleRemoveShoppingItem}
          onSave={handleSaveShoppingItem}
        />
      )}

      {view === 'todos' && (
        <Todos
          profile={profile}
          profiles={profiles}
          tasks={tasks}
          onRemove={handleRemoveTask}
          onSave={handleSaveTask}
        />
      )}

      {view === 'learn' && <Learn />}

      {view === 'settings' && (
        <SettingsPanel
          events={events}
          profile={profile}
          profiles={profiles}
          signedInEmail={signedInEmail}
          storeStatus={storeStatus}
          theme={theme}
          onAddChild={handleAddChild}
          onApplyShifts={handleApplyShifts}
          onConnectSheet={handleConnectSheet}
          onArchiveProfile={handleArchiveProfile}
          onRestoreProfile={handleRestoreProfile}
          onSelectChild={selectChild}
          onSignOut={handleSignOut}
          onExport={handleExport}
          onImport={handleImport}
          onOpenLearn={() => navigate('learn')}
          onSaveProfile={handleSaveProfile}
          onThemeChange={setTheme}
        />
      )}

      <nav
        className="bottom-nav"
        aria-label="Primary"
        style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}
      >
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const selected = view === tab.id;

          return (
            <button
              type="button"
              key={tab.id}
              aria-pressed={selected}
              className={selected ? 'active' : ''}
              data-nav={tab.id}
              onClick={() => {
                if (tab.id === 'log') setLogTypeFilter(null);
                navigate(tab.id);
              }}
            >
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
        foodNames={getFoodNames(shopping)}
        loggedBy={caregiverMode ? (access.account?.id ?? '') : undefined}
        onClose={closeDialog}
        onSave={handleSaveEvent}
        onTimerStart={handleTimerStart}
        onTimerStop={handleTimerStop}
        profile={profile}
        profiles={profiles}
      />
    </div>
  );
}

export default App;
