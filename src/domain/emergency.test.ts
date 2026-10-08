import { describe, expect, it } from 'vitest';
import { getEmergencyAgeGroup, getEmergencyGuides } from './emergency';

function guide(id: string, ...args: Parameters<typeof getEmergencyGuides>) {
  const found = getEmergencyGuides(...args).find((item) => item.id === id);
  if (!found) throw new Error(`no ${id} guide`);
  return found;
}

const text = (item: ReturnType<typeof guide>) => [item.when, ...item.callWhen, ...item.steps, ...(item.notes ?? [])].join(' ');

describe('getEmergencyAgeGroup', () => {
  it('splits at the first birthday, and reads an unborn baby as an infant', () => {
    expect(getEmergencyAgeGroup(null)).toBe('infant');
    expect(getEmergencyAgeGroup(0)).toBe('infant');
    expect(getEmergencyAgeGroup(364)).toBe('infant');
    expect(getEmergencyAgeGroup(365)).toBe('child');
  });
});

describe('getEmergencyGuides', () => {
  it('opens on CPR then choking, and every guide says when to call and what to do', () => {
    for (const group of ['infant', 'child'] as const) {
      const guides = getEmergencyGuides(group, group === 'infant' ? 120 : 800);
      expect(guides.slice(0, 2).map((item) => item.id)).toEqual(['cpr', 'choking']);
      expect(new Set(guides.map((item) => item.id)).size).toBe(guides.length);
      for (const item of guides) {
        expect(item.callWhen.length).toBeGreaterThan(0);
        expect(item.steps.length).toBeGreaterThan(0);
      }
    }
  });

  // Abdominal thrusts can injure a baby's organs; back blows and chest thrusts only.
  it('never tells anyone to give an infant abdominal thrusts', () => {
    const infant = guide('choking', 'infant', 120);
    expect(infant.steps.join(' ')).toMatch(/chest thrusts/);
    expect(infant.steps.join(' ')).not.toMatch(/abdominal thrusts/i);
    expect(guide('choking', 'child', 800).steps.join(' ')).toMatch(/abdominal thrusts/);
  });

  it('uses infant and child compression depths', () => {
    expect(text(guide('cpr', 'infant', 30))).toMatch(/1½ inches \(4 cm\)/);
    expect(text(guide('cpr', 'child', 800))).toMatch(/2 inches \(5 cm\)/);
  });

  it('treats a fever under three months as urgent and moves it up the list', () => {
    const young = getEmergencyGuides('infant', 40);
    expect(young.findIndex((item) => item.id === 'fever')).toBeLessThan(young.findIndex((item) => item.id === 'poisoning'));
    expect(guide('fever', 'infant', 40).title).toBe('Fever under 3 months');

    const older = getEmergencyGuides('infant', 200);
    expect(older[older.length - 1].id).toBe('fever');
    expect(guide('fever', 'infant', 200).title).toBe('High fever');
  });

  // Switched to "1 year +" for a sibling, a newborn's own age must not leak in.
  it('follows the chosen group rather than the child when the two differ', () => {
    expect(guide('fever', 'child', 20).title).toBe('High fever');
    expect(guide('seizure', 'child', 20).callWhen.join(' ')).not.toMatch(/under one year/);
    expect(guide('seizure', 'infant', 800).callWhen.join(' ')).toMatch(/under one year/);
  });

  // Not a medical device: first aid only, no medicine names or doses.
  it('names no dose', () => {
    for (const group of ['infant', 'child'] as const) {
      for (const item of getEmergencyGuides(group, null)) {
        expect(text(item)).not.toMatch(/\b\d+(\.\d+)?\s?(mg|ml|mL|milligrams?|teaspoons?)\b/);
        expect(text(item)).not.toMatch(/acetaminophen|ibuprofen|tylenol|motrin|benadryl/i);
      }
    }
  });
});
