import { describe, it, expect } from 'vitest';
import { spotFeeField, withSpotFee, type SpotFeeConfig } from '@/lib/tokenized/fee';

const ON: SpotFeeConfig = { recipient: '0xFee', percent: '1' };
const OFF: SpotFeeConfig = { recipient: null, percent: '1' };

describe('spotFeeField', () => {
  it('builds a PERCENTAGE fee when a recipient is set', () => {
    expect(spotFeeField(ON)).toEqual({ recipient: '0xFee', amount: '1', denomination: 'PERCENTAGE' });
  });

  it('preserves the configured percent verbatim', () => {
    expect(spotFeeField({ recipient: '0xFee', percent: '0.5' })?.amount).toBe('0.5');
  });

  it('returns null when no recipient is configured (fee disabled)', () => {
    expect(spotFeeField(OFF)).toBeNull();
  });

  it('returns null for a non-positive or non-numeric rate', () => {
    expect(spotFeeField({ recipient: '0xFee', percent: '0' })).toBeNull();
    expect(spotFeeField({ recipient: '0xFee', percent: '-1' })).toBeNull();
    expect(spotFeeField({ recipient: '0xFee', percent: 'abc' })).toBeNull();
  });
});

describe('withSpotFee', () => {
  it('injects the fee into a sell body', () => {
    const body = { token_in: 'mTBILL', token_out: 'USDC', amount_in: '5', owner: '0xo' };
    expect(withSpotFee(body, ON)).toEqual({ ...body, fee: { recipient: '0xFee', amount: '1', denomination: 'PERCENTAGE' } });
  });

  it('is server-authoritative — strips a client-supplied fee and replaces it', () => {
    const tampered = { owner: '0xo', fee: { recipient: '0xEvil', amount: '0', denomination: 'PERCENTAGE' } };
    expect(withSpotFee(tampered, ON).fee).toEqual({ recipient: '0xFee', amount: '1', denomination: 'PERCENTAGE' });
  });

  it('strips a client-supplied fee even when disabled (no recipient → never fee)', () => {
    const tampered = { owner: '0xo', fee: { recipient: '0xEvil', amount: '5', denomination: 'PERCENTAGE' } };
    expect(withSpotFee(tampered, OFF)).toEqual({ owner: '0xo' });
  });

  it('returns the body unchanged when the fee is disabled', () => {
    const body = { token_in: 'mTBILL', token_out: 'USDC', amount_in: '5', owner: '0xo' };
    expect(withSpotFee(body, OFF)).toEqual(body);
  });
});
