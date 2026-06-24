import { describe, it, expect } from 'vitest';
import { fmtLeverage, sanitizeDecimalInput, truncTo } from '@/lib/format';

describe('sanitizeDecimalInput', () => {
  it('converts a locale comma decimal separator to a dot', () => {
    // The mBASIS sell bug: "3,55" reached the API and Pydantic rejected it.
    expect(sanitizeDecimalInput('3,55')).toBe('3.55');
    expect(sanitizeDecimalInput('0,1')).toBe('0.1');
  });

  it('passes through a valid dot decimal unchanged', () => {
    expect(sanitizeDecimalInput('3.55')).toBe('3.55');
    expect(sanitizeDecimalInput('100')).toBe('100');
  });

  it('strips non-numeric characters', () => {
    expect(sanitizeDecimalInput('3.55abc')).toBe('3.55');
    expect(sanitizeDecimalInput('$12.50')).toBe('12.50');
  });

  it('collapses multiple separators to a single decimal point', () => {
    expect(sanitizeDecimalInput('3.5.5')).toBe('3.55');
    expect(sanitizeDecimalInput('1,2,3')).toBe('1.23');
  });

  it('keeps a trailing dot while typing', () => {
    expect(sanitizeDecimalInput('3,')).toBe('3.');
    expect(sanitizeDecimalInput('3.')).toBe('3.');
  });
});

describe('fmtLeverage', () => {
  it('formats a whole-number leverage from the API string', () => {
    expect(fmtLeverage('5')).toBe('5×');
    expect(fmtLeverage('1')).toBe('1×');
    expect(fmtLeverage(20)).toBe('20×');
  });

  it('drops a trailing ".0"', () => {
    expect(fmtLeverage('5.0')).toBe('5×');
  });

  it('keeps a genuine fractional leverage', () => {
    expect(fmtLeverage('2.5')).toBe('2.5×');
  });

  it('falls back to "—" when missing', () => {
    expect(fmtLeverage(null)).toBe('—');
    expect(fmtLeverage(undefined)).toBe('—');
    expect(fmtLeverage('')).toBe('—');
  });
});

describe('truncTo (never rounds up)', () => {
  it('truncates toward zero', () => {
    expect(truncTo(9.997, 2)).toBe(9.99);
    expect(truncTo('3.556616', 2)).toBe(3.55);
    expect(truncTo(1.999, 0)).toBe(1);
  });
});
