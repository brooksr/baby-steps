import { BarChart3, BookOpen, ClipboardCheck, Home, List, ListTodo, Settings, ShoppingCart, UserRound } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { CRYING_MOOD_LEVEL } from './domain/cryContext';
import type { NurseryData } from './domain/nurserySensor';
import type { UnloggedSleep } from './components/NightReport';
import { Dashboard } from './components/Dashboard';
import { ParentDashboard } from './components/ParentDashboard';
import { Log } from './components/Log';
import { Reports } from './components/Reports';
import { ParentReports } from './components/ParentReports';
import { Care } from './components/Care';
import { ShoppingList } from './components/ShoppingList';
import { Todos } from './components/Todos';
import { SettingsPanel } from './components/SettingsPanel';
import { ChildSwitcher } from './components/ChildSwitcher';
import { QuickAddDialog } from './components/QuickAddDialog';
import { InternalSignIn } from './components/InternalSignIn';
import { Learn } from './components/Learn';
import { CAREGIVER_EVENT_TYPES } from './domain/access';
import { getLocalDateKey } from './domain/dates';
import { downloadText } from './domain/download';
import { createFamilyProfile, getActiveProfiles, isChild, isParent } from './domain/family';
import { getFirstYearEvents } from './domain/firstYear';
import type { BootstrapData, InternalFamily, RecordCollection } from './domain/internalApi';
import { loadActiveTimers, saveActiveTimers, type ActiveTimers, type TimerType } from './domain/timers';
import { applyTheme, getInitialTheme } from './domain/theme';
import type { CareEvent, CareEventType, CreateCareEventInput, TrackerExport } from './domain/types';
import { showInternalGoogle } from './storage/internalGoogle';
import { INTERNAL_API, InternalClient, InternalRequestError, internalRequest, type QueuedMutation } from './storage/internalClient';
import { OtherAccountError, withRecentSignIn } from './storage/internalReauth';

interface Session { accountId: string; needsPasskey?:boolean; families: InternalFamily[] }
const icons = { Account:UserRound,Care:ClipboardCheck,Home,Learn:BookOpen,Log:List,Reports:BarChart3,Settings,Shopping:ShoppingCart,'To-do':ListTodo };
const CHOICE = 'babysteps.internal.choice';
const views = ['Home','Log','Reports','Care','Shopping','To-do','Settings','Account','Learn'] as const;
type View = typeof views[number];
function storedChoice(): { accountId: string; familyId: string } | undefined { try { return JSON.parse(localStorage.getItem(CHOICE) ?? 'null') ?? undefined; } catch { return undefined; } }

export default function InternalApp() {
  const api = INTERNAL_API!;
  const [session,setSession] = useState<Session>(); const [restoring,setRestoring] = useState(true);
  const [families,setFamilies] = useState<InternalFamily[]>([]); const [family,setFamily] = useState('');
  const [data,setData] = useState<BootstrapData>(); const [queue,setQueue] = useState<QueuedMutation[]>([]);
  const [client,setClient] = useState<InternalClient>(); const current = useRef<InternalClient>();
  const [activeId,setActiveId] = useState(''); const [view,setView] = useState<View>('Home');
  const [error,setError] = useState(''); const [offline,setOffline] = useState(false); const [busy,setBusy] = useState(false);
  const [dialog,setDialog] = useState<CareEventType | null>(null); const [editing,setEditing] = useState<CareEvent | null>(null);
  const [preset,setPreset] = useState<UnloggedSleep | null>(null);
  const [timers,setTimers] = useState<ActiveTimers>({}); const [theme,setTheme] = useState(getInitialTheme);
  const [recovery,setRecovery] = useState<{ accountId: string; codes: string[] }>();
  const [invite,setInvite] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('invite') ?? '');
  const [deviceCode,setDeviceCode] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('device') ?? ''); const [parentName,setParentName] = useState(''); const [childName,setChildName] = useState('');
  const [googleEnabled,setGoogleEnabled] = useState(false);
  const [activity,setActivity] = useState<Array<{ action:string; createdAt:string }>>([]);
  const [credentials,setCredentials] = useState<{ google: boolean; passkeys: Array<{ id: string; createdAt: string }> }>();
  const [deviceReview,setDeviceReview] = useState<{ purpose:string; expiresAt:string }>();
  const [devices,setDevices] = useState<{ devices: Array<{ id: string; familyId: string }>; sessions: Array<{ id: string; createdAt: string }> }>();
  const signedIn = useCallback(async () => {
    const result = await internalRequest<Session>(api,'/session'); setSession(result); setFamilies(result.families); setOffline(false); setError('');
    const saved = storedChoice(); setFamily(result.families.find((f) => f.familyId === saved?.familyId)?.familyId ?? result.families[0]?.familyId ?? '');
  },[api]);
  useEffect(() => {
    let cancelled = false;
    void signedIn().catch((e) => {
      if (cancelled) return;
      const saved = storedChoice();
      if (!(e instanceof InternalRequestError) && saved) { setSession({ accountId:saved.accountId,families:[] }); setFamily(saved.familyId); setOffline(true); }
    }).finally(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; };
  },[signedIn]);
  useEffect(() => { applyTheme(theme); },[theme]);
  useEffect(() => { void internalRequest<{ googleClientId?:string }>(api,'/config').then((config) => setGoogleEnabled(Boolean(config.googleClientId))).catch(() => {}); },[api]);
  useEffect(() => {
    if (!session || !family) { setClient(undefined); setData(undefined); return; }
    const next = new InternalClient(api,session.accountId,family); current.current = next; setClient(next); setData(undefined); setQueue([]); setView(session.needsPasskey || window.location.hash.startsWith('#device=') ? 'Account':'Home');
    localStorage.setItem(CHOICE,JSON.stringify({ accountId:session.accountId,familyId:family }));
    let stopped = false; let running = false;
    async function refresh() {
      if (stopped || running) return; running = true;
      try {
        const cached = await next.state(); if (!stopped) { setData(cached.data); setQueue(cached.queue); }
        if (!cached.data) await next.bootstrap(); else await next.sync();
        if (!stopped) { setOffline(false); const state = await next.state(); setData(state.data); setQueue(state.queue); }
      } catch (e) {
        if (!stopped) {
          if (e instanceof InternalRequestError && [401,403].includes(e.status)) { setData(undefined); setSession(undefined); setError('Sign in again to continue. Queued changes are kept for this account.'); }
          else setOffline(true);
        }
      } finally { running = false; }
    }
    void refresh(); const interval = window.setInterval(() => void refresh(),45_000);
    return () => { stopped = true; window.clearInterval(interval); if (current.current === next) current.current = undefined; next.close(); };
  },[api,family,session]);
  const people = data?.data.profiles ?? (data ? [data.data.profile] : []);
  const profile = getActiveProfiles(people).find((p) => p.id === activeId) ?? getActiveProfiles(people)[0];
  const timerKey = session && family && profile ? `internal:${api}:${session.accountId}:${family}:${profile.id}` : '';
  useEffect(() => { setTimers(timerKey ? loadActiveTimers(timerKey) : {}); },[timerKey]);
  async function run(action: () => Promise<void>) { setError(''); setBusy(true); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); } }
  /** For the actions the server wants a recent sign-in for: confirms with a passkey and retries. */
  async function confirmed<T>(action: () => Promise<T>) {
    try { return await withRecentSignIn(api,session?.accountId ?? '',action); } catch (e) { if (e instanceof OtherAccountError) await signedIn(); throw e; }
  }
  async function reload() { if (!client) return; const state = await client.state(); if (current.current === client) { setData(state.data); setQueue(state.queue); } }
  async function mutate(collection: RecordCollection,id: string,action: 'archive' | 'remove' | 'restore' | 'save',patch?: object) {
    if (!client) return;
    await client.queue(collection,id,action,patch as Record<string,unknown> | undefined); await reload();
    try { await client.sync(); setOffline(false); } catch (e) { if (e instanceof InternalRequestError) throw e; setOffline(true); } finally { await reload(); }
  }
  async function logout() {
    await internalRequest(api,'/auth/logout',{}); current.current = undefined; client?.close(); setClient(undefined); setData(undefined); setSession(undefined); setFamily(''); setQueue([]);
    localStorage.removeItem(CHOICE); window.history.replaceState(null,'',window.location.pathname);
  }
  async function importData(imported: TrackerExport) {
    const profiles = imported.profiles?.length ? imported.profiles : [imported.profile];
    for (const p of profiles) { const patch = { ...p,familyId:family }; delete patch.archivedAt; await mutate('profiles',p.id,'save',patch); if (p.archivedAt) await mutate('profiles',p.id,'archive'); }
    for (const e of imported.events) await mutate('events',e.id,'save',e);
    for (const item of imported.shopping ?? []) await mutate('shopping',item.id,'save',item);
    for (const task of imported.tasks ?? []) await mutate('tasks',task.id,'save',task);
  }
  const recoveryPanel = recovery && <section className="card"><h2>Keep your recovery codes</h2><p>Save these somewhere private. Each code works once. Your account ID is needed with the code.</p>
    <textarea aria-label="Recovery codes" readOnly value={`${recovery.accountId}\n${recovery.codes.join('\n')}`} rows={12} />
    <button className="primary-button" type="button" onClick={() => downloadText('babysteps-recovery.txt',`${recovery.accountId}\n${recovery.codes.join('\n')}`,'text/plain')}>Download recovery codes</button>
    <button className="secondary-button" type="button" onClick={() => setRecovery(undefined)}>I saved them</button></section>;
  if (restoring) return <main className="splash-screen"><p>Opening BabySteps…</p></main>;
  if (!session) return <><InternalSignIn api={api} onSignedIn={signedIn} onRecovery={(codes,accountId) => setRecovery({ accountId,codes })} />{recoveryPanel}{queue.length > 0 && <section className="card"><p>Changes from your previous account are kept on this device. Sign in again to sync them, or keep a private export.</p><button onClick={() => downloadText('babysteps-pending.json',JSON.stringify(queue,null,2),'application/json')}>Export pending changes</button></section>}</>;
  if (!family) return <main className="splash-screen"><section className="splash-panel"><h1>Your family</h1>{recoveryPanel}
    {error && <p role="alert">{error}</p>}
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void run(async () => { const created = await confirmed(() => internalRequest<{ familyId: string }>(api,'/families',{ childName,parentName,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone })); await signedIn(); setFamily(created.familyId); }); }}>
      <label>Your name<input value={parentName} onChange={(e) => setParentName(e.target.value)} required /></label><label>Baby’s name (optional)<input value={childName} onChange={(e) => setChildName(e.target.value)} /></label><button disabled={busy} className="primary-button">Start a family</button></form>
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void run(async () => { await confirmed(() => internalRequest(api,'/invitations/accept',{ token:invite })); setInvite(''); window.history.replaceState(null,'',window.location.pathname); await signedIn(); }); }}>
      <label>Invitation token<input value={invite} onChange={(e) => setInvite(e.target.value)} /></label><button disabled={busy} className="secondary-button">Accept invitation</button></form>
    <button type="button" onClick={() => void run(logout)}>Sign out</button></section></main>;
  if (!data || !profile) return <main className="splash-screen"><section className="splash-panel"><h1>Open your family</h1><p>{error || 'Connecting to your family…'}</p>
    <button className="secondary-button" onClick={() => void run(signedIn)}>Sign in again</button><button className="secondary-button" onClick={() => void run(logout)}>Sign out</button>
    {queue.length > 0 && <button onClick={() => downloadText('babysteps-pending.json',JSON.stringify(queue,null,2),'application/json')}>Export pending changes</button>}</section></main>;
  const caregiver = data.role === 'caregiver'; const parent = isParent(profile);
  const events = data.data.events.filter((e) => e.babyId === profile.id); const childIds = new Set(people.filter(isChild).map((p) => p.id));
  const childEvents = data.data.events.filter((e) => childIds.has(e.babyId));
  const allowed: readonly View[] = caregiver ? ['Home','Care','Account'] : parent ? views.filter((v) => v !== 'Care') : views.filter((v) => !['Shopping','To-do'].includes(v));
  const showing = allowed.includes(view) ? view : 'Home';
  function changeTimer(type: TimerType,start: boolean) { const next = { ...timers }; if (start) next[type] = { startedAt:new Date().toISOString() }; else delete next[type]; setTimers(next); saveActiveTimers(timerKey,next); }
  async function saveEvent(input: CreateCareEventInput) { const id = editing?.id ?? crypto.randomUUID(); await mutate('events',id,'save',{ ...input,babyId:profile!.id }); setDialog(null); setEditing(null); }
  return <div className="app-shell internal-app">
    <header className="app-header"><h1>BabySteps</h1><ChildSwitcher activeId={profile.id} profiles={people} onSelect={(id) => { setActiveId(id); setView('Home'); }} />
      {families.length > 1 && <label>Family<select value={family} onChange={(e) => { setData(undefined); setQueue([]); setFamily(e.target.value); }}>{families.map((f) => <option key={f.familyId} value={f.familyId}>{f.name}</option>)}</select></label>}</header>
    {offline && <p className="notice">Offline · changes stay on this device until you reconnect.</p>}<button className="secondary-button" onClick={() => void run(async () => { await client!.sync(); setOffline(false); await reload(); })}>Sync now</button>{error && <p role="alert" className="error-banner">{error}</p>}{recoveryPanel}
    {queue.length > 0 && <section className="card"><h2>Queued changes ({queue.length})</h2>{queue.map((row) => <div key={row.order}><p>{{ events:'Entry',nursery:'Nursery summary',profiles:'Person',shopping:'Shopping item',tasks:'Task' }[row.command.collection]} · {row.error ? 'Needs review before syncing' : 'Waiting to sync'}</p>
      {row.error && <button onClick={() => void run(async () => { await client!.retryWithLatest(row.order!); await client!.sync(); await reload(); })}>Apply to latest version</button>}
      <button onClick={() => void run(async () => { await client!.discard(row.order!); await reload(); })}>Discard queued change</button></div>)}
      <button onClick={() => downloadText('babysteps-pending.json',JSON.stringify(queue,null,2),'application/json')}>Export pending changes</button></section>}
    {showing === 'Home' && (parent ? <ParentDashboard activeTimers={timers} childEvents={childEvents} events={events} profile={profile} profiles={people} todayKey={getLocalDateKey(new Date())} onAdd={setDialog} /> :
      <Dashboard activeTimers={timers} allowedTypes={caregiver ? CAREGIVER_EVENT_TYPES : undefined} events={events} profile={profile} profiles={people} todayKey={getLocalDateKey(new Date())} onAdd={setDialog} onOpenLog={caregiver ? undefined : () => setView('Log')} />)}
    {showing === 'Log' && <Log events={events} firstYearEvents={getFirstYearEvents(profile,events)} profile={profile} profiles={people} onAdd={setDialog} onDelete={(id) => mutate('events',id,'remove')} onEdit={setEditing} />}
    {showing === 'Reports' && (parent ? <ParentReports childEvents={childEvents} events={events} profile={profile} profiles={people} /> : <Reports events={events} profile={profile} profiles={people}
        loadNursery={async () => (await internalRequest<{ nursery:NurseryData }>(api,`/families/${encodeURIComponent(family)}/nursery`)).nursery}
        onLogSleep={(sleep) => { setPreset(sleep); setDialog('sleep'); }}
        onLogSleeps={async (sleeps) => { for (const sleep of sleeps) await mutate('events',crypto.randomUUID(),'save',{ babyId:profile.id,endedAt:sleep.endedAt,startedAt:sleep.startedAt,type:'sleep' }); }}
        onMarkCries={async (cries) => { for (const cry of cries) await mutate('events',crypto.randomUUID(),'save',{ babyId:profile.id,level:CRYING_MOOD_LEVEL,notes:cry.notes,startedAt:cry.startedAt,type:'mood' }); }} />)}
    {showing === 'Care' && <Care caregiverView={caregiver} events={events} profile={profile} profiles={people} onEdit={setEditing} onSaveProfile={(patch) => mutate('profiles',patch.id ?? profile.id,'save',patch)}
      onToggle={async (type,refId,on) => { const row = events.find((e) => (e.type === 'milestone' || e.type === 'vaccine') && e.refId === refId); if (on) await mutate('events',crypto.randomUUID(),'save',{ babyId:profile.id,refId,startedAt:new Date().toISOString(),type }); else if (row) await mutate('events',row.id,'remove'); }} />}
    {showing === 'Shopping' && <ShoppingList items={data.data.shopping ?? []} profile={profile} profiles={people} onRemove={(id) => mutate('shopping',id,'remove')} onSave={(item) => mutate('shopping',item.id ?? crypto.randomUUID(),'save',{ ...(item.id ? {} : { category:'pantry',isFood:false,status:'need' }),...item })} />}
    {showing === 'To-do' && <Todos profile={profile} profiles={people} tasks={data.data.tasks ?? []} onRemove={(id) => mutate('tasks',id,'remove')} onSave={(item) => mutate('tasks',item.id ?? crypto.randomUUID(),'save',{ status:'open',...item })} />}
    {showing === 'Learn' && <Learn />}
    {showing === 'Settings' && <SettingsPanel events={events} profile={profile} profiles={people} storeStatus={{ backend:'internal',configured:true,connected:!offline,familyId:family,message:'Family data is stored in BabySteps.' }} theme={theme}
      onAddChild={async (input) => { const person = createFamilyProfile(input,people); await mutate('profiles',person.id,'save',person); }}
      onArchiveProfile={(id) => mutate('profiles',id,'archive')} onRestoreProfile={(id) => mutate('profiles',id,'restore')} onSaveProfile={(patch) => mutate('profiles',patch.id ?? profile.id,'save',patch)} onSelectChild={async (id) => { setActiveId(id); }}
      onConnectSheet={async () => {}} onApplyShifts={async () => { throw new Error('Night shift is disabled.'); }} onExport={async () => data.data} onImport={importData}
      onInviteProfile={async (person) => { const result = await confirmed(() => internalRequest<{ token: string }>(api,`/families/${encodeURIComponent(family)}/invitations`,{ profileId:person.id }));
        const link = `${window.location.origin}${import.meta.env.BASE_URL}#invite=${result.token}`; await navigator.clipboard.writeText(link); setError('Invitation link copied. It expires in 48 hours.'); }}
      onOpenLearn={() => setView('Learn')} onSignOut={() => void run(logout)} onThemeChange={setTheme} />}
    {showing === 'Account' && <section className="card"><h2>Your BabySteps account</h2>{session.needsPasskey && <p role="alert">Recovery revoked earlier passkeys, Google linking and device sessions. Add a new passkey before signing out.</p>}<p>Account ID: {session.accountId}</p><p>Family ID: {family}</p>
      <button onClick={() => void run(async () => { const result = await confirmed(() => internalRequest<{ challengeId:string; options:PublicKeyCredentialCreationOptionsJSON }>(api,'/auth/register/options',{}));
        const response = await startRegistration({ optionsJSON:result.options }); await internalRequest(api,'/auth/register/finish',{ challengeId:result.challengeId,response }); setError('Passkey added.'); })}>Add another passkey</button>
      {googleEnabled && <button onClick={() => void run(() => confirmed(() => showInternalGoogle(api,document.getElementById('internal-google-link')!,async () => { setError('Google account linked.'); },(e) => setError(e instanceof Error ? e.message : 'Could not link Google'))))}>Link Google as another sign-in method</button>}<div id="internal-google-link" />
      {credentials?.google && <button onClick={() => void run(async () => { await confirmed(() => internalRequest(api,'/account/credentials/revoke',{ provider:'google' })); setCredentials(await internalRequest(api,'/account/credentials')); })}>Unlink Google</button>}
      {invite && <form onSubmit={(e) => { e.preventDefault(); void run(async () => { const result = await confirmed(() => internalRequest<{ familyId:string }>(api,'/invitations/accept',{ token:invite })); setInvite(''); await signedIn(); setFamily(result.familyId); window.history.replaceState(null,'',window.location.pathname); }); }}><label>Invitation token<input value={invite} onChange={(e) => setInvite(e.target.value)} /></label><button>Join invited family</button></form>}
      <button onClick={() => void run(async () => { const result = await confirmed(() => internalRequest<{ accountId:string; recoveryCodes:string[] }>(api,'/account/recovery',{})); setRecovery({ accountId:result.accountId,codes:result.recoveryCodes }); })}>Replace recovery codes</button>
      <button onClick={() => void run(async () => { setCredentials(await internalRequest(api,'/account/credentials')); setDevices(await internalRequest(api,'/account/sessions')); setActivity((await internalRequest<{ activity:Array<{ action:string; createdAt:string }> }>(api,'/account/activity')).activity); })}>Manage sign-in and devices</button>
      {credentials?.passkeys.map((key) => <p key={key.id}>Passkey added {key.createdAt}<button onClick={() => void run(async () => { await confirmed(() => internalRequest(api,'/account/credentials/revoke',{ id:key.id,provider:'passkey' })); setCredentials(await internalRequest(api,'/account/credentials')); })}>Revoke passkey</button></p>)}
      {devices?.devices.map((device) => <p key={device.id}>Device {device.id}<button onClick={() => void run(async () => { await confirmed(() => internalRequest(api,'/account/revoke',{ installationId:device.id })); setDevices(await internalRequest(api,'/account/sessions')); })}>Revoke device</button></p>)}
      {devices?.sessions.map((item) => <p key={item.id}>Session opened {item.createdAt}<button onClick={() => void run(async () => { await confirmed(() => internalRequest(api,'/account/revoke',{ sessionId:item.id })); setDevices(await internalRequest(api,'/account/sessions')); })}>Revoke session</button></p>)}
      {activity.length > 0 && <details><summary>Recent account activity</summary>{activity.map((item,index) => <p key={index}>{item.createdAt} · {item.action}</p>)}</details>}
      <form onSubmit={(event) => { event.preventDefault(); void run(async () => { setDeviceReview(await internalRequest(api,'/native/preview',{ userCode:deviceCode })); }); }}>
        <label>Phone, watch or nursery connection code<input value={deviceCode} onChange={(e) => { setDeviceCode(e.target.value); setDeviceReview(undefined); }} required /></label><button disabled={busy}>Review device</button></form>
      {deviceReview && <div><p>{deviceReview.purpose === 'nursery' ? 'This nursery device can send sound summaries and read the latest care status.' : deviceReview.purpose === 'watch' ? 'This watch can read feed, diaper and sleep status, and log feeds and diapers.' : 'This phone gets your family access, including editing for a parent account.'}</p>
        <button onClick={() => void run(async () => { await confirmed(() => internalRequest(api,'/native/approve',{ familyId:family,userCode:deviceCode })); setDeviceCode(''); setDeviceReview(undefined); window.history.replaceState(null,'',window.location.pathname); setError('Device connected.'); })}>Allow this {deviceReview.purpose} for this family</button></div>}
      <button onClick={() => void run(logout)}>Sign out</button></section>}
    <nav className="bottom-nav" aria-label="Primary" style={{ gridTemplateColumns:`repeat(${allowed.filter((item) => item !== 'Learn').length}, minmax(0,1fr))` }}>{allowed.filter((item) => item !== 'Learn').map((item) => {
      const Icon = icons[item]; return <button key={item} className={showing === item ? 'active' : ''} aria-pressed={showing === item} onClick={() => { setView(item); window.history.replaceState(null,'',`#${item.toLowerCase()}`); }}><Icon aria-hidden="true" /><span>{item}</span></button>;
    })}</nav>
    <QuickAddDialog activeTimers={timers} eventType={dialog} editEvent={editing} loggedBy={caregiver || !editing ? data.actorProfileId : undefined} profile={profile} profiles={people} presetTimes={preset} onClose={() => { setDialog(null); setEditing(null); setPreset(null); }} onSave={saveEvent}
      onTimerStart={(type) => changeTimer(type,true)} onTimerStop={(type) => changeTimer(type,false)} />
  </div>;
}
