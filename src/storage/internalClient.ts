import Dexie, { type Table } from 'dexie';
import type { BootstrapData, MutationCommand, MutationResult, RecordCollection } from '../domain/internalApi';
import type { CareEvent, TrackerExport } from '../domain/types';

export class InternalRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code.replace(/_/g,' ')); this.name = 'InternalRequestError'; }
}
export const INTERNAL_API = import.meta.env.VITE_INTERNAL_API?.replace(/\/+$/, '') as string | undefined;
export function internalCacheName(api: string, accountId: string, familyId: string) {
  const url = new URL(api, window.location.origin);
  return `babysteps-internal-${encodeURIComponent(url.href)}-${encodeURIComponent(accountId)}-${encodeURIComponent(familyId)}`;
}
export async function internalRequest<T>(api: string, path: string, body?: unknown, accountId?: string): Promise<T> {
  const csrf = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('__Host-babysteps-csrf='))?.slice('__Host-babysteps-csrf='.length);
  const response = await fetch(`${api}${path}`, { body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin',
    headers: { ...(accountId ? { 'X-Babysteps-Account':accountId } : {}), ...(body === undefined ? {} : { 'Content-Type':'application/json', ...(csrf ? { 'X-Babysteps-CSRF':csrf } : {}) }) }, method: body === undefined ? 'GET':'POST' });
  const result = await response.json();
  if (!response.ok) throw new InternalRequestError(response.status, result.error ?? 'request_failed');
  return result as T;
}
export interface QueuedMutation { command: MutationCommand; error?: string; order?: number; queuedAt?: string }
class InternalCache extends Dexie {
  bootstrap!: Table<{ id: string; value: BootstrapData }, string>;
  outbox!: Table<QueuedMutation, number>;
  constructor(name: string) { super(name); this.version(1).stores({ bootstrap: 'id', outbox: '++order' }); }
}
function collection(data: TrackerExport, name: RecordCollection): Array<Record<string,unknown>> {
  if (name === 'nursery') return [];
  const rows = name === 'profiles' ? data.profiles ?? [data.profile] : data[name] ?? [];
  return rows as unknown as Array<Record<string,unknown>>;
}
function apply(data: BootstrapData, command: MutationCommand, result?: MutationResult, queuedAt = new Date().toISOString()) {
  const rows = collection(data.data, command.collection);
  const at = rows.findIndex((row) => row.id === command.id);
  const previous = at < 0 ? {} : rows[at];
  let payload = result?.payload ?? { ...previous, ...command.patch, createdAt:previous.createdAt ?? command.patch?.createdAt ?? queuedAt,id:command.id,syncState:'local',updatedAt:queuedAt };
  if (!result) {
    for (const [key,value] of Object.entries(payload)) if (value === null) delete payload[key];
    if (command.action === 'archive') payload = { ...payload, archivedAt: new Date().toISOString() };
    if (command.action === 'restore') delete payload.archivedAt;
  }
  if (command.action === 'remove') { if (at >= 0) rows.splice(at,1); }
  else if (at < 0) rows.push(payload); else rows[at] = payload;
  if (command.collection === 'profiles') { data.data.profiles = rows as unknown as BootstrapData['data']['profiles']; if (data.data.profile.id === command.id) data.data.profile = payload as unknown as BootstrapData['data']['profile']; }
  if (command.collection === 'events') data.data.events = rows as unknown as CareEvent[];
  if (command.collection === 'shopping') data.data.shopping = rows as unknown as TrackerExport['shopping'];
  if (command.collection === 'tasks') data.data.tasks = rows as unknown as TrackerExport['tasks'];
  if (command.collection === 'events' && payload.type === 'birth' && command.action === 'save' && !result) {
    const child = data.data.profiles?.find((p) => p.id === payload.babyId);
    if (child) child.birthDate = String(payload.startedAt).slice(0,10);
  }
  if (result) {
    data.revisions[`${command.collection}:${command.id}`] = result.revision;
    for (const related of result.related ?? []) apply(data,{ action:'save',collection:related.collection,expectedRevision:0,id:related.id,operationId:command.operationId },related);
  }
}
export class InternalClient {
  private cache: InternalCache;
  private syncing: Promise<void> | undefined;
  private closed = false;
  constructor(readonly api: string, readonly accountId: string, readonly familyId: string) { this.cache = new InternalCache(internalCacheName(api,accountId,familyId)); }
  async state() {
    const saved = await this.cache.bootstrap.get('current');
    const queue = await this.cache.outbox.orderBy('order').toArray();
    if (!saved) return { data: undefined, queue };
    const data = structuredClone(saved.value);
    for (const op of queue) apply(data, op.command,undefined,op.queuedAt);
    return { data, queue };
  }
  async bootstrap() {
    const value = await internalRequest<BootstrapData>(this.api, `/families/${encodeURIComponent(this.familyId)}/bootstrap`,undefined,this.accountId);
    if (value.accountId !== this.accountId || value.familyId !== this.familyId) throw new Error('Account or family changed. Sign in again.');
    await this.cache.bootstrap.put({ id: 'current', value });
    return value;
  }
  async queue(collectionName: RecordCollection, id: string, action: MutationCommand['action'], patch?: Record<string,unknown>) {
    await this.cache.transaction('rw', this.cache.bootstrap, this.cache.outbox, async () => {
      const saved = await this.cache.bootstrap.get('current'); if (!saved) throw new Error('Connect before recording the first entry.');
      const key = `${collectionName}:${id}`;
      const queued = (await this.cache.outbox.toArray()).filter((op) => op.command.id === id && op.command.collection === collectionName);
      const births = collectionName === 'profiles' ? (await this.cache.outbox.toArray()).filter((op) => op.command.collection === 'events' && op.command.action === 'save' && op.command.patch?.type === 'birth' && op.command.patch?.babyId === id).length : 0;
      const expectedRevision = (saved.value.revisions[key] ?? 0) + queued.length + births;
      const command: MutationCommand = { action, collection: collectionName, expectedRevision, id, operationId: crypto.randomUUID(),
        ...(patch ? { patch: JSON.parse(JSON.stringify({ ...patch,id },(key,value) =>
          value === undefined && ['archivedAt','familyId'].includes(key) ? undefined : value === undefined ? null : value)) } : {}) };
      await this.cache.outbox.add({ command,queuedAt:new Date().toISOString() });
    });
  }
  /** Explicit refresh repairs the local baseline even when its cursor is current. */
  async refresh() {
    if (this.closed) return;
    await this.sync();
    if (!this.closed) await this.bootstrap();
  }
  async sync() {
    if (this.syncing) return this.syncing;
    this.syncing = this.flush().finally(() => { this.syncing = undefined; });
    return this.syncing;
  }
  private async flush() {
    for (const row of await this.cache.outbox.orderBy('order').toArray()) {
      if (row.error || this.closed) break;
      try {
        const result = await internalRequest<MutationResult>(this.api, `/families/${encodeURIComponent(this.familyId)}/mutations`, row.command,this.accountId);
        if (this.closed) return;
        await this.cache.transaction('rw', this.cache.bootstrap, this.cache.outbox, async () => {
          const saved = await this.cache.bootstrap.get('current');
          if (saved) { apply(saved.value,row.command,result); await this.cache.bootstrap.put(saved); }
          await this.cache.outbox.delete(row.order!);
        });
      } catch (error) {
        if (error instanceof InternalRequestError && [400,403,404,409].includes(error.status)) await this.cache.outbox.update(row.order!, { error: error.code });
        throw error;
      }
    }
    const saved = await this.cache.bootstrap.get('current');
    if (saved && saved.value.role === 'parent') {
      try {
        const changes = await internalRequest<{ changes: unknown[] }>(this.api, `/families/${encodeURIComponent(this.familyId)}/changes?cursor=${encodeURIComponent(JSON.stringify(saved.value.cursor))}`,undefined,this.accountId);
        if (!changes.changes.length) return;
      } catch (error) { if (!(error instanceof InternalRequestError) || error.status !== 410) throw error; }
    }
    await this.bootstrap();
  }
  async discard(order: number) { await this.cache.outbox.delete(order); await this.bootstrap(); }
  async retryWithLatest(order: number) {
    const latest = await this.bootstrap();
    const row = await this.cache.outbox.get(order); if (!row) return;
    const expectedRevision = latest.revisions[`${row.command.collection}:${row.command.id}`] ?? 0;
    await this.cache.outbox.put({ queuedAt:row.queuedAt,command: { ...row.command, expectedRevision, operationId: crypto.randomUUID() }, order });
  }
  close() { this.closed = true; this.cache.close(); }
}
