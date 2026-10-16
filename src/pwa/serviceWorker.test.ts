// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

it('leaves authenticated API reads and other origins to the network',() => {
  const handlers = new Map<string,(event: unknown) => void>();
  vm.runInNewContext(readFileSync('public/sw.js','utf8'),{ URL,self:{ addEventListener:(name: string,handler: (event: unknown) => void) => handlers.set(name,handler),location:{ origin:'https://example.test' },registration:{ scope:'https://example.test/' } } });
  for (const url of ['https://example.test/api/v1/session','https://example.test/api/v1/families/f/bootstrap','https://example.test/api/nursery','https://another.test/data']) {
    const respondWith = vi.fn(); handlers.get('fetch')!({ request:{ method:'GET',url },respondWith }); expect(respondWith).not.toHaveBeenCalled();
  }
});
it('purges obsolete app caches without clearing a staged install or another app',async () => {
  const handlers = new Map<string,(event: unknown) => void>();
  const remove = vi.fn<(key:string) => Promise<boolean>>(async () => true); let completion: Promise<void> | undefined;
  vm.runInNewContext(readFileSync('public/sw.js','utf8'),{ URL,caches:{ delete:remove,keys:async () => ['babysteps-v3','babysteps:/:v3','babysteps:/:v4','babysteps:/internal/:v4','another-app'] },
    self:{ addEventListener:(name: string,handler: (event: unknown) => void) => handlers.set(name,handler),clients:{ claim:async () => {} },registration:{ scope:'https://example.test/' } } });
  handlers.get('activate')!({ waitUntil:(value: Promise<void>) => { completion = value; } }); await completion;
  expect(remove.mock.calls.map((call) => call[0])).toEqual(['babysteps-v3','babysteps:/:v3']);
});
