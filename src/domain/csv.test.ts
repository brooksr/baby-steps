import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvRecords } from './csv';
import { classifyTemperatureC, getMilestoneById, getMilestones, getTummyTimeGuide, getVaccinationById, getVaccinationSchedule } from './reference';

describe('parseCsv', () => {
  it('parses headers and rows', () => {
    const result = parseCsv('a,b,c\n1,2,3\n4,5,6');
    expect(result.headers).toEqual(['a', 'b', 'c']);
    expect(result.rows).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6']
    ]);
  });

  it('honours quoted fields with embedded commas', () => {
    const result = parseCsv('name,note\nx,"hello, world"');
    expect(result.rows[0]).toEqual(['x', 'hello, world']);
  });

  it('keeps empty trailing cells', () => {
    const [record] = parseCsvRecords('a,b,c\n1,,3');
    expect(record).toEqual({ a: '1', b: '', c: '3' });
  });
});

describe('reference data', () => {
  it('loads milestones from CSV', () => {
    const milestones = getMilestones();
    expect(milestones.length).toBeGreaterThan(0);
    expect(milestones[0]).toHaveProperty('ageMonths');
  });

  it('loads tummy-time guidance', () => {
    expect(getTummyTimeGuide()[0].dailyMaxMinutes).toBeGreaterThan(0);
  });

  it('classifies a fever temperature', () => {
    expect(classifyTemperatureC(38.5)?.band).toBe('Fever');
    expect(classifyTemperatureC(37.0)?.band).toBe('Normal');
  });

  it('gives milestones stable, resolvable ids', () => {
    const milestones = getMilestones();
    const ids = milestones.map((milestone) => milestone.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getMilestoneById(ids[0])?.milestone).toBe(milestones[0].milestone);
  });

  it('parses vaccination ages into months', () => {
    const schedule = getVaccinationSchedule();
    expect(schedule.find((vaccination) => /birth/i.test(vaccination.age))?.ageMonths).toBe(0);
    expect(schedule.find((vaccination) => vaccination.age === '2 months')?.ageMonths).toBe(2);
    expect(getVaccinationById(schedule[0].id)?.age).toBe(schedule[0].age);
  });
});
