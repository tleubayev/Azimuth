import { describe, expect, it } from 'vitest';
import { perpsSetupStatus, type PerpsSetupInput } from '../usePerpsSetup';

const base: PerpsSetupInput = {
  hasWallet: true,
  modeLoading: false,
  isUnified: false,
  positionsLoading: false,
  accountValue: 0,
};

describe('perpsSetupStatus', () => {
  it('is loading until the wallet and account mode resolve', () => {
    expect(perpsSetupStatus({ ...base, hasWallet: false })).toBe('loading');
    expect(perpsSetupStatus({ ...base, modeLoading: true })).toBe('loading');
  });

  it('is ready once unified, even with a zero account value', () => {
    expect(perpsSetupStatus({ ...base, isUnified: true, accountValue: 0 })).toBe('ready');
  });

  it('waits for the first balance read before choosing fund vs enable', () => {
    // Without this guard a funded user would briefly flash the "fund" step.
    expect(perpsSetupStatus({ ...base, positionsLoading: true, accountValue: 0 })).toBe('loading');
  });

  it('requires funds in Hyperliquid before enabling — NOT a signing payload', () => {
    // The core invariant: a non-unified account with no balance must Fund first.
    expect(perpsSetupStatus({ ...base, accountValue: 0 })).toBe('fund');
    // Once the deposit lands (accountValue > 0), Enable unlocks.
    expect(perpsSetupStatus({ ...base, accountValue: 12.5 })).toBe('enable');
  });

  it('treats a tiny dust balance as funded (any positive value unlocks enable)', () => {
    expect(perpsSetupStatus({ ...base, accountValue: 0.01 })).toBe('enable');
  });
});
