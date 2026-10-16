/* Deploy yourself after reading docs/CONTINUOUS_MONITORING.md. No Google credentials
 * belong in the Android APK. Script Properties: SHEET_ID and NURSERY_TOKEN.
 * This receiver writes only dedicated machine-readable nursery tabs, never Events.
 * Per-second measurements and model frames stay on the phone; the sheet holds what
 * review and reports need (~100 rows/day), keeping the shared Babysteps sheet small.
 */
const NURSERY_SCHEMA_VERSION = 2;
const NURSERY_SCHEMAS = {
  night: { tab: 'Nursery Nightly Summaries', columns: ['sourceDeviceId','nightOf','timezone','windowStartUtc','windowEndUtc','status','observedThroughUtc','expectedMs','capturedMs','validMs','coveragePercent','sessions','soundLevelDbfs','peakDbfs','cryEpisodes','cryMs','longestCryMs','speechEpisodes','speechMs','snoringEpisodes','snoringMs','coughEpisodes','ambientNoiseMs'] },
  episode: { tab: 'Nursery Sound Episodes', columns: ['sourceDeviceId','sessionId','episodeId','label','startUtc','endUtc','durationMs','maxScore','source'] },
  interval: { tab: 'Nursery Sound Levels', columns: ['sourceDeviceId','sessionId','startUtc','endUtc','durationMs','validMs','coveragePercent','soundLevelDbfs','peakDbfs','clippedWindows'] },
  session: { tab: 'Nursery Sessions', columns: ['sourceDeviceId','sessionId','startUtc','endUtc','status','elapsedMs','validMs','coveragePercent','capturedMs','silencedMs','observedThroughUtc','soundLevelDbfs','peakDbfs','error','model','modelSha256','modelError','modelStatus','predictions','droppedWindows','meanInferenceMs','maxInferenceMs','appVersion','timezone','sleepState','movementState'] }
};
const NURSERY_TIMESTAMPS = ['startUtc','endUtc','windowStartUtc','windowEndUtc','observedThroughUtc'];
const NURSERY_NUMERIC = ['sessionId','episodeId','durationMs','capturedMs','validMs','silencedMs','coveragePercent','soundLevelDbfs','peakDbfs','clippedWindows','maxScore','elapsedMs','predictions','droppedWindows','meanInferenceMs','maxInferenceMs','expectedMs','sessions','cryEpisodes','cryMs','longestCryMs','speechEpisodes','speechMs','snoringEpisodes','snoringMs','coughEpisodes','ambientNoiseMs'];
const NURSERY_NON_NEGATIVE = NURSERY_NUMERIC.filter(k=>!['soundLevelDbfs','peakDbfs'].includes(k));

function nurseryEqualToken(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || b.length < 32) return false;
  let difference=0;
  for(let i=0;i<a.length;i++) difference |= a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}
function nurseryValidate(body) {
  if(body.schemaVersion!==NURSERY_SCHEMA_VERSION || !/^[a-zA-Z0-9-]{1,80}$/.test(body.deviceId) || !Array.isArray(body.records) || body.records.length<1 || body.records.length>100) throw Error('Invalid batch');
  const keys=new Set();
  body.records.forEach(record=>{
    const schema=NURSERY_SCHEMAS[record.kind];
    if(!schema || record.schemaVersion!==NURSERY_SCHEMA_VERSION || !record.data || typeof record.data!=='object' || Array.isArray(record.data) || !/^[a-zA-Z0-9:._-]{1,250}$/.test(record.key) || keys.has(record.key)) throw Error('Invalid record');
    keys.add(record.key);
    const data=record.data;
    if(data.sourceDeviceId!==body.deviceId || !record.key.startsWith(body.deviceId+':')) throw Error('Device mismatch');
    if(Object.keys(data).some(k=>!schema.columns.includes(k))) throw Error('Unexpected data field');
    schema.columns.forEach(k=>{
      if(!(k in data)) throw Error('Missing column');
      const v=data[k];
      if(v!==null && !['string','number'].includes(typeof v)) throw Error('Invalid value');
      if(typeof v==='number' && !Number.isFinite(v)) throw Error('Non-finite value');
      if(typeof v==='string' && v.length>256) throw Error('Oversized value');
    });
    NURSERY_TIMESTAMPS.forEach(k=>{ if(k in data && data[k]!==null && !Number.isFinite(Date.parse(data[k]))) throw Error('Invalid timestamp'); });
    NURSERY_NUMERIC.forEach(k=>{ if(k in data && data[k]!==null && typeof data[k]!=='number') throw Error('Expected numeric cell'); });
    NURSERY_NON_NEGATIVE.forEach(k=>{ if(k in data && data[k]!==null && data[k]<0) throw Error('Negative duration/count'); });
    if('coveragePercent' in data && (data.coveragePercent<0 || data.coveragePercent>100)) throw Error('Invalid coverage');
    for(const k of ['soundLevelDbfs','peakDbfs']) if(k in data && data[k]!==null && (data[k]<-120 || data[k]>0)) throw Error('Invalid level');
    if('sessionId' in data && (!Number.isSafeInteger(data.sessionId) || data.sessionId<1)) throw Error('Invalid session');
    if('sleepState' in data && data.sleepState!=='unknown') throw Error('Unsupported sleep inference');
    if('movementState' in data && data.movementState!=='not_measured') throw Error('Unsupported movement inference');
    if(record.kind==='episode' && (!['baby_cry','speech','snoring','cough'].includes(data.label) || data.source!=='model_experimental' || data.maxScore>1)) throw Error('Invalid episode');
    if(record.kind==='interval' && data.durationMs>15*60000) throw Error('Invalid interval');
    if(record.kind==='night' && (!/^\d{4}-\d{2}-\d{2}$/.test(data.nightOf) || !['in_progress','complete'].includes(data.status) || data.expectedMs>25*3600000)) throw Error('Invalid night');
  });
  return body;
}
function nurseryCell(value) {
  if(value===null) return '';
  // setValues must not interpret an untrusted string as a spreadsheet formula.
  return typeof value==='string' && /^[=+@-]/.test(value) ? "'"+value : value;
}
function nurseryReply(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function nurseryDestination(spreadsheet,schema) {
  const sheet=spreadsheet.getSheetByName(schema.tab) || spreadsheet.insertSheet(schema.tab);
  const headers=['recordKey','schemaVersion',...schema.columns];
  // An empty or header-only tab (e.g. created by hand) adopts the current header.
  if(sheet.getLastRow()<=1) {
    sheet.getRange(1,1,1,headers.length).setValues([headers]); sheet.setFrozenRows(1);
  } else if(JSON.stringify(sheet.getRange(1,1,1,headers.length).getValues()[0])!==JSON.stringify(headers)) throw Error('Schema mismatch');
  const rows=new Map();
  if(sheet.getLastRow()>1) sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues().forEach((r,i)=>rows.set(r[0],i+2));
  return {sheet,rows,appends:[]};
}
function doPost(event) {
  let lock;
  try {
    const text=event && event.postData && event.postData.contents;
    if(typeof text!=='string' || text.length>180000) return nurseryReply({ok:false,error:'Invalid request'});
    const body=JSON.parse(text);
    const properties=PropertiesService.getScriptProperties();
    if(!nurseryEqualToken(body.token,properties.getProperty('NURSERY_TOKEN'))) return nurseryReply({ok:false,error:'Unauthorized'});
    nurseryValidate(body);
    lock=LockService.getScriptLock();
    if(!lock.tryLock(20000)) return nurseryReply({ok:false,error:'Busy; retry'});
    const spreadsheet=SpreadsheetApp.openById(properties.getProperty('SHEET_ID'));
    const destinations={};
    body.records.forEach(record=>{
      const schema=NURSERY_SCHEMAS[record.kind];
      const destination=destinations[record.kind] || (destinations[record.kind]=nurseryDestination(spreadsheet,schema));
      const values=[record.key,NURSERY_SCHEMA_VERSION,...schema.columns.map(c=>nurseryCell(record.data[c]))];
      const row=destination.rows.get(record.key);
      if(row) destination.sheet.getRange(row,1,1,values.length).setValues([values]);
      else { destination.rows.set(record.key,-1); destination.appends.push(values); }
    });
    // New rows go in one write per tab; a batch is up to 100 rows.
    Object.values(destinations).forEach(d=>{
      if(d.appends.length) d.sheet.getRange(d.sheet.getLastRow()+1,1,d.appends.length,d.appends[0].length).setValues(d.appends);
    });
    SpreadsheetApp.flush();
    return nurseryReply({ok:true,acceptedKeys:body.records.map(r=>r.key)});
  } catch(error) {
    // No token/request/private event payload appears in logs or responses.
    return nurseryReply({ok:false,error:'Request not accepted; verify receiver configuration'});
  } finally { if(lock && lock.hasLock()) lock.releaseLock(); }
}
function doGet() { return nurseryReply({ok:false,error:'POST with authentication required'}); }
