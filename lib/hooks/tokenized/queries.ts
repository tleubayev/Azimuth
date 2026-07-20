'use client';

/**
 * Tokenized assets (Ondo equities + Midas RWA) read hooks — GET via the
 * /api/compass proxy (`tokenized-assets/*`), chain ethereum. Replaces
 * TokenizedAssetsWidget's hooks.
 */

import { useQuery } from '@tanstack/react-query';
import { useWallet } from '@/lib/contexts/wallet-context';
import { compassGet, compassPost, CompassError, pickNum, pickStr, pickBool } from '@/lib/compass/client';
import { equityStatusFromProbeError, type EquityMarketStatus } from '@/lib/tokenized/marketStatus';
import { parseTradingStatus } from '@/lib/tokenized/tradingStatus';
import {
  PERIOD_PARAMS,
  type TokenizedMarket,
  type TokenizedMarketDetail,
  type TokenizedPosition,
  type TokenizedPositionsResult,
  type TokenizedActivityItem,
  type TokenizedEventType,
  type TokenizedPnl,
  type TokenizedAccount,
  type TokenizedAssetClass,
  type TokenizedProvider,
  type TokenizedPeriod,
  type Candle,
} from '@/lib/compass/types';

export const TOKENIZED_CHAIN = 'ethereum';

type Loose = Record<string, unknown>;

function normMarket(r: Loose): TokenizedMarket {
  return {
    symbol: pickStr(r, 'symbol') ?? '',
    underlyingTicker: pickStr(r, 'underlying_ticker', 'underlyingTicker') ?? pickStr(r, 'symbol') ?? '',
    name: pickStr(r, 'name') ?? '',
    contractAddress: pickStr(r, 'contract_address', 'contractAddress') ?? '',
    decimals: pickNum(r, 'decimals') ?? 18,
    currentPriceUsd: pickNum(r, 'current_price_usd', 'currentPriceUsd', 'price'),
    change24hUsd: pickNum(r, 'change_24h_usd', 'change24hUsd'),
    change24hPct: pickNum(r, 'change_24h_pct', 'change24hPct'),
    sectors: (Array.isArray(r.sectors) ? r.sectors : []) as string[],
    provider: (pickStr(r, 'provider') ?? 'ondo') as TokenizedProvider,
    assetClass: (pickStr(r, 'asset_class', 'assetClass') ?? 'EQUITY') as TokenizedAssetClass,
    chain: pickStr(r, 'chain') ?? TOKENIZED_CHAIN,
    apy7d: pickNum(r, 'apy_7d', 'apy7d'),
    tvlUsd: pickNum(r, 'tvl_usd', 'tvlUsd'),
    status: parseTradingStatus(r.status),
  };
}

function normPnl(raw: unknown): TokenizedPnl | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Loose;
  const totalDeposited = pickNum(r, 'total_deposited', 'totalDeposited');
  if (totalDeposited == null) return null;
  return {
    totalDeposited,
    currentValue: pickNum(r, 'current_value', 'currentValue') ?? 0,
    unrealizedPnl: pickNum(r, 'unrealized_pnl', 'unrealizedPnl') ?? 0,
    realizedPnl: pickNum(r, 'realized_pnl', 'realizedPnl') ?? 0,
    totalPnl: pickNum(r, 'total_pnl', 'totalPnl') ?? 0,
    totalPnlPercent: pickNum(r, 'total_pnl_percent', 'totalPnlPercent') ?? 0,
  };
}

export function pnlIsDisplayable(pnl: TokenizedPnl | null): pnl is TokenizedPnl {
  return !!pnl && pnl.totalDeposited > 0;
}

function normPosition(r: Loose): TokenizedPosition {
  return {
    symbol: pickStr(r, 'symbol') ?? '',
    underlyingTicker: pickStr(r, 'underlying_ticker', 'underlyingTicker') ?? pickStr(r, 'symbol') ?? '',
    name: pickStr(r, 'name') ?? '',
    balance: pickStr(r, 'balance') ?? '0',
    currentPriceUsd: pickNum(r, 'current_price_usd', 'currentPriceUsd'),
    balanceUsd: pickNum(r, 'balance_usd', 'balanceUsd'),
    assetClass: (pickStr(r, 'asset_class', 'assetClass') ?? 'EQUITY') as TokenizedAssetClass,
    pnl: normPnl(r.pnl),
  };
}

/**
 * Flatten one position's `events[]` into activity items, stamping each with the
 * position's symbol/ticker (the events themselves only carry token/USDC legs).
 */
function normActivity(r: Loose): TokenizedActivityItem[] {
  const symbol = pickStr(r, 'symbol') ?? '';
  const underlyingTicker = pickStr(r, 'underlying_ticker', 'underlyingTicker') ?? symbol;
  const events = Array.isArray(r.events) ? (r.events as Loose[]) : [];
  return events.map((e, i) => {
    const txHash = pickStr(e, 'transaction_hash', 'transactionHash') ?? '';
    const ts = pickStr(e, 'block_timestamp', 'blockTimestamp');
    const parsed = ts ? Date.parse(ts) : NaN;
    return {
      id: `${txHash || symbol}-${i}`,
      eventType: (pickStr(e, 'event_type', 'eventType') ?? 'buy') as TokenizedEventType,
      symbol,
      underlyingTicker,
      timeMs: Number.isFinite(parsed) ? parsed : 0,
      txHash,
      inputAmount: pickStr(e, 'input_amount', 'inputAmount'),
      inputSymbol: pickStr(e, 'input_symbol', 'inputSymbol'),
      outputAmount: pickStr(e, 'output_amount', 'outputAmount'),
      outputSymbol: pickStr(e, 'output_symbol', 'outputSymbol'),
      costPerUnit: pickStr(e, 'cost_per_unit', 'costPerUnit'),
      realizedPnl: pickStr(e, 'realized_pnl', 'realizedPnl'),
    };
  });
}

export function useTokenizedMarkets() {
  const q = useQuery({
    queryKey: ['tokenized', 'markets', TOKENIZED_CHAIN],
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const data = await compassGet<Loose>('tokenized-assets/markets', { chain: TOKENIZED_CHAIN });
      const arr = (data.markets ?? data) as Loose[];
      return Array.isArray(arr) ? arr.map(normMarket) : [];
    },
  });
  return { markets: q.data ?? [], isLoading: q.isLoading, isError: q.isError, error: q.error, refetch: q.refetch };
}

function isoToUnix(s: string | null): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

export function useTokenizedMarketDetail(symbol: string | null, period: TokenizedPeriod) {
  const { interval, range } = PERIOD_PARAMS[period];
  const q = useQuery({
    queryKey: ['tokenized', 'market-detail', symbol, TOKENIZED_CHAIN, interval, range],
    enabled: !!symbol,
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<TokenizedMarketDetail> => {
      const r = await compassGet<Loose>(`tokenized-assets/markets/${encodeURIComponent(symbol!)}`, { chain: TOKENIZED_CHAIN, interval, range });
      const base = normMarket(r);
      const candles: Candle[] = (Array.isArray(r.candles) ? (r.candles as Loose[]) : []).map((c) => ({
        time: isoToUnix(pickStr(c, 'timestamp', 'time')),
        open: pickNum(c, 'open') ?? 0,
        high: pickNum(c, 'high') ?? 0,
        low: pickNum(c, 'low') ?? 0,
        close: pickNum(c, 'close') ?? 0,
      }));
      return {
        ...base,
        candles,
        priceHigh52w: pickNum(r, 'price_high_52w', 'priceHigh52w'),
        priceLow52w: pickNum(r, 'price_low_52w', 'priceLow52w'),
        volume24h: pickNum(r, 'volume_24h', 'volume24h'),
        marketCap: pickNum(r, 'market_cap', 'marketCap'),
      };
    },
  });
  return { detail: q.data ?? null, isLoading: q.isLoading, isError: q.isError };
}

export function useTokenizedPositions() {
  const { evmAddress } = useWallet();
  const q = useQuery({
    queryKey: ['tokenized', 'positions', evmAddress, TOKENIZED_CHAIN],
    enabled: !!evmAddress,
    staleTime: 15_000,
    refetchInterval: 20_000,
    queryFn: async (): Promise<TokenizedPositionsResult> => {
      const data = await compassGet<Loose>('tokenized-assets/positions', { owner: evmAddress!, chain: TOKENIZED_CHAIN });
      const rows = Array.isArray(data.positions) ? (data.positions as Loose[]) : [];
      return {
        positions: rows.map(normPosition),
        totalUsd: pickNum(data, 'total_usd', 'totalUsd') ?? 0,
        accountPnl: normPnl(data.pnl),
        // One chronological feed across all positions, newest first.
        activity: rows.flatMap(normActivity).sort((a, b) => b.timeMs - a.timeMs),
      };
    },
  });
  return {
    positions: q.data?.positions ?? [],
    totalUsd: q.data?.totalUsd ?? 0,
    accountPnl: q.data?.accountPnl ?? null,
    activity: q.data?.activity ?? [],
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
  };
}

/**
 * Chronological Spot activity (buy / sell / transfer in/out) for the owner's
 * tokenized positions. The events ride along on the `/positions` response, so
 * this reuses that query (React Query dedups by key — no extra request) and just
 * surfaces the already-flattened, time-sorted feed.
 */
export function useTokenizedActivity() {
  const { activity, isLoading, isError } = useTokenizedPositions();
  return { activity, isLoading, isError };
}

export function useTokenizedAccount() {
  const { evmAddress } = useWallet();
  const q = useQuery({
    queryKey: ['tokenized', 'account', evmAddress, TOKENIZED_CHAIN],
    enabled: !!evmAddress,
    staleTime: 30_000,
    queryFn: async (): Promise<TokenizedAccount> => {
      const data = await compassGet<Loose>('tokenized-assets/check', { owner: evmAddress!, chain: TOKENIZED_CHAIN });
      const accountAddress = pickStr(data, 'account_address', 'accountAddress');
      const isDeployed = pickBool(data, 'is_deployed', 'isDeployed') ?? false;
      const needsCreation = pickBool(data, 'needs_creation', 'needsCreation') ?? !isDeployed;
      return { accountAddress, isDeployed, needsCreation };
    },
  });
  return {
    accountAddress: q.data?.accountAddress ?? null,
    isDeployed: q.data?.isDeployed ?? false,
    needsCreation: q.data?.needsCreation ?? false,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
  };
}

/** USDC notional for the read-only market-status probe (any equity works). */
const MARKET_STATUS_PROBE_USD = '100';

/**
 * Is the U.S. equity market open right now? Fires a cheap, read-only `/quote`
 * probe (no order committed) for a reference equity and reads the upstream
 * 1inch/Ondo signal: a clean quote ⇒ `open`, a "market is closed" error ⇒
 * `closed`. All equities share U.S. market hours, so one probe answers for every
 * stock; Midas RWA never trades through Fusion, so it's unaffected (always open).
 *
 * Fail-open: any other error (no account, network, rate-limit) ⇒ `unknown`, and
 * the UI does NOT block on it — the order flow's own closed-market handling is
 * the backstop. Requires a deployed Spot account (the `/quote` precondition),
 * which the trading screens always have; pre-account it stays disabled.
 */
export function useEquityMarketStatus() {
  const { evmAddress } = useWallet();
  const { markets } = useTokenizedMarkets();
  const { isDeployed } = useTokenizedAccount();
  const reference = markets.find((m) => m.provider !== 'midas' && m.assetClass === 'EQUITY') ?? null;
  const q = useQuery({
    queryKey: ['tokenized', 'market-status', evmAddress, reference?.symbol, TOKENIZED_CHAIN],
    enabled: !!evmAddress && !!reference && isDeployed,
    staleTime: 45_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<EquityMarketStatus> => {
      try {
        await compassPost('tokenized-assets/quote', {
          chain: TOKENIZED_CHAIN,
          owner: evmAddress,
          from_token: 'USDC',
          to_token: reference!.symbol,
          amount: MARKET_STATUS_PROBE_USD,
        });
        return 'open';
      } catch (e) {
        // The probe is a read-only "can a stock be quoted right now?" check. If
        // even that fails with an upstream venue error (5xx), equities can't
        // trade — a closed market (incl. holidays the weekend clock can't see) or
        // a Fusion outage — so report closed and let the Spot screen show the
        // banner + gate trading. Auth / rate-limit / 4xx stay 'unknown'.
        return equityStatusFromProbeError(e, e instanceof CompassError ? e.status : 0);
      }
    },
  });
  const status: EquityMarketStatus = q.data ?? 'unknown';
  return { status, isClosed: status === 'closed', isLoading: q.isLoading };
}

/** USDC balance of any address on Ethereum (owner wallet or the Safe). */
export function useEthUsdc(address: string | null | undefined) {
  const q = useQuery({
    queryKey: ['walletUsdcBalance', TOKENIZED_CHAIN, address],
    enabled: !!address,
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const data = await compassGet<Loose>('token/balance', { address: address!, chain: TOKENIZED_CHAIN, token: 'USDC' });
      return pickNum(data, 'balance') ?? 0;
    },
  });
  return { usdc: q.data ?? 0, isLoading: q.isLoading, refetch: q.refetch };
}
