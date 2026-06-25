'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SendTransactionRequest } from '@tonconnect/ui-react';
import { useTon } from '@/lib/hooks/useTon';
import { useWallet } from '@/lib/contexts/wallet-context';
import { FUNDING_TARGETS, type FundingTargetKey } from '@/lib/config/chains';
import { depositToProduct, depositableAmount, getWalletUsdc } from '@/lib/deposit/deposit';
import type { BridgeQuoteResponse } from '@/lib/bridge/types';

/**
 * "Add funds" = TWO legs:
 *   1. fund USDC into the embedded EVM wallet — via the Symbiosis TON bridge, OR
 *      via Halliday "Buy with card" (fiat → USDC on Ethereum) — and
 *   2. deposit that USDC into the product account (Hyperliquid bridge / tokenized Safe).
 *
 * Phases: idle → quoting → quoted → signing → bridging | awaiting_funds (poll for
 *         arrival) → depositing → done | error. A pre-existing wallet balance can be
 *         deposited directly via depositExisting() (skips the funding leg).
 *
 * `bridging` (TON bridge) and `awaiting_funds` (card on-ramp) share the SAME
 * arrival semantics — "watch wallet USDC, auto-deposit on arrival" — and reuse the
 * single poll effect below. Only the funding leg differs (TON sign vs. card).
 */
export type FundingPhase =
  | 'idle'
  | 'quoting'
  | 'quoted'
  | 'signing'
  | 'bridging'
  | 'awaiting_funds'
  | 'depositing'
  | 'done'
  | 'error';

const POLL_INTERVAL_MS = 12_000;
const POLL_FIRST_DELAY_MS = 8_000;
const POLL_DEADLINE_MS = 12 * 60 * 1000;

export function useFunding() {
  const { rawTonAddress, sendTransaction: sendTon } = useTon();
  const { evmAddress, adapter } = useWallet();

  const [phase, setPhase] = useState<FundingPhase>('idle');
  const [activeTarget, setActiveTarget] = useState<FundingTargetKey | null>(null);
  const [quote, setQuote] = useState<BridgeQuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Current USDC balance of the embedded wallet on the active target's chain. */
  const [walletUsdc, setWalletUsdc] = useState<number | null>(null);
  const [depositTxHash, setDepositTxHash] = useState<string | null>(null);

  const quotedFor = useRef<{ fromTon: string; toEvm: string } | null>(null);
  const preBalanceRef = useRef(0); // wallet USDC before the bridge, to detect arrival
  const depositingRef = useRef(false); // guard against a double deposit
  const doDepositRef = useRef<(t: FundingTargetKey, bal: number) => void>(() => {});

  const reset = useCallback(() => {
    setPhase('idle');
    setActiveTarget(null);
    setQuote(null);
    setError(null);
    setWalletUsdc(null);
    setDepositTxHash(null);
    quotedFor.current = null;
    preBalanceRef.current = 0;
    depositingRef.current = false;
  }, []);

  const refreshBalance = useCallback(
    async (targetKey: FundingTargetKey): Promise<number> => {
      if (!evmAddress) return 0;
      const bal = await getWalletUsdc(evmAddress, FUNDING_TARGETS[targetKey].chainName);
      setWalletUsdc(bal);
      return bal;
    },
    [evmAddress],
  );

  /** Deposit `bal` worth of wallet USDC into the product account. */
  const doDeposit = useCallback(
    async (targetKey: FundingTargetKey, bal: number) => {
      if (depositingRef.current) return;
      const target = FUNDING_TARGETS[targetKey];
      const amt = depositableAmount(target, bal);
      if (!amt) {
        setError(
          `Only $${bal.toFixed(2)} arrived — below the $${target.minUsd} minimum to fund ${target.label}.`,
        );
        setPhase('error');
        return;
      }
      if (!evmAddress || !adapter?.sendTransaction) {
        setError('Wallet not ready.');
        setPhase('error');
        return;
      }
      depositingRef.current = true;
      setPhase('depositing');
      setError(null);
      try {
        const tx = await depositToProduct({ targetKey, owner: evmAddress, amountUsdc: amt, adapter });
        setDepositTxHash(tx);
        setPhase('done');
        void refreshBalance(targetKey);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Deposit failed.');
        setPhase('error');
      } finally {
        depositingRef.current = false;
      }
    },
    [evmAddress, adapter, refreshBalance],
  );
  doDepositRef.current = doDeposit;

  // Poll for incoming funds while awaiting arrival (TON bridge OR card on-ramp);
  // auto-deposit once they land. Both funding legs share this exact machinery.
  useEffect(() => {
    if ((phase !== 'bridging' && phase !== 'awaiting_funds') || !activeTarget || !evmAddress) return;
    const target = FUNDING_TARGETS[activeTarget];
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + POLL_DEADLINE_MS;

    const tick = async () => {
      const bal = await getWalletUsdc(evmAddress, target.chainName);
      if (cancelled) return;
      setWalletUsdc(bal);
      if (bal > preBalanceRef.current + 0.01) {
        doDepositRef.current(activeTarget, bal); // arrived → deposit
        return;
      }
      if (Date.now() > deadline) {
        setError('Funds are taking longer than usual to arrive. Tap “Deposit” once your balance updates.');
        return; // stop polling; the sheet shows a manual deposit button
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    timer = setTimeout(tick, POLL_FIRST_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase, activeTarget, evmAddress]);

  const getQuote = useCallback(
    async (targetKey: FundingTargetKey, amount: string) => {
      setError(null);
      setQuote(null);
      setActiveTarget(targetKey);
      if (!rawTonAddress) {
        setError('Connect your TON wallet first.');
        setPhase('error');
        return;
      }
      if (!evmAddress) {
        setError('Embedded wallet not ready yet.');
        setPhase('error');
        return;
      }
      const num = Number(amount);
      if (!Number.isFinite(num) || num <= 0) {
        setError('Enter a valid amount.');
        setPhase('error');
        return;
      }
      const { bridgeMinUsd, label } = FUNDING_TARGETS[targetKey];
      if (bridgeMinUsd && num < bridgeMinUsd) {
        setError(`Minimum to bridge into ${label} is $${bridgeMinUsd}.`);
        setPhase('error');
        return;
      }
      setPhase('quoting');
      try {
        const res = await fetch('/api/bridge/quote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetKey, amount, fromTon: rawTonAddress, toEvm: evmAddress }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            detail?: string;
          };
          const base = body.error ?? `Quote failed (${res.status})`;
          throw new Error(body.detail ? `${base} (${body.detail})` : base);
        }
        const data = (await res.json()) as BridgeQuoteResponse;
        setQuote(data);
        quotedFor.current = { fromTon: rawTonAddress, toEvm: evmAddress };
        setPhase('quoted');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Quote failed');
        setPhase('error');
      }
    },
    [rawTonAddress, evmAddress],
  );

  /** Sign the TON-side bridge tx, then poll for arrival + auto-deposit. */
  const confirm = useCallback(async () => {
    if (!quote?.tonTransaction || !activeTarget) {
      setError('No quote to confirm.');
      setPhase('error');
      return;
    }
    if (!quotedFor.current || quotedFor.current.fromTon !== rawTonAddress || quotedFor.current.toEvm !== evmAddress) {
      setError('Your wallet changed since the quote — please get a new quote.');
      setQuote(null);
      setPhase('error');
      return;
    }
    setPhase('signing');
    try {
      // Snapshot the wallet balance so we can detect the bridged funds arriving.
      preBalanceRef.current = evmAddress
        ? await getWalletUsdc(evmAddress, FUNDING_TARGETS[activeTarget].chainName)
        : 0;
      const tx = quote.tonTransaction;
      const req: SendTransactionRequest = {
        validUntil: tx.validUntil,
        messages: tx.messages.map((m) => ({
          address: m.address,
          amount: m.amount,
          payload: m.payload,
          stateInit: m.stateInit,
        })),
        ...(tx.network ? { network: tx.network as SendTransactionRequest['network'] } : {}),
      };
      await sendTon(req);
      setPhase('bridging');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signing was cancelled');
      setPhase('error');
    }
  }, [quote, activeTarget, rawTonAddress, evmAddress, sendTon]);

  /** Deposit the wallet's existing USDC into the product (no bridge). */
  const depositExisting = useCallback(
    async (targetKey: FundingTargetKey) => {
      setActiveTarget(targetKey);
      setError(null);
      const bal = await refreshBalance(targetKey);
      await doDeposit(targetKey, bal);
    },
    [refreshBalance, doDeposit],
  );

  /**
   * Start the "Buy with card" (Halliday) funding leg: snapshot the wallet's
   * pre-purchase USDC balance, then enter `awaiting_funds` so the existing poll
   * effect watches for the card-delivered USDC and auto-deposits it on arrival —
   * identical machinery to the TON bridge, only the funding leg differs.
   *
   * Returns `true` once the poll has started, `false` if it could not (no embedded
   * wallet yet). Resolving the snapshot before flipping the phase ensures the first
   * poll tick compares against the true pre-balance, not 0.
   */
  const startCardFunding = useCallback(
    async (targetKey: FundingTargetKey): Promise<boolean> => {
      setError(null);
      setActiveTarget(targetKey);
      if (!evmAddress) {
        setError('Embedded wallet not ready yet.');
        setPhase('error');
        return false;
      }
      depositingRef.current = false;
      // Snapshot the current balance so the poll detects only the NEW card funds.
      preBalanceRef.current = await getWalletUsdc(
        evmAddress,
        FUNDING_TARGETS[targetKey].chainName,
      );
      setWalletUsdc(preBalanceRef.current);
      setPhase('awaiting_funds');
      return true;
    },
    [evmAddress],
  );

  return {
    phase,
    activeTarget,
    quote,
    error,
    walletUsdc,
    depositTxHash,
    getQuote,
    confirm,
    depositExisting,
    startCardFunding,
    refreshBalance,
    reset,
  };
}

export type UseFunding = ReturnType<typeof useFunding>;
