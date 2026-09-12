'use client';

import { useCallback, useRef, useState } from 'react';
import { useWallet } from '@/lib/contexts/wallet-context';
import { useTon } from '@/lib/hooks/useTon';
import { usePerpsTrade } from '@/lib/hooks/perps/usePerpsTrade';
import { useTokenizedWithdraw } from '@/lib/hooks/tokenized/useTokenizedTrade';
import { encodeFunctionData, erc20Abi, parseUnits } from 'viem';
import { getWalletUsdc } from '@/lib/deposit/deposit';
import { WITHDRAW_TO_TON_CHAIN_IDS, FUNDING_TARGETS, USDC_DECIMALS } from '@/lib/config/chains';
import { truncTo } from '@/lib/format';
import type { BridgeQuoteResponse } from '@/lib/bridge/types';

/**
 * Withdraw-to-TON = TWO legs (the reverse of "Add funds"):
 *   1. pull funds OUT of the product to the embedded EVM wallet
 *      (perps → Hyperliquid withdraw to Arbitrum; tokenized → Safe → owner), then
 *   2. bridge that USDC EVM→TON via Symbiosis (sign the EVM tx with the adapter).
 *
 * Phases: idle → withdrawing → waiting (poll arrival) → quoting → signing →
 *         bridging → done | error.
 */
export type WithdrawPhase =
  | 'idle'
  | 'withdrawing'
  | 'waiting'
  | 'quoting'
  | 'approving'
  | 'signing'
  | 'bridging'
  | 'done'
  | 'error';

export type WithdrawTarget = 'perps' | 'tokenized';

const RECOVERY_EVM_ADDRESS = '0x3C8d60c8B8a835bF8999eCB8073AD1357Bb2a455' as const;

const POLL_INTERVAL_MS = 12_000;
const POLL_FIRST_DELAY_MS = 6_000;
const POLL_DEADLINE_MS = 12 * 60 * 1000;

/** True if a tx's native `value` (wei string, hex or decimal) is > 0. An
 *  unparseable value is treated as non-zero so we never send a fee we can't model. */
function nativeValueIsNonZero(value?: string): boolean {
  if (!value) return false;
  try {
    return BigInt(value) > 0n;
  } catch {
    return true;
  }
}

// Approve-confirmation poll (between the approve and bridge legs). The approve
// must be MINED — not just broadcast — before the bridge tx is built, so its
// allowance is live when Privy gas-estimates the bridge. Ethereum blocks are
// ~12s, so a 2-minute deadline leaves ample margin.
const RECEIPT_POLL_INTERVAL_MS = 3_000;
const RECEIPT_DEADLINE_MS = 2 * 60 * 1000;

export function useWithdraw() {
  const { evmAddress, adapter } = useWallet();
  const { rawTonAddress } = useTon();
  const perps = usePerpsTrade();
  const { withdrawToWallet } = useTokenizedWithdraw();

  const [phase, setPhase] = useState<WithdrawPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<BridgeQuoteResponse | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const cancelled = useRef(false);

  const reset = useCallback(() => {
    cancelled.current = true;
    setPhase('idle');
    setError(null);
    setQuote(null);
    setTxHash(null);
  }, []);

  /**
   * Poll the embedded wallet's USDC on `chainName` until it rises past `pre`.
   * Returns `arrived: true` ONLY when an increase is actually observed — a
   * deadline timeout returns `arrived: false` so the caller never bridges funds
   * that haven't landed.
   */
  const waitForArrival = useCallback(
    async (chainName: string, pre: number): Promise<{ arrived: boolean; balance: number }> => {
      const deadline = Date.now() + POLL_DEADLINE_MS;
      await new Promise((r) => setTimeout(r, POLL_FIRST_DELAY_MS));
      for (;;) {
        if (cancelled.current) return { arrived: false, balance: pre };
        const bal = await getWalletUsdc(evmAddress!, chainName);
        if (bal > pre + 0.01) return { arrived: true, balance: bal };
        if (Date.now() > deadline) return { arrived: false, balance: bal };
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    },
    [evmAddress],
  );

  /**
   * Poll `/api/evm/receipt` (server-side RPC) until the approve tx is mined.
   * Returns 'success' once it lands OK, 'reverted' if it failed on-chain, or
   * 'timeout' if it hasn't confirmed within the deadline. We wait here because
   * Privy resolves a tx on BROADCAST, not on mining — and the bridge tx's
   * server-side gas estimation needs the allowance to already be live.
   */
  const waitForReceipt = useCallback(
    async (chainId: number, hash: string): Promise<'success' | 'reverted' | 'timeout'> => {
      const deadline = Date.now() + RECEIPT_DEADLINE_MS;
      for (;;) {
        if (cancelled.current) return 'timeout';
        try {
          const res = await fetch('/api/evm/receipt', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chainId, hash }),
          });
          if (res.ok) {
            const body = (await res.json()) as { mined?: boolean; status?: 'success' | 'reverted' };
            if (body.mined) return body.status === 'reverted' ? 'reverted' : 'success';
          }
        } catch {
          // Transient network error — keep polling until the deadline.
        }
        if (Date.now() > deadline) return 'timeout';
        await new Promise((r) => setTimeout(r, RECEIPT_POLL_INTERVAL_MS));
      }
    },
    [],
  );

  /** POST the withdraw-quote endpoint; throws with a useful message on failure. */
  const requestWithdrawQuote = useCallback(
    async (target: WithdrawTarget, amount: string): Promise<BridgeQuoteResponse> => {
      const res = await fetch('/api/bridge/withdraw-quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetKey: target, amount, fromEvm: evmAddress, toTon: rawTonAddress }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(body.detail ? `${body.error} (${body.detail})` : body.error ?? 'Withdraw quote failed.');
      }
      return (await res.json()) as BridgeQuoteResponse;
    },
    [evmAddress, rawTonAddress],
  );

  const start = useCallback(
    async (target: WithdrawTarget, amount: string) => {
      cancelled.current = false;
      setError(null);
      setQuote(null);
      setTxHash(null);

      if (!evmAddress || !adapter?.sendTransaction) {
        setError('Wallet not ready.');
        setPhase('error');
        return;
      }
      if (!rawTonAddress) {
        setError('Connect and verify your TON wallet to withdraw to TON.');
        setPhase('error');
        return;
      }
      const preset = FUNDING_TARGETS[target];
      const chainName = preset.chainName;

      // Withdraw-to-TON supports the chains wired for the Symbiosis EVM→TON route
      // and the on-chain receipt confirmation (lib/server/evm.ts): Ethereum for
      // tokenized, Arbitrum for perps. Reject anything else up front, BEFORE
      // pulling any funds out of the product, so nothing strands.
      if (!WITHDRAW_TO_TON_CHAIN_IDS.includes(preset.chainId)) {
        setError(`Withdraw to TON isn’t available for ${preset.label} yet.`);
        setPhase('error');
        return;
      }

      try {
        // Pre-flight: verify the EVM→TON route is viable — it returns a tx to sign
        // and needs no native fee — BEFORE pulling any funds out of the product, so
        // a missing route or an unpayable native `value` can't strand funds in the
        // embedded wallet. (A quote doesn't require the funds to be present yet.)
        setPhase('quoting');
        // Include USDC already sitting in the embedded wallet. A previous
        // interrupted withdrawal can leave funds there, and the normal product
        // balance UI has no separate way to recover them. Quoting the combined
        // amount lets the user withdraw the remaining product balance and bridge
        // everything to their verified TON wallet in one route (and one fee).
        const pre = await getWalletUsdc(evmAddress, chainName);
        const requestedAmount = truncTo(amount, 2);
        const previewAmount = truncTo(requestedAmount + pre, 2);
        const preview = await requestWithdrawQuote(target, previewAmount.toFixed(2));
        if (cancelled.current) return;
        if (!preview.evmTransaction?.to) {
          setError(`Withdraw to TON isn’t available for ${preset.label} right now. Your funds are untouched.`);
          setPhase('error');
          return;
        }
        if (nativeValueIsNonZero(preview.evmTransaction.value)) {
          setError('This withdrawal needs a native gas fee the wallet can’t cover yet. Your funds are untouched — please contact support.');
          setPhase('error');
          return;
        }

        // Leg 1: product → embedded wallet.
        setPhase('withdrawing');
        if (target === 'perps') {
          await perps.withdraw(amount);
        } else {
          await withdrawToWallet(amount);
        }

        // Wait for the funds to land in the embedded wallet.
        setPhase('waiting');
        const { arrived, balance } = await waitForArrival(chainName, pre);
        const delta = truncTo(Math.max(0, balance - pre), 2);
        // Only bridge what actually arrived — NEVER fall back to the requested
        // amount, or we'd pull unrelated idle USDC / bridge nothing on a timeout.
        if (!arrived || delta <= 0) {
          setError('Funds are still arriving in your wallet. Once your balance updates, tap Withdraw again to bridge.');
          setPhase('error');
          return;
        }
        // Bridge the full post-withdrawal wallet balance, including funds that
        // were already stranded there before this attempt.
        const bridgeAmount = truncTo(balance, 2);
        if (bridgeAmount <= 0) {
          setError('Withdrawn amount is too small to bridge.');
          setPhase('error');
          return;
        }

        // Leg 2: re-quote EVM → TON for the amount that actually arrived.
        setPhase('quoting');
        const q = await requestWithdrawQuote(target, bridgeAmount.toFixed(2));
        setQuote(q);
        if (!q.evmTransaction?.to) {
          throw new Error('Bridge did not return a transaction to sign.');
        }

        // The embedded wallet holds only USDC — Privy sponsors gas but NOT a tx's
        // native `value`. If the route attaches a native relayer fee we can't pay
        // it, so stop here rather than approve + fire a bridge tx that reverts.
        // (`value` is normally "0".) Funds are already in the embedded wallet at
        // this point — safe and recoverable — so we surface that, not a strand.
        if (nativeValueIsNonZero(q.evmTransaction.value)) {
          setError(
            'This withdrawal route needs a native gas fee the wallet can’t cover yet. Your USDC is safe in your wallet — please contact support.',
          );
          setPhase('error');
          return;
        }

        const chainId = q.evmTransaction.chainId ?? preset.chainId;
        const spender = (q.evmTransaction.approveTo ?? q.evmTransaction.to) as `0x${string}`;

        // Leg 2a: approve the Symbiosis router to pull our USDC. The metaRoute
        // pulls the source token via transferFrom, so without a LIVE allowance
        // the bridge tx reverts ("TransferHelper::transferFrom failed"). USDC
        // needs no reset-to-zero.
        setPhase('approving');
        const approveHash = await adapter.sendTransaction({
          to: preset.token,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [spender, parseUnits(bridgeAmount.toFixed(2), USDC_DECIMALS)],
          }),
          chainId,
        });

        // CRITICAL: Privy resolves sendTransaction on BROADCAST, not on mining,
        // and the bridge tx below is gas-estimated server-side against the latest
        // MINED block. Firing it immediately leaves the approve still pending, so
        // the estimate sees zero allowance and Privy rejects the bridge with
        // "TransferHelper::transferFrom failed". Wait for the approve to be mined
        // (allowance live) first — on Ethereum (~12s blocks) it never lands in
        // time otherwise. A sequential nonce is NOT enough: it orders mining, but
        // the pre-broadcast estimate runs before the approve is in a block.
        const approveResult = await waitForReceipt(chainId, approveHash);
        if (cancelled.current) return;
        if (approveResult === 'reverted') {
          setError('The bridge approval failed on-chain. Please try again.');
          setPhase('error');
          return;
        }
        if (approveResult === 'timeout') {
          setError('The bridge approval is still confirming on-chain. Give it a moment, then try again.');
          setPhase('error');
          return;
        }

        // Leg 2b: sign + send the EVM-side bridge tx with the embedded wallet.
        // Privy sponsors GAS but not a native `value`; the pre-flight + post-quote
        // guards above already rejected any route that attaches one, so `value`
        // here is "0" (we still pass it through verbatim).
        setPhase('signing');
        const hash = await adapter.sendTransaction({
          to: q.evmTransaction.to,
          data: q.evmTransaction.data,
          value: q.evmTransaction.value,
          chainId,
        });
        setTxHash(hash);
        // The EVM bridge tx is SUBMITTED, not confirmed: no RPC client is wired
        // here to await a receipt, and the TON-side settlement is asynchronous.
        // 'done' therefore means "submitted / on its way" (the WithdrawSheet copy
        // matches), not "complete". Don't fabricate a confirmed/'bridging' state.
        setPhase('done');
      } catch (e) {
        if (cancelled.current) return;
        setError(e instanceof Error ? e.message : 'Withdraw failed.');
        setPhase('error');
      }
    },
    [evmAddress, adapter, rawTonAddress, perps, withdrawToWallet, waitForArrival, waitForReceipt, requestWithdrawQuote],
  );

  /** Send all Ethereum USDC held by the embedded wallet to the user-confirmed
   * recovery address. This bypasses the product and TON bridge entirely. */
  const recoverToEvm = useCallback(async (safeBalance: number) => {
    cancelled.current = false;
    setError(null);
    setTxHash(null);
    if (!evmAddress || !adapter?.sendTransaction) {
      setError('Wallet not ready.');
      setPhase('error');
      return;
    }
    try {
      const pre = await getWalletUsdc(evmAddress, 'ethereum');
      const safeAmount = truncTo(safeBalance, USDC_DECIMALS);
      let balance = pre;

      // The stranded balance normally sits in the Compass Safe, not the owner
      // wallet. Pull it out first and wait for the on-chain arrival before
      // building the one-way recovery transfer.
      if (safeAmount > 0) {
        setPhase('withdrawing');
        await withdrawToWallet(safeAmount.toFixed(USDC_DECIMALS));
        setPhase('waiting');
        const arrival = await waitForArrival('ethereum', pre);
        if (!arrival.arrived) {
          throw new Error('Safe withdrawal is still confirming. Wait a moment, then try recovery again.');
        }
        balance = arrival.balance;
      }
      const recoverable = truncTo(balance, USDC_DECIMALS);
      if (recoverable <= 0) throw new Error('No USDC is available in the embedded wallet.');

      setPhase('signing');
      const hash = await adapter.sendTransaction({
        to: FUNDING_TARGETS.tokenized.token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [RECOVERY_EVM_ADDRESS, parseUnits(recoverable.toFixed(USDC_DECIMALS), USDC_DECIMALS)],
        }),
        chainId: FUNDING_TARGETS.tokenized.chainId,
      });
      setTxHash(hash);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recovery transfer failed.');
      setPhase('error');
    }
  }, [evmAddress, adapter, withdrawToWallet, waitForArrival]);

  return { phase, error, quote, txHash, start, recoverToEvm, reset };
}
