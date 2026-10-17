import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BootstrapData } from '../domain/internalApi';
import { InternalClient, InternalRequestError, internalCacheName } from './internalClient';
const clients: InternalClient[] = [];
const timestamp = '2026-10-16T12:00:00.000Z';
function bootstrap(accountId: string,familyId: string): BootstrapData {
  const profile = { createdAt:timestamp,familyId,id:'baby',name:'Baby Example',timezone:'UTC',updatedAt:timestamp };
  return { accountId,actorProfileId:'parent',cursor:{ after:0,familyId },data:{ events:[],exportedAt:timestamp,profile,profiles:[profile],tasks:[],version:1 },familyId,revisions:{},role:'parent' };
}
function make(accountId = 'a',familyId: string = crypto.randomUUID()) { const client = new InternalClient('/api/v1',accountId,familyId); clients.push(client); return client; }
const json = (body: unknown,status = 200) => new Response(JSON.stringify(body),{ headers:{ 'Content-Type':'application/json' },status });
afterEach(() => { for (const client of clients.splice(0)) client.close(); vi.unstubAllGlobals(); });

describe('internal offline cache and outbox',() => {
  it('flushes queued writes and refreshes a stale local baseline even with no cursor changes',async () => {
    const client = make(); const initial = bootstrap(client.accountId,client.familyId);
    vi.stubGlobal('fetch',vi.fn(async () => json(initial))); await client.bootstrap();
    await client.queue('tasks','queued','save',{ status:'open',title:'Queued task' });
    const latest = bootstrap(client.accountId,client.familyId);
    latest.data.tasks = [{ createdAt:timestamp,id:'remote',status:'open',title:'From another device',updatedAt:timestamp }];
    const calls: string[] = [];
    vi.stubGlobal('fetch',vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.endsWith('/mutations')) {
        const payload = { createdAt:timestamp,id:'queued',status:'open' as const,title:'Queued task',updatedAt:timestamp };
        latest.data.tasks!.push(payload);
        return json({ collection:'tasks',id:'queued',payload,revision:1 });
      }
      return url.includes('/changes?') ? json({ changes:[] }) : json(latest);
    }));
    await client.refresh();
    const state = await client.state();
    expect(state.queue).toEqual([]);
    expect(state.data!.data.tasks!.map(task => task.id)).toEqual(['remote','queued']);
    expect(calls[0]).toMatch(/mutations$/); expect(calls[calls.length-1]).toMatch(/bootstrap$/);
  });
  it('keeps caches separate by deployment, account and family',async () => {
    expect(internalCacheName('/api/v1','account-a','family')).not.toBe(internalCacheName('/api/v1','account-b','family'));
    expect(internalCacheName('/api/v1','a','family-a')).not.toBe(internalCacheName('/api/v1','a','family-b'));
    expect(internalCacheName('https://another.example/api/v1','a','f')).not.toBe(internalCacheName('/api/v1','a','f'));
    const a = make(); vi.stubGlobal('fetch',vi.fn(async () => json(bootstrap(a.accountId,a.familyId)))); await a.bootstrap();
    await a.queue('tasks','task','save',{ status:'open',title:'Offline task' });
    const b = make('b',a.familyId); expect((await b.state()).data).toBeUndefined();
    const state = await a.state(); expect(state.queue).toHaveLength(1); expect(state.data!.data.tasks![0]).toMatchObject({ createdAt:expect.any(String),id:'task',title:'Offline task' });
  });
  it('retains failed writes, normalizes null clearing and binds requests to the original account',async () => {
    const client = make(); const fetcher = vi.fn<(input:RequestInfo | URL,init?:RequestInit) => Promise<Response>>(async () => json(bootstrap(client.accountId,client.familyId))); vi.stubGlobal('fetch',fetcher); await client.bootstrap();
    await client.queue('tasks','task','save',{ dueAt:undefined,id:undefined,status:'open',title:'Offline task' });
    fetcher.mockImplementationOnce(async () => { throw new TypeError('offline'); });
    await expect(client.sync()).rejects.toThrow('offline');
    expect((await client.state()).queue[0].command.patch).toMatchObject({ dueAt:null,id:'task' });
    const options = fetcher.mock.calls[fetcher.mock.calls.length - 1]?.[1] as unknown as RequestInit;
    expect((options.headers as Record<string,string>)['X-Babysteps-Account']).toBe('a');
  });
  it('keeps conflicts for explicit review and refreshes the expected revision only on a retry',async () => {
    const client = make(); vi.stubGlobal('fetch',vi.fn(async () => json(bootstrap(client.accountId,client.familyId)))); await client.bootstrap();
    await client.queue('tasks','task','save',{ status:'open',title:'Offline task' });
    vi.stubGlobal('fetch',vi.fn(async () => json({ error:'conflict' },409)));
    await expect(client.sync()).rejects.toBeInstanceOf(InternalRequestError);
    const before = (await client.state()).queue[0]; expect(before.error).toBe('conflict');
    const latest = bootstrap(client.accountId,client.familyId); latest.revisions['tasks:task'] = 4;
    vi.stubGlobal('fetch',vi.fn(async () => json(latest)));
    await client.retryWithLatest(before.order!);
    const after = (await client.state()).queue[0]; expect(after.command.expectedRevision).toBe(4); expect(after.command.operationId).not.toBe(before.command.operationId);
  });
  it('refuses a bootstrap from another signed-in account',async () => {
    const client = make(); vi.stubGlobal('fetch',vi.fn(async () => json(bootstrap('another',client.familyId))));
    await expect(client.bootstrap()).rejects.toThrow('Account or family changed'); expect((await client.state()).data).toBeUndefined();
  });
});
