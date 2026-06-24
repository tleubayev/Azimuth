'use client';

import { useCallback } from 'react';
import { useWallet } from '@/lib/contexts/wallet-context';
import { usePerpsAccountMode, usePerpsPositions } from './queries';
import type { PerpsPrepare } from '@/lib/compass/types';

/**
 * Perps setup state machine.
 *
 *   loading ─▶ fund ──(USDC lands in Hyperliquid: accountValue > 0)──▶ enable ──(sign)─▶ ready
 *
 * **Why we gate `enable` on the account value, not on `signingPayload`:**
 * `POST global-markets-perps/enable-unified-account` only inspects the account's
 * `userAbstraction` mode — it returns an EIP-712 enable payload for ANY account
 * that isn't already unified, funded or not (see the backend
 * `perform_enable_unified_account`, which never reads a balance). Hyperliquid
 * rejects the enable action ("Must deposit before performing actions") only at
 * EXECUTION time. So a non-null `signingPayload` does NOT mean the user can
 * enable trading — the only reliable "assets have bridged" signal is a positive
 * Hyperliquid account value. We refuse to surface "Enable trading" until then,
 * otherwise the one-time signature fails on the exchange.
 */
export type PerpsSetupStatus = 'loading' | 'fund' | 'enable' | 'ready';

export interface PerpsSetup {
  status: PerpsSetupStatus;
  /** Hyperliquid account value in USD; `> 0` ⇒ funds have bridged and landed. */
  accountValue: number;
  /** EIP-712 enable payload — present whenever the account is not yet unified. */
  signingPayload: PerpsPrepare | null;
  /** Re-check account mode + balance (e.g. after a deposit lands or enabling). */
  refresh: () => void;
}

export interface PerpsSetupInput {
  hasWallet: boolean;
  modeLoading: boolean;
  isUnified: boolean;
  positionsLoading: boolean;
  accountValue: number;
}

/**
 * Pure state transition for the perps setup machine. Extracted so the core
 * invariant — **`enable` requires `accountValue > 0`** — is unit-tested without
 * React. See the module doc for why a positive account value (not the presence
 * of a signing payload) is the gate.
 */
export function perpsSetupStatus(input: PerpsSetupInput): PerpsSetupStatus {
  if (!input.hasWallet || input.modeLoading) return 'loading';
  // Already enabled — trade. (Stays `ready` even at $0; the active view shows
  // Deposit/Withdraw.) An enabled account never needs the funding gate.
  if (input.isUnified) return 'ready';
  // Not unified yet: wait for the first balance read before choosing fund-vs-
  // enable so a funded user doesn't flash the "fund" step.
  if (input.positionsLoading) return 'loading';
  return input.accountValue > 0 ? 'enable' : 'fund';
}

export function usePerpsSetup(): PerpsSetup {
  const { evmAddress } = useWallet();
  const mode = usePerpsAccountMode();
  const positions = usePerpsPositions();

  const accountValue = positions.accountValue;

  const status = perpsSetupStatus({
    hasWallet: !!evmAddress,
    modeLoading: mode.isLoading,
    isUnified: mode.isUnified,
    positionsLoading: positions.isLoading,
    accountValue,
  });

  const { refetch: refetchMode } = mode;
  const { refetch: refetchPositions } = positions;
  const refresh = useCallback(() => {
    refetchMode();
    refetchPositions();
  }, [refetchMode, refetchPositions]);

  return { status, accountValue, signingPayload: mode.signingPayload, refresh };
}
