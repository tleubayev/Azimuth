import { describe, expect, it } from 'vitest';
import {
  builderField,
  withCloseBuilderFee,
  withApprovalBuilder,
  isBuilderApprovalError,
  type BuilderConfig,
} from '../builderFee';

const ON: BuilderConfig = { address: '0xBuilder', rate: '0.1%' };
const OFF: BuilderConfig = { address: null, rate: '0.1%' };

describe('builderField', () => {
  it('builds the builder object when an address is configured', () => {
    expect(builderField(ON)).toEqual({ address: '0xBuilder', max_fee_rate: '0.1%' });
  });
  it('is null when the fee is disabled', () => {
    expect(builderField(OFF)).toBeNull();
  });
});

describe('withCloseBuilderFee — closes only', () => {
  const close = { owner: '0xo', asset: 'AAPL', side: 'sell', size: '1', reduce_only: true };
  const open = { owner: '0xo', asset: 'AAPL', side: 'buy', size: '1', reduce_only: false };

  it('attaches the builder to a reduce-only (close) order', () => {
    expect(withCloseBuilderFee(close, ON)).toEqual({
      ...close,
      builder: { address: '0xBuilder', max_fee_rate: '0.1%' },
    });
  });

  it('leaves an open order (reduce_only false) fee-free', () => {
    expect(withCloseBuilderFee(open, ON)).toEqual(open);
    expect(withCloseBuilderFee(open, ON)).not.toHaveProperty('builder');
  });

  it('leaves an order with no reduce_only flag fee-free', () => {
    const noFlag = { owner: '0xo', asset: 'AAPL', side: 'buy', size: '1' };
    expect(withCloseBuilderFee(noFlag, ON)).toEqual(noFlag);
  });

  it('does not attach a fee when disabled, even on a close', () => {
    expect(withCloseBuilderFee(close, OFF)).toEqual(close);
  });

  it('OVERWRITES a client-supplied builder on a close — server is authoritative', () => {
    const tampered = { ...close, builder: { address: '0xEvil', max_fee_rate: '0%' } };
    expect(withCloseBuilderFee(tampered, ON).builder).toEqual({ address: '0xBuilder', max_fee_rate: '0.1%' });
  });

  it('STRIPS a client-supplied builder when the fee is disabled (no free ride for the client)', () => {
    const tampered = { ...close, builder: { address: '0xEvil', max_fee_rate: '0%' } };
    expect(withCloseBuilderFee(tampered, OFF)).not.toHaveProperty('builder');
  });

  it('STRIPS a client-supplied builder off an open order', () => {
    const tamperedOpen = { ...open, builder: { address: '0xEvil', max_fee_rate: '5%' } };
    expect(withCloseBuilderFee(tamperedOpen, ON)).not.toHaveProperty('builder');
  });

  it('preserves the original body fields', () => {
    const out = withCloseBuilderFee(close, ON);
    expect(out).toMatchObject({ owner: '0xo', asset: 'AAPL', side: 'sell', size: '1', reduce_only: true });
  });
});

describe('withApprovalBuilder', () => {
  it('injects the builder for an approval request', () => {
    expect(withApprovalBuilder({ owner: '0xo' }, ON)).toEqual({
      owner: '0xo',
      builder: { address: '0xBuilder', max_fee_rate: '0.1%' },
    });
  });
  it('is a no-op when disabled', () => {
    expect(withApprovalBuilder({ owner: '0xo' }, OFF)).toEqual({ owner: '0xo' });
  });
  it('overwrites a client-supplied builder on approval — server is authoritative', () => {
    const tampered = { owner: '0xo', builder: { address: '0xEvil', max_fee_rate: '0%' } };
    expect(withApprovalBuilder(tampered, ON).builder).toEqual({ address: '0xBuilder', max_fee_rate: '0.1%' });
  });
});

describe('isBuilderApprovalError', () => {
  it('matches Hyperliquid approval-related messages', () => {
    expect(isBuilderApprovalError(new Error('Builder fee has not been approved'))).toBe(true);
    expect(isBuilderApprovalError(new Error('Must approve builder fee before trading'))).toBe(true);
    expect(isBuilderApprovalError(new Error('Order has invalid max builder fee'))).toBe(true);
    expect(isBuilderApprovalError('builder fee not approved')).toBe(true);
  });
  it('ignores unrelated errors', () => {
    expect(isBuilderApprovalError(new Error('Insufficient margin'))).toBe(false);
    expect(isBuilderApprovalError(new Error('Network error'))).toBe(false);
    expect(isBuilderApprovalError(null)).toBe(false);
    expect(isBuilderApprovalError(undefined)).toBe(false);
  });
});
