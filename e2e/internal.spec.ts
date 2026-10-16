import { test, expect, type Page } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createSocket } from 'node:net';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

let api: ChildProcess; let web: ViteDevServer; let directory: string; let origin: string;
async function port() { const socket = createSocket(); await new Promise<void>((resolve) => socket.listen(0,'127.0.0.1',resolve)); const value = (socket.address() as { port:number }).port; await new Promise<void>((resolve) => socket.close(() => resolve())); return value; }
test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(),'babysteps-e2e-'));
  const key = join(directory,'key.pem'); const cert = join(directory,'cert.pem');
  const generated = spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost'],{ stdio:'ignore' });
  if (generated.status) throw new Error('Could not generate ephemeral localhost certificate');
  const apiPort = await port(); const webPort = await port(); origin = `https://localhost:${webPort}`;
  api = spawn(process.execPath,['dist-internal/internal-api.mjs'],{ env:{ ...process.env,BABYSTEPS_DATABASE_PATH:join(directory,'test.sqlite'),BABYSTEPS_ORIGIN:origin,BABYSTEPS_REGISTRATION_OPEN:'true',BABYSTEPS_RP_ID:'localhost',HOST:'127.0.0.1',PORT:String(apiPort) },stdio:['ignore','pipe','pipe'] });
  let log = ''; api.stderr!.on('data',(value) => { log += String(value); });
  for (let i=0;i<100;i++) { try { if ((await fetch(`http://127.0.0.1:${apiPort}/api/v1/health`)).ok) break; } catch { /* booting */ }
    if (api.exitCode !== null) throw new Error(log); await new Promise((resolve) => setTimeout(resolve,100)); }
  web = await createServer({ configFile:false,define:{ 'import.meta.env.VITE_INTERNAL_API':JSON.stringify('/api/v1') },plugins:[react()],server:{ host:'127.0.0.1',https:{ key:readFileSync(key),cert:readFileSync(cert) },port:webPort,strictPort:true,
    proxy:{ '/api/v1':`http://127.0.0.1:${apiPort}` } } });
  await web.listen();
});
test.afterAll(async () => { await web?.close(); api?.kill('SIGTERM'); if (api && api.exitCode === null) await new Promise((resolve) => api.once('exit',resolve)); if (directory) rmSync(directory,{ force:true,recursive:true }); });
async function authenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page); await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator',{ options:{ protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true } });
}
async function request(page: Page,path: string,body?: unknown) {
  return page.evaluate(async ({ path,body }) => {
    const csrf = document.cookie.split(';').map((v) => v.trim()).find((v) => v.startsWith('__Host-babysteps-csrf='))?.slice('__Host-babysteps-csrf='.length);
    const response = await fetch(`/api/v1${path}`,{ body:body === undefined ? undefined : JSON.stringify(body),headers:body === undefined ? {} : { 'Content-Type':'application/json','X-Babysteps-CSRF':csrf ?? '' },method:body === undefined ? 'GET':'POST' });
    return { body:await response.json(),status:response.status };
  },{ body,path });
}
test('real passkey account, family, offline queue, caregiver boundary and recovery',async ({ page,browser }) => {
  await authenticator(page); await page.goto(origin);
  await page.getByRole('button',{ name:'Create a BabySteps account',exact:true }).click();
  await expect(page.getByRole('heading',{ name:'Keep your recovery codes' })).toBeVisible();
  const recovery = (await page.getByLabel('Recovery codes').inputValue()).split('\n');
  await page.getByRole('button',{ name:'I saved them',exact:true }).click();
  await page.getByLabel('Your name',{ exact:true }).fill('Alex Example'); await page.getByLabel('Baby’s name (optional)').fill('Baby Example');
  await page.getByRole('button',{ name:'Start a family',exact:true }).click();
  await expect(page.getByRole('navigation',{ name:'Primary' })).toBeVisible();
  await page.getByRole('button',{ name:'Alex',exact:true }).click();
  await page.getByRole('navigation',{ name:'Primary' }).getByRole('button',{ name:'To-do',exact:true }).click();
  await page.context().setOffline(true);
  await page.getByPlaceholder('What needs doing?').fill('Offline task');
  await page.getByRole('button',{ name:'Add',exact:true }).click();
  await expect(page.getByRole('heading',{ name:'Queued changes (1)' })).toBeVisible();
  await page.context().setOffline(false); await page.getByRole('button',{ name:'Sync now',exact:true }).click();
  await expect(page.getByRole('heading',{ name:'Queued changes (1)' })).not.toBeVisible();
  const session = await request(page,'/session'); expect(session.status).toBe(200);
  const familyId = session.body.families[0].familyId;
  const boot = await request(page,`/families/${familyId}/bootstrap`); expect(boot.status).toBe(200);
  const child = boot.body.data.profiles.find((p: { kind:string }) => p.kind === 'child');
  const now = new Date().toISOString();
  const event = { action:'save',collection:'events',expectedRevision:0,id:'feed-e2e',operationId:'feed-e2e',patch:{ babyId:child.id,method:'bottle',amountOz:3,startedAt:now,type:'feed' } };
  expect((await request(page,`/families/${familyId}/mutations`,event)).status).toBe(200);
  expect((await request(page,`/families/${familyId}/mutations`,event)).status).toBe(200);
  expect((await request(page,`/families/${familyId}/mutations`,{ ...event,operationId:'stale' })).status).toBe(409);
  const caregiver = { action:'save',collection:'profiles',expectedRevision:0,id:'sitter',operationId:'sitter',patch:{ kind:'caregiver',name:'Sitter Example',timezone:'America/Los_Angeles' } };
  expect((await request(page,`/families/${familyId}/mutations`,caregiver)).status).toBe(200);
  const invited = await request(page,`/families/${familyId}/invitations`,{ profileId:'sitter' }); expect(invited.status).toBe(200);
  const context = await browser.newContext({ ignoreHTTPSErrors:true }); const sitter = await context.newPage(); await authenticator(sitter); await sitter.goto(origin);
  await sitter.getByRole('button',{ name:'Create a BabySteps account',exact:true }).click(); await expect(sitter.getByLabel('Recovery codes')).toBeVisible();
  expect((await request(sitter,'/invitations/accept',{ token:invited.body.token })).status).toBe(200);
  expect((await request(sitter,'/invitations/accept',{ token:invited.body.token })).status).toBe(404);
  const limited = await request(sitter,`/families/${familyId}/bootstrap`); expect(limited.body.role).toBe('caregiver');
  expect(limited.body.data.profiles.every((p: { kind:string }) => p.kind === 'child')).toBe(true); expect(limited.body.data.tasks).toEqual([]);
  expect((await request(sitter,`/families/${familyId}/changes`)).status).toBe(403);
  expect((await request(sitter,`/families/${familyId}/mutations`,{ ...event,id:'sitter-feed',operationId:'sitter-feed',patch:{ ...event.patch,caregiverId:'forged-parent' } })).status).toBe(200);
  const updated = await request(page,`/families/${familyId}/bootstrap`);
  expect(updated.body.data.events.find((e: { id:string }) => e.id === 'sitter-feed').caregiverId).toBe('sitter');
  expect((await request(sitter,`/families/${familyId}/mutations`,{ ...event,id:'sitter-birth',operationId:'sitter-birth',patch:{ ...event.patch,type:'birth' } })).status).toBe(403);
  await context.close();
  await page.reload(); await expect(page.getByRole('navigation',{ name:'Primary' })).toBeVisible();
  await page.getByRole('navigation',{ name:'Primary' }).getByRole('button',{ name:'Account',exact:true }).click();
  await page.getByRole('button',{ name:'Sign out',exact:true }).click();
  await page.getByRole('button',{ name:'Sign in with a passkey',exact:true }).click(); await expect(page.getByRole('navigation',{ name:'Primary' })).toBeVisible();
  await request(page,'/auth/logout',{}); await page.reload();
  await page.getByRole('button',{ name:'Use a recovery code',exact:true }).click(); await page.getByLabel('Account ID',{ exact:true }).fill(recovery[0]);
  await page.getByLabel('Recovery code',{ exact:true }).fill(recovery[1]); await page.getByRole('button',{ name:'Recover account',exact:true }).click();
  await expect(page.getByRole('navigation',{ name:'Primary' })).toBeVisible();
  expect((await request(page,'/auth/recover',{ accountId:recovery[0],code:recovery[1] })).status).toBe(401);
  const backup = join(directory,'backup.sqlite');
  const backedUp = spawnSync(process.execPath,['dist-internal/internal-tool.mjs','backup','--database',join(directory,'test.sqlite'),'--destination',backup],{ encoding:'utf8' });
  expect(backedUp.status,backedUp.stderr).toBe(0);
  const checked = spawnSync(process.execPath,['dist-internal/internal-tool.mjs','restore-check','--database',backup],{ encoding:'utf8' });
  expect(checked.status,checked.stderr).toBe(0); expect(JSON.parse(checked.stdout).integrity).toBe('ok');
  const restored = join(directory,'restored-family.json');
  const exported = spawnSync(process.execPath,['dist-internal/internal-tool.mjs','export','--database',backup,'--family',familyId,'--account',recovery[0],'--destination',restored],{ encoding:'utf8' });
  expect(exported.status,exported.stderr).toBe(0);
  expect(JSON.parse(readFileSync(restored,'utf8')).tracker.events).toHaveLength(2);
  await page.screenshot({ path:'test-results/internal-account.png',fullPage:true });
  await page.setViewportSize({ width:390,height:844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path:'test-results/internal-mobile.png',fullPage:true });

});
