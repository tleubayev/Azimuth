'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Invalidate a set of query-key prefixes after a transaction, immediately and
 * again at each `delays` offset — on-chain reads (balances, positions, PnL) lag
 * confirmation by a few seconds. A post-unmount guard prevents scheduling (or
 * running) invalidations after the consuming component has gone away.
 *
 * `queryKeys` / `delays` are read through refs, so passing fresh inline arrays
 * each render is fine (no dependency churn).
 */
export function useStaggeredRefresh(queryKeys: unknown[][], delays: number[]) {
  const qc = useQueryClient();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const unmounted = useRef(false);
  const keysRef = useRef(queryKeys);
  keysRef.current = queryKeys;
  const delaysRef = useRef(delays);
  delaysRef.current = delays;

  const invalidate = useCallback(() => {
    if (unmounted.current) return;
    for (const key of keysRef.current) qc.invalidateQueries({ queryKey: key });
  }, [qc]);

  const refreshAfterTx = useCallback(() => {
    if (unmounted.current) return;
    invalidate();
    timers.current.forEach(clearTimeout);
    timers.current = delaysRef.current.map((d) => setTimeout(invalidate, d));
  }, [invalidate]);

  useEffect(
    () => () => {
      unmounted.current = true;
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  return { refreshAfterTx, refreshNow: invalidate };
}
