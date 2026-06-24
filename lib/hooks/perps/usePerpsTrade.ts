'use client';

import { useCallback, useRef, useState } from 'react';
import { useWallet } from '@/lib/contexts/wallet-context';
import { compassPost, signAndExecutePerps, pickNum } from '@/lib/compass/client';
import { BUILDER_FEE_ENABLED } from '@/lib/config/perps';
import { isBuilderApprovalError } from '@/lib/perps/builderFee';
import type { PerpsPosition, PerpsPrepare, TypedData } from '@/lib/compass/types';

/** Per-owner marker so the one-time builder-fee approval runs at most once/device. */
function builderApprovedKey(owner: string): string {
  return `cp:bf-approved:${owner.toLowerCase()}`;
}

const DEFAULT_SLIPPAGE_PERCENT = 1.0;

/** Contract size from a USD notional, ceiled to szDecimals so notional ≥ input. */
export function usdToContractSize(usd: number, markPrice: number, szDecimals: number): string {
  if (!markPrice || markPrice <= 0) return '0';
  const f = Math.pow(10, szDecimals);
  const size = Math.ceil((usd / markPrice) * f) / f;
  return szDecimals > 0 ? size.toFixed(szDecimals) : String(Math.trunc(size));
}

type Loose = Record<string, unknown>;

/**
 * Perps actions: enable unified account, open positions at a chosen leverage,
 * close market orders, withdraw. Mirrors TraditionalInvestingWidget's handlers.
 */
export function usePerpsTrade() {
  const { adapter, evmAddress } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Counter-based in-flight tracker so concurrent actions don't clear `busy`
  // while another is still running. `busy` stays true until ALL finish.
  const inFlight = useRef(0);
  const startBusy = useCallback(() => {
    inFlight.current += 1;
    setBusy(true);
  }, []);
  const endBusy = useCallback(() => {
    inFlight.current = Math.max(0, inFlight.current - 1);
    setBusy(inFlight.current > 0);
  }, []);

  const sign = useCallback(
    (d: TypedData) => {
      if (!adapter?.signTypedData) throw new Error('Wallet not ready');
      return adapter.signTypedData(d);
    },
    [adapter],
  );

  /**
   * One-time builder-fee authorization, required before a fee'd (close) order.
   * The signature is silent (server-side Privy key), so this adds no user prompt.
   * The server's approve-builder-fee route is authoritative (it injects the
   * builder and 400s when the fee is off), so this does NOT gate on the client
   * `BUILDER_FEE_ENABLED` flag — callers decide when to invoke it. Gated by a
   * per-owner localStorage marker so it runs once/device; `force` re-approves
   * (used to self-heal a stale marker when a close bounces with an approval error).
   */
  const ensureBuilderFeeApproved = useCallback(
    async (owner: string, force = false) => {
      const key = builderApprovedKey(owner);
      if (!force) {
        try {
          if (localStorage.getItem(key) === '1') return;
        } catch {
          /* localStorage unavailable — fall through and approve */
        }
      }
      const prepare = await compassPost<PerpsPrepare>('global-markets-perps/approve-builder-fee', { owner });
      await signAndExecutePerps(prepare, sign);
      try {
        localStorage.setItem(key, '1');
      } catch {
        /* non-fatal: we just re-approve next time */
      }
    },
    [sign],
  );

  const enableUnifiedAccount = useCallback(
    async (payload: PerpsPrepare) => {
      if (!payload.typedData) return;
      startBusy();
      setError(null);
      try {
        await signAndExecutePerps(
          { typedData: payload.typedData, action: payload.action, nonce: payload.nonce ?? 0 },
          sign,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to enable trading');
        throw e;
      } finally {
        endBusy();
      }
    },
    [sign, startBusy, endBusy],
  );

  /**
   * Set the on-chain leverage for an asset before a NEW position (skipped on
   * close). `leverage` is a whole-number multiplier within the asset's market
   * max; the endpoint no-ops (`leverage_ok: true`) when already at the target.
   */
  const setLeverage = useCallback(
    async (asset: string, leverage: number) => {
      const res = await compassPost<Loose>('global-markets-perps/set-leverage', {
        owner: evmAddress,
        asset,
        leverage,
      });
      const ok = res.leverageOk ?? res.leverage_ok;
      if (ok === false && (res.typedData ?? res.typed_data)) {
        await signAndExecutePerps(
          {
            typedData: (res.typedData ?? res.typed_data) as TypedData,
            action: res.action,
            nonce: pickNum(res, 'nonce') ?? 0,
          },
          sign,
        );
      }
    },
    [evmAddress, sign],
  );

  const openPosition = useCallback(
    async (args: { asset: string; side: 'buy' | 'sell'; size: string; leverage: number }) => {
      if (!evmAddress) throw new Error('Wallet not ready');
      startBusy();
      setError(null);
      try {
        await setLeverage(args.asset, args.leverage);
        // Opens are NOT reduce-only, so the server route attaches no builder
        // fee — opening/adding is free; only closing pays.
        const prepare = await compassPost<PerpsPrepare>(
          'global-markets-perps/market-order',
          { owner: evmAddress, asset: args.asset, side: args.side, size: args.size, slippage_percent: DEFAULT_SLIPPAGE_PERCENT },
        );
        return await signAndExecutePerps(prepare, sign);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Order failed');
        throw e;
      } finally {
        endBusy();
      }
    },
    [evmAddress, setLeverage, sign, startBusy, endBusy],
  );

  const closePosition = useCallback(
    async (position: PerpsPosition) => {
      if (!evmAddress) throw new Error('Wallet not ready');
      startBusy();
      setError(null);
      try {
        const side = position.side === 'long' ? 'sell' : 'buy';
        // A close is a reduce-only order; the server route attaches the builder
        // fee to it, so the user must have authorized the builder first.
        const placeClose = async () => {
          const prepare = await compassPost<PerpsPrepare>(
            'global-markets-perps/market-order',
            { owner: evmAddress, asset: position.asset, side, size: position.size, slippage_percent: DEFAULT_SLIPPAGE_PERCENT, reduce_only: true },
          );
          return signAndExecutePerps(prepare, sign);
        };
        // Proactive optimization (skips a wasted first-close round-trip): only
        // when THIS build knows a fee is configured. Correctness never depends
        // on it — the self-heal below does.
        if (BUILDER_FEE_ENABLED) await ensureBuilderFeeApproved(evmAddress);
        try {
          return await placeClose();
        } catch (e) {
          // Self-heal on the error classification ALONE: the server is the
          // authoritative fee injector, so a close can bounce for a missing
          // approval even if this client bundle was built without the address
          // (e.g. a stale NEXT_PUBLIC value). Re-approve once and retry.
          if (!isBuilderApprovalError(e)) throw e;
          await ensureBuilderFeeApproved(evmAddress, true);
          return await placeClose();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Close failed');
        throw e;
      } finally {
        endBusy();
      }
    },
    [evmAddress, sign, ensureBuilderFeeApproved, startBusy, endBusy],
  );

  /** Withdraw from the Hyperliquid account back to the embedded wallet (Arbitrum). */
  const withdraw = useCallback(
    async (amount: string) => {
      if (!evmAddress) throw new Error('Wallet not ready');
      const prepare = await compassPost<PerpsPrepare>(
        'global-markets-perps/withdraw',
        { owner: evmAddress, amount },
      );
      return signAndExecutePerps(prepare, sign);
    },
    [evmAddress, sign],
  );

  return { openPosition, closePosition, enableUnifiedAccount, withdraw, busy, error, setError };
}
