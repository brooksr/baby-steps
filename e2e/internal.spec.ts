import { createHash } from 'node:crypto';
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
  api = spawn(process.execPath,['dist-internal/internal-api.mjs'],{ env:{ ...process.env,BABYSTEPS_DATABASE_PATH:join(directory,'test.sqlite'),BABYSTEPS_ORIGIN:origin,BABYSTEPS_BOOTSTRAP_TOKEN_HASH:createHash('sha256').update('test-only-setup').digest('hex'),BABYSTEPS_REGISTRATION_OPEN:'false',BABYSTEPS_RP_ID:'localhost',HOST:'127.0.0.1',PORT:String(apiPort) },stdio:['ignore','pipe','pipe'] });
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
  await expect(page.getByRole('button',{ name:'Create a BabySteps account',exact:true })).toBeDisabled();
  await page.evaluate(() => { window.location.hash = 'setup=test-only-setup'; });
  await expect(page.getByRole('button',{ name:'Create a BabySteps account',exact:true })).toBeEnabled();
  await page.getByRole('button',{ name:'Create a BabySteps account',exact:true }).click();
  await expect(page.getByRole('heading',{ name:'Keep your recovery codes' })).toBeVisible();
  const recovery = (await page.getByLabel('Recovery codes').inputValue()).split('\n');
  expect((await request(page,'/config')).body.registrationOpen).toBe(false);
  expect(await page.evaluate(async () => (await fetch('/api/v1/auth/register/options',{ method:'POST',credentials:'omit',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ setupToken:'test-only-setup' }) })).status)).toBe(403);
  await page.getByRole('button',{ name:'I saved them',exact:true }).click();
  await page.getByLabel('Your name',{ exact:true }).fill('Alex Example'); await page.getByLabel('Baby’s name (optional)').fill('Baby Example');
  await page.getByRole('button',{ name:'Start a family',exact:true }).click();
  await expect(page.getByRole('navigation',{ name:'Primary' })).toBeVisible();
  await page.getByRole('button',{ name:'Alex',exact:true }).click();
  await page.getByRole('navigation',{ name:'Primary' }).getByRole('button',{ name:'To-do',exact:true }).click();
  await page.context().setOffline(true);
  await page.getByPlaceholder('What needs doing?').fill('Offline task');
  await page.getByRole('button',{ name:'Add',exact:true }).click();
  await expect(page.getByText('Offline task')).toBeVisible();
  await expect(page.getByRole('heading',{ name:/Queued changes|Changes need review/ })).toHaveCount(0);
  await page.context().setOffline(false); await page.getByRole('button',{ name:'Sync now',exact:true }).click();
  const session = await request(page,'/session'); expect(session.status).toBe(200);
  const familyId = session.body.families[0].familyId;
  const boot = await request(page,`/families/${familyId}/bootstrap`); expect(boot.status).toBe(200);
  // The queued task reaches the server once Sync now finishes.
  await expect.poll(async () => JSON.stringify((await request(page,`/families/${familyId}/bootstrap`)).body.data.tasks)).toContain('Offline task');
  const child = boot.body.data.profiles.find((p: { kind:string }) => p.kind === 'child');
  const now = new Date().toISOString();
  const event = { action:'save',collection:'events',expectedRevision:0,id:'feed-e2e',operationId:'feed-e2e',patch:{ babyId:child.id,method:'bottle',amountOz:3,startedAt:now,type:'feed' } };
  expect((await request(page,`/families/${familyId}/mutations`,event)).status).toBe(200);
  expect((await request(page,`/families/${familyId}/mutations`,event)).status).toBe(200);
  expect((await request(page,`/families/${familyId}/mutations`,{ ...event,operationId:'stale' })).status).toBe(409);
  const caregiver = { action:'save',collection:'profiles',expectedRevision:0,id:'sitter',operationId:'sitter',patch:{ kind:'caregiver',name:'Sitter Example',timezone:'America/Los_Angeles' } };
  expect((await request(page,`/families/${familyId}/mutations`,caregiver)).status).toBe(200);
  const invited = await request(page,`/families/${familyId}/invitations`,{ profileId:'sitter' }); expect(invited.status).toBe(200);
  const context = await browser.newContext({ ignoreHTTPSErrors:true }); const sitter = await context.newPage(); await authenticator(sitter); await sitter.goto(`${origin}/#invite=${invited.body.token}`);
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
  for (const type of ['diaper','bath']) {
    expect((await request(page,`/families/${familyId}/mutations`,{
      action:'save',collection:'events',expectedRevision:0,id:`hero-${type}`,operationId:`hero-${type}`,
      patch:{ babyId:child.id,startedAt:now,type,...(type === 'diaper' ? { kind:'wet' } : {}) }
    })).status).toBe(200);
  }
  await page.reload();
  for (const type of ['feed','diaper','bath']) {
    await page.getByRole('button',{ name:`View ${type} log`,exact:true }).click();
    await expect(page.getByLabel('Filter by type')).toHaveValue(`type:${type}`);
    const types = await page.locator('.timeline-icon').evaluateAll(icons => icons.map(icon => icon.getAttribute('data-event')));
    expect(types.length).toBeGreaterThan(0); expect(types.every(value => value === type)).toBe(true);
    await page.getByRole('navigation',{ name:'Primary' }).getByRole('button',{ name:'Home',exact:true }).click();
  }
  await page.getByRole('navigation',{ name:'Primary' }).getByRole('button',{ name:'Log',exact:true }).click();
  await expect(page.getByLabel('Filter by type')).toHaveValue('all');
  await expect(page.locator('.timeline-item')).toHaveCount(4);
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
  expect(JSON.parse(readFileSync(restored,'utf8')).tracker.events).toHaveLength(4);
  await page.screenshot({ path:'test-results/internal-account.png',fullPage:true });
  await page.setViewportSize({ width:390,height:844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path:'test-results/internal-mobile.png',fullPage:true });
  for (let index=1;index<=5;index++) {
    const id = `alignment-diaper-${index}`;
    expect((await request(page,`/families/${familyId}/mutations`,{ action:'save',collection:'events',expectedRevision:0,id,operationId:id,patch:{ babyId:child.id,kind:'wet',startedAt:new Date(Date.parse(now)-index*3*3600_000).toISOString(),type:'diaper' } })).status).toBe(200);
  }
  // Production has more profiles, longer contact details and classic scrollbars.
  for (const [id,kind,name] of [['extra-parent','parent','Alexandria Example'],['extra-child','child','Christopher Example']]) {
    expect((await request(page,`/families/${familyId}/mutations`,{ action:'save',collection:'profiles',expectedRevision:0,id,operationId:id,patch:{ kind,name,email:'long-family-contact@example.com',phone:'(000) 000-0000',timezone:'America/Los_Angeles' } })).status).toBe(200);
  }
  await page.getByRole('button',{ name:'Sync now',exact:true }).click();
  await page.addStyleTag({ content:'html { scrollbar-gutter: stable; }' });
  for (const width of [320,390,500,768,1280]) {
    await page.setViewportSize({ width,height:844 });
    await page.getByRole('navigation',{ name:'Primary' }).getByRole('button',{ name:'Account',exact:true }).click();
    await expect(page.getByRole('heading',{ name:'Sign-in methods',exact:true })).toBeVisible();
    await expect(page.getByText('Loading sign-in methods…')).toBeHidden();
    await expect(page.getByText(`Account ID: ${recovery[0]}`,{ exact:true })).toBeHidden();
    await expect(page.getByRole('button',{ name:'Replace recovery codes',exact:true })).toBeHidden();
    await expect(page.getByLabel('Connection code',{ exact:true })).toBeVisible();
    await expect(page.getByRole('heading',{ name:'Data & backups',exact:true })).toBeVisible();
    await expect(page.getByRole('link',{ name:'Privacy Policy',exact:true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (width===390) await page.screenshot({ path:'test-results/mobile-account-organized.png',fullPage:true });
    await page.getByRole('navigation',{ name:'Primary' }).getByRole('button',{ name:'Settings',exact:true }).click();
    await expect(page.getByRole('button',{ name:'Learn',exact:true })).toBeVisible();
    await expect(page.getByRole('heading',{ name:'Data & backups',exact:true })).toHaveCount(0);
    // Invite and archive stay on the name's row at every width.
    expect(await page.locator('.settings-page .child-list li').evaluateAll(rows => rows.every(row => {
      const tops = [...row.children].map(child => Math.round(child.getBoundingClientRect().top));
      return tops.every(top => top === tops[0]);
    }))).toBe(true);
    const chrome = await page.locator('.app-header').evaluate(header => {
      const sync = header.querySelector('.header-sync')!.getBoundingClientRect();
      const brand = header.querySelector('.app-brand')!.getBoundingClientRect();
      return { right:sync.right,top:sync.top,brandTop:brand.top,width:document.documentElement.clientWidth };
    });
    expect(chrome.right).toBeLessThanOrEqual(chrome.width);
    expect(Math.abs(chrome.top-chrome.brandTop)).toBeLessThanOrEqual(2);
    await expect(page.getByRole('button',{ name:'Sign out',exact:true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (width===390) await page.screenshot({ path:'test-results/mobile-settings-organized.png',fullPage:true });
  }
  // Exercise mobile Home/Log/Reports with real growth and Night & Day content.
  const birthAt = new Date(Date.now()-90*86400_000).toISOString();
  const beforeGrowth = await request(page,`/families/${familyId}/bootstrap`);
  expect((await request(page,`/families/${familyId}/mutations`,{ action:'save',collection:'profiles',id:child.id,expectedRevision:beforeGrowth.body.revisions[`profiles:${child.id}`],operationId:'mobile-profile',patch:{ dueDate:new Date(Date.parse(birthAt)+28*86400_000).toISOString().slice(0,10),gender:'girl' } })).status).toBe(200);
  for (const [id,type,startedAt,weightOz] of [['mobile-birth','birth',birthAt,116],['mobile-growth','growth',now,220]]) {
    expect((await request(page,`/families/${familyId}/mutations`,{ action:'save',collection:'events',expectedRevision:0,id,operationId:id,patch:{ babyId:child.id,startedAt,type,weightOz,lengthIn:24,headCircumferenceIn:15 } })).status).toBe(200);
  }
  const lastNight = new Date(now); lastNight.setDate(lastNight.getDate()-1); lastNight.setHours(22,0,0,0);
  for (const [index,hours] of [0,4].entries()) {
    expect((await request(page,`/families/${familyId}/mutations`,{ action:'save',collection:'events',expectedRevision:0,id:`night-feed-${index}`,operationId:`night-feed-${index}`,patch:{ babyId:child.id,startedAt:new Date(lastNight.getTime()+hours*3600_000).toISOString(),type:'feed',method:'bottle',amountOz:3 } })).status).toBe(200);
  }
  expect((await request(page,`/families/${familyId}/mutations`,{ action:'save',collection:'events',expectedRevision:0,id:'night-sleep',operationId:'night-sleep',patch:{ babyId:child.id,startedAt:new Date(lastNight.getTime()-3600_000).toISOString(),endedAt:lastNight.toISOString(),type:'sleep' } })).status).toBe(200);
  await page.reload();
  const nav = page.getByRole('navigation',{ name:'Primary' });
  await nav.getByRole('button',{ name:'Home',exact:true }).click();
  await page.locator('.app-brand img').waitFor();
  await expect(page.getByRole('button',{ name:'Sync now',exact:true })).toBeVisible();
  await page.screenshot({ path:'test-results/mobile-home.png',fullPage:false });
  await expect(page.locator('.expect-facet')).toHaveCount(4);
  await expect(page.locator('.expect-basis')).toBeHidden();
  await expect(page.locator('.expect-footnote')).toBeHidden();
  await expect(page.locator('.expect-facts')).toBeHidden();
  await page.locator('.expect-card').screenshot({ path:'test-results/mobile-expect.png',style:'.bottom-nav { visibility: hidden; }' });
  for (const width of [320,390,500,768,1280]) {
    await page.setViewportSize({ width,height:844 });
    await nav.getByRole('button',{ name:'Home',exact:true }).click();
    const alignment = await page.locator('.care-hero-metrics').evaluate(grid => {
      const cards = [...grid.querySelectorAll('.hero-metric')];
      return { dividers:cards.map(card => card.querySelector('.hero-metric-detail')!.getBoundingClientRect().top),
        edges:cards.map(card => card.getBoundingClientRect().right),right:grid.getBoundingClientRect().right,
        heroRight:grid.closest('.profile-band')!.getBoundingClientRect().right,
        headerRight:document.querySelector('.app-header')!.getBoundingClientRect().right };
    });
    expect(Math.max(...alignment.dividers)-Math.min(...alignment.dividers)).toBeLessThanOrEqual(1);
    expect(Math.max(...alignment.edges)).toBeLessThanOrEqual(alignment.right+1);
    expect(Math.abs(alignment.heroRight-alignment.headerRight)).toBeLessThanOrEqual(1);
    if (width===390) {
      await page.evaluate(() => window.scrollTo(0,0));
      await page.screenshot({ path:'test-results/mobile-aligned-home.png',fullPage:false });
    }
    await nav.getByRole('button',{ name:'Log',exact:true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (width===390) await page.screenshot({ path:'test-results/mobile-log.png',fullPage:true });
    await nav.getByRole('button',{ name:'Reports',exact:true }).click();
    await expect(page.locator('.growth-chart').first()).toBeVisible();
    await expect(page.locator('.growth-percentile')).toHaveCount(3);
    await expect(page.locator('.growth-percentile').first()).toBeVisible();
    expect(await page.locator('.growth-age-options').evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (width===390) {
      const grid = await page.locator('.growth-charts').boundingBox();
      const chart = await page.locator('.growth-charts .chart-card').first().boundingBox();
      expect(chart!.width).toBeGreaterThanOrEqual(grid!.width-2);
      await page.locator('.growth-overview').screenshot({ path:'test-results/mobile-growth-overview.png',style:'.bottom-nav { visibility: hidden; }' });
      await page.locator('.growth-charts').screenshot({ path:'test-results/mobile-growth-charts.png',style:'.bottom-nav { visibility: hidden; }' });
      await page.locator('.night-report').screenshot({ path:'test-results/mobile-night.png',style:'.bottom-nav { visibility: hidden; }' });
    }
  }


});
