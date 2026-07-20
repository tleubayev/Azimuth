/**
 * Parse the tokenized-market `status` block (API `TradingStatus`) into the app's
 * `TokenizedTradingStatus`. Both the markets-list item and the single-market
 * detail carry it: `{ is_open, state, reason, session, next_open, next_close }`,
 * where `state` is one of OPEN / CLOSED (outside hours) / PAUSED (halted) /
 * LIMITED (tradable but restricted). `is_open` is the authoritative "tradable
 * right now" boolean the UI greys markets out on.
 *
 * Kept pure (no React) so the greying decision is unit-testable against the raw
 * API shape. An absent/blank block ⇒ null, which callers treat as tradable
 * (fail-open — see `marketTradable`).
 */

import { pickStr, pickBool } from '@/lib/compass/client';
import type { TokenizedTradingStatus, TradingState } from '@/lib/compass/types';

type Loose = Record<string, unknown>;

const KNOWN_STATES: TradingState[] = ['OPEN', 'CLOSED', 'PAUSED', 'LIMITED'];

export function parseTradingStatus(raw: unknown): TokenizedTradingStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Loose;
  const state = (pickStr(r, 'state') ?? '').toUpperCase();
  return {
    isOpen: pickBool(r, 'is_open', 'isOpen') ?? true,
    state: (KNOWN_STATES.includes(state as TradingState) ? state : 'OPEN') as TradingState,
    reason: pickStr(r, 'reason') ?? null,
    nextOpen: pickStr(r, 'next_open', 'nextOpen') ?? null,
  };
}
