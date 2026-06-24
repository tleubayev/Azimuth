'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DepositSheet } from './DepositSheet';
import { WithdrawSheet } from './WithdrawSheet';

export type FundingProduct = 'perps' | 'tokenized';

/** A successful deposit, so screens can show a "funds landing" state while the
 * product account (Hyperliquid / Safe) catches up to the on-chain transfer. */
export interface DepositMark {
  product: FundingProduct;
  /** Epoch ms when the deposit transfer was submitted. */
  at: number;
}

interface FundingContextValue {
  openDeposit: (target?: FundingProduct) => void;
  openWithdraw: (target?: FundingProduct) => void;
  close: () => void;
  /** Most recent successful deposit (or null). Drives the "funds landing" UI. */
  lastDeposit: DepositMark | null;
  /** Record that a deposit just completed for `product`. */
  markDeposited: (product: FundingProduct) => void;
}

const FundingContext = createContext<FundingContextValue | null>(null);

/** Single shared Deposit / Withdraw sheet pair, triggerable from any screen. */
export function FundingProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<'deposit' | 'withdraw' | null>(null);
  const [target, setTarget] = useState<FundingProduct>('perps');
  const [lastDeposit, setLastDeposit] = useState<DepositMark | null>(null);

  const openDeposit = useCallback((t: FundingProduct = 'perps') => { setTarget(t); setMode('deposit'); }, []);
  const openWithdraw = useCallback((t: FundingProduct = 'perps') => { setTarget(t); setMode('withdraw'); }, []);
  const close = useCallback(() => setMode(null), []);
  const markDeposited = useCallback((product: FundingProduct) => setLastDeposit({ product, at: Date.now() }), []);

  const value = useMemo(
    () => ({ openDeposit, openWithdraw, close, lastDeposit, markDeposited }),
    [openDeposit, openWithdraw, close, lastDeposit, markDeposited],
  );

  return (
    <FundingContext.Provider value={value}>
      {children}
      <DepositSheet open={mode === 'deposit'} onClose={close} target={target} />
      <WithdrawSheet open={mode === 'withdraw'} onClose={close} target={target} />
    </FundingContext.Provider>
  );
}

export function useFunding(): FundingContextValue {
  const ctx = useContext(FundingContext);
  if (!ctx) throw new Error('useFunding must be used within <FundingProvider>');
  return ctx;
}
