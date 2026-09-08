import { describe, expect, it } from 'vitest';
import { inferDiaperDetailsFromNotes, normalizePoopSize, normalizeStoolColor } from './diaperDetails';

describe('normalizeStoolColor', () => {
  it('passes a reference id through', () => {
    expect(normalizeStoolColor('green')).toBe('green');
    expect(normalizeStoolColor('Normal')).toBe('normal');
  });

  it('resolves the words the old free-text box collected', () => {
    expect(normalizeStoolColor('mustard yellow')).toBe('normal');
    expect(normalizeStoolColor('meconium')).toBe('black');
    expect(normalizeStoolColor('a bit bloody')).toBe('red');
    expect(normalizeStoolColor('grey')).toBe('gray');
  });

  it('keeps an unrecognized color as written rather than dropping it', () => {
    expect(normalizeStoolColor('olive')).toBe('olive');
  });

  it('treats blank as nothing logged', () => {
    expect(normalizeStoolColor('   ')).toBeUndefined();
    expect(normalizeStoolColor(undefined)).toBeUndefined();
  });
});

describe('normalizePoopSize', () => {
  it('accepts the three sizes and rejects anything else', () => {
    expect(normalizePoopSize('Large')).toBe('large');
    expect(normalizePoopSize('enormous')).toBeUndefined();
    expect(normalizePoopSize('')).toBeUndefined();
  });
});

describe('inferDiaperDetailsFromNotes', () => {
  it('reads size and color out of a note written before either was a field', () => {
    expect(inferDiaperDetailsFromNotes('big yellow blowout, needed a new outfit')).toEqual({ color: 'normal', poopSize: 'large' });
  });

  it('takes the first word written when a note mentions two', () => {
    expect(inferDiaperDetailsFromNotes('small at first, then a big one').poopSize).toBe('small');
  });

  it('matches whole words only', () => {
    expect(inferDiaperDetailsFromNotes('bigger appetite today').poopSize).toBeUndefined();
    expect(inferDiaperDetailsFromNotes('greenhouse trip').color).toBeUndefined();
  });

  it('finds nothing in a note that describes nothing', () => {
    expect(inferDiaperDetailsFromNotes('changed before the walk')).toEqual({ color: undefined, poopSize: undefined });
    expect(inferDiaperDetailsFromNotes(undefined)).toEqual({});
  });
});
