import { parseNurseryBatch } from '../nurseryApi';
import { careEventLabels, shoppingCategoryLabels, shoppingStatusLabels } from '../../domain/types';

export class InternalError extends Error {
  constructor(readonly code: 'conflict' | 'forbidden' | 'invalid' | 'not-found' | 'unauthorized' | 'expired-cursor' | 'rate-limited') {
    super(code); this.name = 'InternalError';
  }
}
export function fail(code: InternalError['code']): never { throw new InternalError(code); }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('invalid');
  return value as Record<string, unknown>;
}
export function validId(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 200; }
export function boundedText(value: unknown, maximum: number): string { if (typeof value !== 'string' || !value.length || value.length > maximum) fail('invalid'); return value; }
export function text(value: unknown): string { if (!validId(value)) fail('invalid'); return value; }
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const row = object(value);
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(',')}}`;
}
/** Merge patch semantics: null explicitly clears, omitted fields survive older clients. */
export function mergePatch(previous: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result = { ...previous };
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('invalid');
    if (value === null) delete result[key];
    else if (value && typeof value === 'object' && !Array.isArray(value)) result[key] = mergePatch(
      result[key] && typeof result[key] === 'object' && !Array.isArray(result[key]) ? object(result[key]) : {}, object(value));
    else result[key] = value;
  }
  return result;
}
function oneOf(value: unknown, choices: readonly string[]) { if (typeof value !== 'string' || !choices.includes(value)) fail('invalid'); }
function required(row: Record<string, unknown>, key: string) { if (typeof row[key] !== 'string' || !(row[key] as string).trim()) fail('invalid'); }
export function validateDocument(collection: string, row: Record<string, unknown>) {
  text(row.id);
  for (const key of ['createdAt', 'updatedAt', 'startedAt', 'endedAt', 'dueAt', 'completedAt', 'scheduledAt', 'givenAt', 'archivedAt']) {
    if (row[key] !== undefined && (typeof row[key] !== 'string' || !Number.isFinite(Date.parse(row[key] as string)))) fail('invalid');
  }
  if (collection === 'profiles') {
    required(row, 'name'); required(row, 'timezone'); text(row.familyId);
    try { new Intl.DateTimeFormat('en',{ timeZone:String(row.timezone) }).format(); } catch { fail('invalid'); }
    if (row.kind !== undefined) oneOf(row.kind, ['child', 'parent', 'caregiver']);
    if (row.parentRole !== undefined) oneOf(row.parentRole, ['dad', 'mom', 'parent']);
    if (row.gender !== undefined) oneOf(row.gender, ['boy', 'girl', 'other']);
    for (const key of ['birthDate','dueDate']) if (row[key] !== undefined &&
      (typeof row[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(row[key] as string) || !Number.isFinite(Date.parse(row[key] as string)))) fail('invalid');
    if (row.kind === 'parent' && row.dueDate !== undefined) fail('invalid');
    return;
  }
  if (collection === 'shopping') {
    required(row, 'name'); oneOf(row.category, Object.keys(shoppingCategoryLabels)); oneOf(row.status, Object.keys(shoppingStatusLabels));
    if (typeof row.isFood !== 'boolean') fail('invalid'); return;
  }
  if (collection === 'tasks') { required(row, 'title'); oneOf(row.status, ['open','done']); return; }
  if (collection === 'nursery') {
    if (Object.keys(row).some((key) => !['id','kind','data','createdAt','updatedAt','syncState'].includes(key))) fail('invalid');
    const data = object(row.data);
    const checked = parseNurseryBatch({ deviceId:data.sourceDeviceId,records:[{ data,key:`${data.sourceDeviceId}:validate`,kind:row.kind,schemaVersion:2 }],schemaVersion:2 });
    if (!checked.ok) fail('invalid'); return;
  }
  if (collection !== 'events') fail('invalid');
  oneOf(row.type, Object.keys(careEventLabels)); text(row.babyId); required(row, 'startedAt');
  if (row.endedAt && Date.parse(String(row.endedAt)) < Date.parse(String(row.startedAt))) fail('invalid');
  for (const key of ['amountOz', 'durationMinutes', 'weightOz', 'lengthIn', 'headCircumferenceIn', 'caffeineMg']) {
    if (row[key] !== undefined && (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || (row[key] as number) < 0)) fail('invalid');
  }
  const enumFields: Record<string, [string, string[]][]> = {
    diaper: [['kind', ['wet','dirty','both']]], feed: [['method', ['nursing','bottle']]],
    intake: [['kind', ['food','drink']]], medication: [['status', ['scheduled','given','skipped']]],
    menses: [['flow', ['spotting','light','medium','heavy']]],
    output: [['kind', ['pee','poo','fart','burp','vomit','reflux','bloating','cramp']]],
    pump: [['side', ['left','right','both']]]
  };
  for (const [field, choices] of enumFields[String(row.type)] ?? []) oneOf(row[field], choices);
  for (const key of row.type === 'medication' ? ['medicationName','dose'] : row.type === 'appointment' ? ['reason'] :
    row.type === 'milestone' || row.type === 'vaccine' ? ['refId'] : []) required(row, key);
  if (row.type === 'temperature' && (typeof row.celsius !== 'number' || !Number.isFinite(row.celsius))) fail('invalid');
  if (row.type === 'tummytime' && typeof row.durationMinutes !== 'number') fail('invalid');
  if (row.type === 'pump' && typeof row.amountOz !== 'number') fail('invalid');
  for (const [key, max] of [['level',5],['severity',5],['bristol',7]] as const) {
    if ((row.type === 'mood' && key === 'level') || row[key] !== undefined) {
      if (!Number.isInteger(row[key]) || Number(row[key]) < 1 || Number(row[key]) > max) fail('invalid');
    }
  }
  if (row.tags !== undefined && (!Array.isArray(row.tags) || !row.tags.every((tag) => typeof tag === 'string'))) fail('invalid');
  for (const key of ['notes','title','color','caregiverId']) if (row[key] !== undefined && typeof row[key] !== 'string') fail('invalid');
}
