'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '@/lib/contexts/wallet-context';
import { compassGet, compassPost, pickStr, pickNum } from '@/lib/compass/client';
import { TOKENIZED_CHAIN } from './queries';
import { isMarketClosedError } from '@/lib/tokenized/marketStatus';
import { SPOT_FEE_ENABLED } from '@/lib/config/tokenized';
import type { EquityQuote, OrderStatus, TypedData } from '@/lib/compass/types';

/** Friendly copy when an equity quote/order bounces because the market is closed. */
const MARKET_CLOSED_MESSAGE = 'U.S. market is closed. Tokenized stocks can be traded again when it reopens.';

type Loose = Record<string, unknown>;
type Side = 'buy' | 'sell';

/** setTimeout sleep that resolves early (true) when the signal aborts. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(true);
    const onAbort = () => { clearTimeout(t); resolve(true); };
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(false); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const MIN_ORDER_USD = 25;
const MAX_ORDER_USD = 10_000;
export const TOKENIZED_LIMITS = { MIN_ORDER_USD, MAX_ORDER_USD };

/* ─────────────────────── Create the per-owner Safe account ────────────────── */

export function useCreateTokenizedAccount() {
  const { evmAddress } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createAccount = useCallback(async () => {
    if (!evmAddress) throw new Error('Wallet not ready');
    setBusy(true);
    setError(null);
    try {
      const data = await compassPost<Loose>('tokenized-assets/create-account', { owner: evmAddress, chain: TOKENIZED_CHAIN });
      return {
        accountAddress: pickStr(data, 'account_address', 'accountAddress'),
        txHash: pickStr(data, 'tx_hash', 'txHash'),
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create account');
      throw e;
    } finally {
      setBusy(false);
    }
  }, [evmAddress]);

  return { createAccount, busy, error };
}

/* ─────────────────────── EQUITY — Fusion order flow ───────────────────────── */

export type EquityPhase =
  | 'idle'
  | 'quoting'
  | 'quoted'
  | 'approving'
  | 'signing'
  | 'submitting'
  | 'polling'
  | 'done'
  | 'error';

export interface EquityResult {
  status: OrderStatus;
  fillTxHash: string | null;
  orderHash: string;
}

export function useEquityOrder() {
  const { adapter, evmAddress } = useWallet();
  const [phase, setPhase] = useState<EquityPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<EquityQuote | null>(null);
  const [result, setResult] = useState<EquityResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sign = useCallback(
    (d: TypedData) => {
      if (!adapter?.signTypedData) throw new Error('Wallet not ready');
      return adapter.signTypedData(d);
    },
    [adapter],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('idle');
    setError(null);
    setQuote(null);
    setResult(null);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const tokens = (side: Side, symbol: string) =>
    side === 'buy' ? { from_token: 'USDC', to_token: symbol } : { from_token: symbol, to_token: 'USDC' };

  const getQuote = useCallback(
    async (side: Side, symbol: string, amount: string): Promise<EquityQuote | null> => {
      if (!evmAddress) throw new Error('Wallet not ready');
      setPhase('quoting');
      setError(null);
      try {
        const data = await compassPost<Loose>('tokenized-assets/quote', {
          chain: TOKENIZED_CHAIN,
          owner: evmAddress,
          ...tokens(side, symbol),
          amount,
        });
        const qq = (data.quote ?? {}) as Loose;
        const out = (qq.output ?? {}) as Loose;
        const q: EquityQuote = {
          recommendedSlippageBps: pickNum(data, 'recommended_slippage_bps', 'recommendedSlippageBps') ?? 100,
          amountOut: pickStr(out, 'amount'),
          outSymbol: pickStr(out, 'symbol'),
          estFillSeconds: pickNum(qq, 'est_fill_seconds', 'estFillSeconds'),
        };
        setQuote(q);
        setPhase('quoted');
        return q;
      } catch (e) {
        setError(isMarketClosedError(e) ? MARKET_CLOSED_MESSAGE : e instanceof Error ? e.message : 'Quote failed');
        setPhase('error');
        return null;
      }
    },
    [evmAddress],
  );

  const pollUntilTerminal = useCallback(async (orderHash: string, signal: AbortSignal): Promise<EquityResult> => {
    for (let i = 0; i < 20; i++) {
      if (signal.aborted) return { status: 'pending', fillTxHash: null, orderHash };
      const aborted = await abortableSleep(3_000, signal);
      if (aborted || signal.aborted) return { status: 'pending', fillTxHash: null, orderHash };
      try {
        const s = await compassGet<Loose>(`tokenized-assets/order/${orderHash}`);
        const status = (pickStr(s, 'status') ?? 'pending') as OrderStatus;
        const fillTxHash = pickStr(s, 'fill_tx_hash', 'fillTxHash');
        if (status === 'filled' || status === 'expired' || status === 'cancelled') {
          return { status, fillTxHash, orderHash };
        }
      } catch {
        /* transient — keep polling */
      }
    }
    return { status: 'pending', fillTxHash: null, orderHash };
  }, []);

  /**
   * Charge the partner fee on a filled sell's realized USDC proceeds. Equity
   * orders fill off-chain, so the fee can't ride inside the trade — the custom
   * `charge_fee` route injects our recipient server-side and returns a USDC
   * transfer to sign. Seamless: the embedded wallet auto-signs (no prompt). The
   * caller runs this best-effort, so a fee hiccup never fails a settled trade.
   */
  const chargeFee = useCallback(
    async (orderHash: string): Promise<void> => {
      if (!evmAddress) return;
      const data = await compassPost<Loose>(`tokenized-assets/order/${orderHash}/charge_fee`, {
        owner: evmAddress,
        gas_sponsorship: true,
      });
      const eip = ((data.eip_712 ?? data.eip712) ?? null) as TypedData | null;
      if (!eip) return;
      const signature = await sign(eip);
      await compassPost('tokenized-assets/approve-execute', {
        owner: evmAddress,
        eip712: eip,
        signature,
        chain: TOKENIZED_CHAIN,
      });
    },
    [evmAddress, sign],
  );

  const confirm = useCallback(
    async (side: Side, symbol: string, amount: string, slippageBps: number): Promise<EquityResult | null> => {
      if (!evmAddress) throw new Error('Wallet not ready');
      setError(null);
      try {
        // 1. Build the order (+ optional approval).
        const build = await compassPost<Loose>('tokenized-assets/build-order', {
          chain: TOKENIZED_CHAIN,
          owner: evmAddress,
          ...tokens(side, symbol),
          amount,
          slippage_bps: slippageBps,
        });

        // 2. Approval, if the Safe hasn't approved the maker contract yet.
        const approval = (build.approval_safe_tx_eip712 ?? build.approvalSafeTxEip712) as TypedData | null;
        if (approval) {
          setPhase('approving');
          const approvalSig = await sign(approval);
          await compassPost('tokenized-assets/approve-execute', { owner: evmAddress, eip712: approval, signature: approvalSig });
        }

        // 3. Sign the order (Safe message / ERC-1271).
        const order = (build.order ?? {}) as Loose;
        const orderEip712 = (order.safe_message_eip712 ?? order.safeMessageEip712) as TypedData;
        setPhase('signing');
        const orderSig = await sign(orderEip712);

        // 4. Submit.
        setPhase('submitting');
        const submit = await compassPost<Loose>('tokenized-assets/submit-order', {
          signed_order: order.order_message ?? order.orderMessage,
          signature: orderSig,
          extension: order.extension,
          quote_id: order.quote_id ?? order.quoteId,
          order_hash: order.order_hash ?? order.orderHash,
        });
        const orderHash = pickStr(submit, 'order_hash', 'orderHash') ?? pickStr(order, 'order_hash', 'orderHash');
        // No hash means we can't track the order — polling an empty hash burns
        // 60s and lands on a misleading terminal state, so surface it instead.
        if (!orderHash) throw new Error('Submit succeeded but order hash missing');

        // 5. Poll to a terminal state (filled/expired/cancelled).
        setPhase('polling');
        // Cancel any in-flight poll from a previous confirm so a stale poll
        // can't overwrite this run's result/phase.
        abortRef.current?.abort();
        abortRef.current = new AbortController();
        const res = await pollUntilTerminal(orderHash, abortRef.current.signal);
        setResult(res);

        // Partner fee — charge on the realized USDC proceeds of a FILLED sell
        // only. Best-effort + seamless: the embedded wallet auto-signs and the
        // trade has already settled, so a fee hiccup must never surface as a
        // trade failure (or block the user's success state).
        if (side === 'sell' && res.status === 'filled' && SPOT_FEE_ENABLED) {
          await chargeFee(orderHash).catch(() => {
            /* non-blocking — the sell already settled */
          });
        }

        setPhase('done');
        return res;
      } catch (e) {
        setError(isMarketClosedError(e) ? MARKET_CLOSED_MESSAGE : e instanceof Error ? e.message : 'Order failed');
        setPhase('error');
        return null;
      }
    },
    [evmAddress, sign, pollUntilTerminal, chargeFee],
  );

  return { phase, error, quote, result, getQuote, confirm, reset };
}

/* ─────────────────────── RWA YIELD — swap flow (one tx) ────────────────────── */

export type SwapPhase = 'idle' | 'reviewing' | 'quoted' | 'signing' | 'broadcasting' | 'done' | 'error';

export function useRwaSwap() {
  const { adapter, evmAddress } = useWallet();
  const [phase, setPhase] = useState<SwapPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [estimatedOut, setEstimatedOut] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const eip712Ref = useRef<TypedData | null>(null);

  const sign = useCallback(
    (d: TypedData) => {
      if (!adapter?.signTypedData) throw new Error('Wallet not ready');
      return adapter.signTypedData(d);
    },
    [adapter],
  );

  const reset = useCallback(() => {
    setPhase('idle');
    setError(null);
    setEstimatedOut(null);
    setTxHash(null);
    eip712Ref.current = null;
  }, []);

  const review = useCallback(
    async (side: Side, symbol: string, amountIn: string, slippage: string) => {
      if (!evmAddress) throw new Error('Wallet not ready');
      setPhase('reviewing');
      setError(null);
      try {
        const tokenIn = side === 'buy' ? 'USDC' : symbol;
        const tokenOut = side === 'buy' ? symbol : 'USDC';
        const data = await compassPost<Loose>(`tokenized-assets/${side}`, {
          token_in: tokenIn,
          token_out: tokenOut,
          amount_in: amountIn,
          slippage,
          owner: evmAddress,
          chain: TOKENIZED_CHAIN,
          gas_sponsorship: true,
        });
        // The transact/buy|sell endpoint is a raw passthrough → snake_case `eip_712`.
        const eip = ((data.eip_712 ?? data.eip712) ?? null) as TypedData | null;
        if (!eip) throw new Error('Trade signing payload missing — please try again.');
        eip712Ref.current = eip;
        const out = pickStr(data, 'estimated_amount_out', 'estimatedAmountOut');
        setEstimatedOut(out);
        setPhase('quoted');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Quote failed');
        setPhase('error');
      }
    },
    [evmAddress],
  );

  const confirm = useCallback(async (): Promise<string | null> => {
    if (!evmAddress || !eip712Ref.current) {
      setError('Nothing to confirm');
      setPhase('error');
      return null;
    }
    try {
      setPhase('signing');
      const signature = await sign(eip712Ref.current);
      setPhase('broadcasting');
      const data = await compassPost<Loose>('tokenized-assets/approve-execute', {
        owner: evmAddress,
        eip712: eip712Ref.current,
        signature,
        chain: TOKENIZED_CHAIN,
      });
      const hash = pickStr(data, 'tx_hash', 'txHash');
      setTxHash(hash);
      setPhase('done');
      return hash;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Trade failed');
      setPhase('error');
      return null;
    }
  }, [evmAddress, sign]);

  return { phase, error, estimatedOut, txHash, review, confirm, reset };
}

/* ─────────────── Withdraw USDC from the Safe to the embedded wallet ────────── */

export function useTokenizedWithdraw() {
  const { adapter, evmAddress } = useWallet();

  const sign = useCallback(
    (d: TypedData) => {
      if (!adapter?.signTypedData) throw new Error('Wallet not ready');
      return adapter.signTypedData(d);
    },
    [adapter],
  );

  /** Build → sign Safe message → broadcast (gas-sponsored). Returns tx hash. */
  const withdrawToWallet = useCallback(
    async (amount: string): Promise<string | null> => {
      if (!evmAddress) throw new Error('Wallet not ready');
      const build = await compassPost<Loose>('tokenized-assets/build-withdraw', { owner: evmAddress, amount });
      const eip712 = (build.safe_tx_eip712 ?? build.safeTxEip712) as TypedData;
      const signature = await sign(eip712);
      const data = await compassPost<Loose>('tokenized-assets/approve-execute', { owner: evmAddress, eip712, signature });
      return pickStr(data, 'tx_hash', 'txHash');
    },
    [evmAddress, sign],
  );

  return { withdrawToWallet };
}
