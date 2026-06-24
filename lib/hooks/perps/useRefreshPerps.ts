'use client';

import { useStaggeredRefresh } from '@/lib/hooks/useStaggeredRefresh';

/**
 * Invalidate perps queries after a transaction. Hyperliquid's read API trails the
 * chain by a few seconds, so we re-invalidate immediately + at 5s / 15s / 30s.
 */
export function useRefreshPerps() {
  return useStaggeredRefresh([['perps'], ['walletUsdcBalance']], [5_000, 15_000, 30_000]);
}
