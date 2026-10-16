import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const tabs=new Map();
class Sheet {
  rows=[];
  getLastRow(){ return this.rows.length; }
  setFrozenRows(){}
  getRange(row,col,height,width){ return {
    getValues:()=>Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>this.rows[row+r-1]?.[col+c-1]??'')),
    setValues:values=>values.forEach((v,r)=>{ this.rows[row+r-1]??=[]; v.forEach((x,c)=>this.rows[row+r-1][col+c-1]=x); })
  }; }
}
const token='test-only-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const sandbox={
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='NURSERY_TOKEN'?token:'fixture-sheet'})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,hasLock:()=>true,releaseLock(){}})},
  SpreadsheetApp:{openById:()=>({getSheetByName:name=>tabs.get(name),insertSheet:name=>{ const s=new Sheet();tabs.set(name,s);return s; }}),flush(){}},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})}
};
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('./Code.js',import.meta.url),'utf8'),sandbox);
const interval={key:'device-a:1000:1:interval:1791846000000',schemaVersion:2,kind:'interval',data:{sourceDeviceId:'device-a',sessionId:1,startUtc:'2026-10-12T03:00:00Z',endUtc:'2026-10-12T03:15:00Z',durationMs:900000,validMs:885000,coveragePercent:98.333,soundLevelDbfs:-40,peakDbfs:-12,clippedWindows:0}};
const record=interval;
const night={key:'device-a:night:2026-10-12',schemaVersion:2,kind:'night',data:{sourceDeviceId:'device-a',nightOf:'2026-10-12',timezone:'America/Los_Angeles',windowStartUtc:'2026-10-12T19:00:00Z',windowEndUtc:'2026-10-13T19:00:00Z',status:'in_progress',observedThroughUtc:'2026-10-13T05:00:00Z',expectedMs:36000000,capturedMs:35000000,validMs:35000000,coveragePercent:97.2,sessions:1,soundLevelDbfs:-55,peakDbfs:-8,cryEpisodes:3,cryMs:240000,longestCryMs:120000,speechEpisodes:1,speechMs:4000,snoringEpisodes:0,snoringMs:0,coughEpisodes:0,ambientNoiseMs:0}};
const episode={key:'device-a:1000:1:episode:7',schemaVersion:2,kind:'episode',data:{sourceDeviceId:'device-a',sessionId:1,episodeId:7,label:'baby_cry',startUtc:'2026-10-12T03:02:00Z',endUtc:'2026-10-12T03:04:00Z',durationMs:120000,maxScore:.8,source:'model_experimental'}};
function send(records=[record],suppliedToken=token,schemaVersion=2){return JSON.parse(sandbox.doPost({postData:{contents:JSON.stringify({schemaVersion,deviceId:'device-a',token:suppliedToken,records})}}).text);}
assert.equal(send([], 'wrong').ok,false); assert.equal(tabs.size,0);
assert.equal(send().ok,true); assert.equal(send().ok,true);
assert.equal(tabs.get('Nursery Sound Levels').rows.length,2,'Retry must upsert, not duplicate');
const changed=structuredClone(record);changed.data.peakDbfs=-10;
assert.equal(send([changed]).ok,true);assert.equal(tabs.get('Nursery Sound Levels').rows.length,2);
assert.equal(tabs.get('Nursery Sound Levels').rows[1][10],-10);
// A hand-made, header-only tab adopts the receiver's header instead of failing forever.
const handMade=new Sheet();handMade.rows=[['Night','Notes']];tabs.set('Nursery Nightly Summaries',handMade);
const later=structuredClone(record);later.key='device-a:1000:1:interval:1791846900000';
assert.equal(send([night,episode,later]).ok,true);
assert.equal(handMade.rows[0][0],'recordKey');assert.equal(handMade.rows.length,2);
assert.equal(tabs.get('Nursery Sound Levels').rows.length,3,'Batched appends land after existing rows');
const finished=structuredClone(night);finished.data.status='complete';assert.equal(send([finished]).ok,true);
assert.equal(handMade.rows.length,2,'Nightly summary upserts by night');
assert.equal(send([record],token,1).ok,false,'Schema 1 per-minute batches are no longer accepted');
const minute=structuredClone(record);minute.kind='minute';assert.equal(send([minute]).ok,false);
const ambient=structuredClone(episode);ambient.data.label='ambient_noise';assert.equal(send([ambient]).ok,false);
const badNight=structuredClone(night);badNight.data.nightOf='tonight';assert.equal(send([badNight]).ok,false);
const audio=structuredClone(record);audio.data.pcm=[1,2];assert.equal(send([audio]).ok,false);
const wrongDevice=structuredClone(record);wrongDevice.data.sourceDeviceId='someone-else';assert.equal(send([wrongDevice]).ok,false);
assert.equal(send([record,record]).ok,false);
const session={key:'device-a:1000:1:session',schemaVersion:2,kind:'session',data:Object.fromEntries(['sourceDeviceId','sessionId','startUtc','endUtc','status','elapsedMs','validMs','coveragePercent','capturedMs','silencedMs','observedThroughUtc','soundLevelDbfs','peakDbfs','error','model','modelSha256','modelError','modelStatus','predictions','droppedWindows','meanInferenceMs','maxInferenceMs','appVersion','timezone','sleepState','movementState'].map(k=>[k,null]))};
Object.assign(session.data,{sourceDeviceId:'device-a',sessionId:1,startUtc:'2026-10-12T03:00:00Z',status:'recording',sleepState:'unknown',movementState:'not_measured'});
assert.equal(send([session]).ok,true);
const fakeSleep=structuredClone(session);fakeSleep.data.sleepState='asleep';assert.equal(send([fakeSleep]).ok,false);
const textNumber=structuredClone(record);textNumber.data.durationMs='60000';assert.equal(send([textNumber]).ok,false);
const negative=structuredClone(record);negative.data.validMs=-1;assert.equal(send([negative]).ok,false);
const badCoverage=structuredClone(record);badCoverage.data.coveragePercent=101;assert.equal(send([badCoverage]).ok,false);
assert.equal(sandbox.nurseryCell('=IMPORTDATA("private")'),'\'=IMPORTDATA("private")');
assert.equal(sandbox.nurseryCell(-40),-40);
console.log('Receiver tests passed: authentication, idempotence/upsert, batched appends, header-only tabs, nightly/interval/episode/session kinds, field/device validation, no audio/sleep fabrication, formula escaping.');
