'use client';

/**
 * Hyperliquid perps read hooks — GET via the /api/compass proxy
 * (`global-markets-perps/*`). Replaces TraditionalInvestingWidget's hooks.
 */

import { useQuery } from '@tanstack/react-query';
import { useWallet } from '@/lib/contexts/wallet-context';
import { compassGet, compassPost, pickNum, pickStr, pickBool } from '@/lib/compass/client';
import type {
  PerpsMarket,
  PerpsPosition,
  PerpsPositionsResult,
  PerpsActivityItem,
  PerpsSide,
  Candle,
  CandleInterval,
  PerpsPrepare,
  TypedData,
} from '@/lib/compass/types';

type Loose = Record<string, unknown>;

function normMarket(r: Loose): PerpsMarket {
  return {
    asset: pickStr(r, 'asset', 'name', 'coin') ?? '',
    assetId: pickNum(r, 'asset_id', 'assetId'),
    category: pickStr(r, 'category') ?? 'crypto',
    markPrice: pickNum(r, 'mark_price', 'markPrice', 'price') ?? 0,
    oraclePrice: pickNum(r, 'oracle_price', 'oraclePrice'),
    openInterest: pickNum(r, 'open_interest', 'openInterest'),
    volume24h: pickNum(r, 'volume_24h', 'volume24h'),
    fundingRate: pickNum(r, 'funding_rate', 'fundingRate'),
    maxLeverage: pickNum(r, 'max_leverage', 'maxLeverage') ?? 1,
    szDecimals: pickNum(r, 'sz_decimals', 'szDecimals') ?? 2,
  };
}

export function usePerpsMarkets() {
  const q = useQuery({
    queryKey: ['perps', 'opportunities'],
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const data = await compassGet<Loose>('global-markets-perps/opportunities', {
        sort_by: 'volume_24h',
        sort_order: 'desc',
      });
      const arr = (data.opportunities ?? data.markets ?? data) as Loose[];
      return Array.isArray(arr) ? arr.map(normMarket) : [];
    },
  });
  return { markets: q.data ?? [], isLoading: q.isLoading, isError: q.isError, error: q.error, refetch: q.refetch };
}

function normPosition(r: Loose): PerpsPosition {
  // Keep the RAW size string for close orders (no lossy Number round-trip / no
  // exponential notation); the API gives a positive decimal string + `side`.
  const sizeStr = pickStr(r, 'size', 'szi') ?? '0';
  const sizeNum = Number(sizeStr) || 0;
  const side = (pickStr(r, 'side') ?? (sizeNum < 0 ? 'short' : 'long')) as PerpsSide;
  return {
    asset: pickStr(r, 'asset', 'coin') ?? '',
    side,
    size: sizeStr.startsWith('-') ? sizeStr.slice(1) : sizeStr,
    entryPrice: pickNum(r, 'entry_price', 'entryPrice'),
    markPrice: pickNum(r, 'mark_price', 'markPrice'),
    liquidationPrice: pickNum(r, 'liquidation_price', 'liquidationPrice'),
    unrealizedPnl: pickNum(r, 'unrealized_pnl', 'unrealizedPnl') ?? 0,
    leverage: pickStr(r, 'leverage') ?? '1',
    marginUsed: pickNum(r, 'margin_used', 'marginUsed'),
    fundingAccrued: pickNum(r, 'funding_accrued', 'fundingAccrued'),
  };
}

export function usePerpsPositions() {
  const { evmAddress } = useWallet();
  const q = useQuery({
    queryKey: ['perps', 'positions', evmAddress],
    enabled: !!evmAddress,
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async (): Promise<PerpsPositionsResult> => {
      const data = await compassGet<Loose>('global-markets-perps/positions', { owner: evmAddress! });
      const arr = (data.positions ?? []) as Loose[];
      return {
        positions: Array.isArray(arr) ? arr.map(normPosition) : [],
        withdrawable: pickNum(data, 'withdrawable') ?? 0,
        accountValue: pickNum(data, 'account_value', 'accountValue') ?? 0,
      };
    },
  });
  return {
    positions: q.data?.positions ?? [],
    withdrawable: q.data?.withdrawable ?? 0,
    accountValue: q.data?.accountValue ?? 0,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
  };
}

export function usePerpsActivity(enabled = true) {
  const { evmAddress } = useWallet();
  const q = useQuery({
    queryKey: ['perps', 'activity', evmAddress],
    enabled: !!evmAddress && enabled,
    staleTime: 15_000,
    refetchInterval: 20_000,
    queryFn: async () => {
      const data = await compassGet<Loose>('global-markets-perps/activity', { owner: evmAddress! });
      const items: PerpsActivityItem[] = [];
      for (const f of (data.fills ?? []) as Loose[]) {
        const orderId = pickNum(f, 'order_id', 'orderId') ?? 0;
        const timeMs = pickNum(f, 'time_ms', 'timeMs', 'time') ?? 0;
        items.push({
          id: `fill-${orderId}-${timeMs}`,
          kind: 'fill',
          side: (pickStr(f, 'side') ?? 'buy') as 'buy' | 'sell',
          asset: pickStr(f, 'asset', 'coin') ?? '',
          price: pickStr(f, 'price', 'px') ?? '0',
          size: pickStr(f, 'size', 'sz') ?? '0',
          timeMs,
          orderId,
          fee: pickStr(f, 'fee') ?? undefined,
          closedPnl: pickStr(f, 'closed_pnl', 'closedPnl'),
        });
      }
      for (const o of (data.open_orders ?? data.openOrders ?? []) as Loose[]) {
        const orderId = pickNum(o, 'order_id', 'orderId') ?? 0;
        const timeMs = pickNum(o, 'time_ms', 'timeMs', 'time') ?? 0;
        items.push({
          id: `order-${orderId}-${timeMs}`,
          kind: 'order',
          side: (pickStr(o, 'side') ?? 'buy') as 'buy' | 'sell',
          asset: pickStr(o, 'asset', 'coin') ?? '',
          price: pickStr(o, 'limit_price', 'limitPrice', 'price') ?? '0',
          size: pickStr(o, 'size', 'sz') ?? '0',
          timeMs,
          orderId,
          reduceOnly: pickBool(o, 'reduce_only', 'reduceOnly') ?? false,
        });
      }
      items.sort((a, b) => b.timeMs - a.timeMs);
      const partialErrors = (data.partial_errors ?? data.partialErrors ?? []) as unknown[];
      return { activity: items, partialErrors };
    },
  });
  return { activity: q.data?.activity ?? [], partialErrors: q.data?.partialErrors ?? [], isLoading: q.isLoading, isError: q.isError, refetch: q.refetch };
}

export function usePerpsCandles(coin: string | null, interval: CandleInterval) {
  const q = useQuery({
    queryKey: ['perps', 'candles', coin, interval],
    enabled: !!coin,
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Candle[]> => {
      const data = await compassGet<Loose>('global-markets-perps/candles', {
        symbol: coin!,
        interval,
        limit: 200,
      });
      const arr = (data.candles ?? data) as Loose[];
      if (!Array.isArray(arr)) return [];
      return arr.map((c) => ({
        time: pickNum(c, 'time', 't', 'timestamp') ?? 0,
        open: pickNum(c, 'open', 'o') ?? 0,
        high: pickNum(c, 'high', 'h') ?? 0,
        low: pickNum(c, 'low', 'l') ?? 0,
        close: pickNum(c, 'close', 'c') ?? 0,
      }));
    },
  });
  return { candles: q.data ?? [], isLoading: q.isLoading, isError: q.isError };
}

/**
 * Account setup state. `enable-unified-account` PREPARES the enable signature
 * (returns typedData to sign, or null when already unified) — safe to call as a
 * read. A "must deposit" error means the account needs funding first.
 */
export function usePerpsAccountMode() {
  const { evmAddress } = useWallet();
  const q = useQuery({
    queryKey: ['perps', 'account-mode', evmAddress],
    enabled: !!evmAddress,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const data = await compassPost<Loose>('global-markets-perps/enable-unified-account', { owner: evmAddress });
        const typedData = (data.typedData ?? data.typed_data ?? null) as TypedData | null;
        const payload: PerpsPrepare | null = typedData
          ? { typedData, action: data.action, nonce: pickNum(data, 'nonce') ?? (data.nonce as number) }
          : null;
        return { isUnified: typedData == null, needsDeposit: false, signingPayload: payload };
      } catch (e) {
        // ONLY the explicit "must deposit" error means the account needs funding.
        // Re-throw everything else so React Query retries transient failures
        // instead of wrongly gating an already-enabled user into the setup screen.
        const msg = e instanceof Error ? e.message.toLowerCase() : '';
        if (msg.includes('must deposit')) {
          return { isUnified: false, needsDeposit: true, signingPayload: null as PerpsPrepare | null };
        }
        throw e;
      }
    },
  });
  return {
    isUnified: q.data?.isUnified ?? false,
    needsDeposit: q.data?.needsDeposit ?? false,
    signingPayload: q.data?.signingPayload ?? null,
    isLoading: q.isLoading,
    refetch: q.refetch,
  };
}

/** Embedded-wallet USDC balance on Arbitrum (the perps funding chain). */
export function usePerpsWalletUsdc() {
  const { evmAddress } = useWallet();
  const q = useQuery({
    queryKey: ['walletUsdcBalance', 'arbitrum', evmAddress],
    enabled: !!evmAddress,
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const data = await compassGet<Loose>('token/balance', { address: evmAddress!, chain: 'arbitrum', token: 'USDC' });
      return pickNum(data, 'balance') ?? 0;
    },
  });
  return { walletUsdc: q.data ?? 0, isLoading: q.isLoading, refetch: q.refetch };
}
