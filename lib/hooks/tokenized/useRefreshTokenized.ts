'use client';

import { useStaggeredRefresh } from '@/lib/hooks/useStaggeredRefresh';

/**
 * Invalidate tokenized queries after a transaction. On-chain balances/PnL lag
 * confirmation by a few seconds, so re-invalidate immediately + at 3s / 10s / 25s.
 */
export function useRefreshTokenized() {
  return useStaggeredRefresh([['tokenized'], ['walletUsdcBalance']], [3_000, 10_000, 25_000]);
}
