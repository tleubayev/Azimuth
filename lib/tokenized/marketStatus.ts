/**
 * Detecting "the U.S. equity market is closed" for tokenized stocks (Ondo).
 *
 * Tokenized equities are filled through 1inch Fusion, whose resolvers are Ondo's
 * market-makers. Ondo Global Markets trades Sunday 8:05pm ET → Friday 7:59pm ET;
 * outside that (weekends, holidays, overnight) the resolvers refuse to quote and
 * 1inch returns HTTP 400 `{code:"MARKET_CLOSED", description:"market is closed"}`.
 *
 * Reading that signal used to be enough: the API wrapped the 400 in a message
 * that still contained "market is closed", which `isMarketClosedError` matched.
 * As of the swap-provider error refactor (API #1221) the backend now maps that
 * 400 to a generic `FusionApiUnavailable` (502) — "The swap service is
 * temporarily unavailable." — and deliberately drops the upstream body, so the
 * phrase no longer reaches the app. A REAL Fusion outage produces the SAME
 * generic message, so text alone can no longer tell "closed" from "down".
 *
 * Frontend disambiguation (until the backend restores a MARKET_CLOSED signal):
 * treat that generic message as "closed" only when a client clock agrees we are
 * inside Ondo's weekend closure (`isUsEquityMarketClosed`). A genuine weekday
 * outage keeps surfacing as a real error. Midas RWA never hits Fusion, so it is
 * never reported closed — which is why Midas stays tradable around the clock.
 */

/** Whether an equity market is tradable right now, per the upstream venue. */
export type EquityMarketStatus = 'open' | 'closed' | 'unknown';

/** ET wall-clock (DST-correct via the IANA zone) for a given instant. */
function etWallClock(now: Date): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const val = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = WD[val('weekday')] ?? 0;
  // hour12:false yields "24" for midnight on some engines — normalise to 0..23.
  const minutes = (Number(val('hour')) % 24) * 60 + Number(val('minute'));
  return { weekday, minutes };
}

/**
 * Is Ondo Global Markets in its WEEKEND closure right now? Ondo trades Sunday
 * 8:05pm ET → Friday 7:59pm ET, so the reliably-closed window is Friday 7:59pm
 * ET through Sunday 8:05pm ET. This clock is deliberately NARROW: it covers only
 * the weekend (the dominant off-hours case), not holidays, half-days, or the
 * small daily session gaps — those still fall through to the upstream error. It
 * is used ONLY to disambiguate a reason-stripped swap error, never as the sole
 * source of truth. `now` is injectable for tests.
 */
export function isUsEquityMarketClosed(now: Date = new Date()): boolean {
  const { weekday, minutes } = etWallClock(now);
  const FRI_CLOSE = 19 * 60 + 59; // Friday 7:59pm ET
  const SUN_OPEN = 20 * 60 + 5; // Sunday 8:05pm ET
  if (weekday === 6) return true; // all of Saturday
  if (weekday === 5 && minutes >= FRI_CLOSE) return true; // Friday after close
  if (weekday === 0 && minutes < SUN_OPEN) return true; // Sunday before open
  return false;
}

/** The reason-stripped message the API emits after #1221 (a closed market and a
 *  real Fusion outage both surface as this). Note: timeout / unreachable phrasings
 *  are intentionally NOT matched — those are always real failures. */
const SWAP_SERVICE_UNAVAILABLE = /swap service (is )?(temporarily )?unavailable/i;

/**
 * True when an error from a quote/order attempt is the Ondo "market is closed"
 * signal (vs. a real outage or liquidity failure). Matches the explicit phrase /
 * `MARKET_CLOSED` code directly; for the post-#1221 generic "swap service
 * unavailable" message — which masks the reason — it only counts as closed when
 * the client clock (`now`) is inside Ondo's weekend window, so a genuine outage
 * is not mislabeled. Only trusts Error / string inputs.
 */
export function isMarketClosedError(err: unknown, now: Date = new Date()): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (/market is closed|market_closed/i.test(msg)) return true;
  if (SWAP_SERVICE_UNAVAILABLE.test(msg) && isUsEquityMarketClosed(now)) return true;
  return false;
}

/**
 * Classify a FAILED market-status probe (the read-only test quote) into a status.
 *
 * After #1221 a closed market — weekends, holidays (which the weekend clock can't
 * see), overnight — is masked as a generic swap-service 5xx, indistinguishable by
 * text from a real venue outage. Either way no stock can be quoted or filled right
 * now, so we report `closed` and let the Spot screen show the banner + gate
 * trading. Scoped to the VENUE signal — the explicit closed phrase, or any upstream
 * 5xx — so unrelated failures (auth 401/403, rate-limit 429, other 4xx, the app's
 * own proxy) stay `unknown` and never raise a false "closed". `status` is the HTTP
 * status of the failed probe (0 when unknown); `now` is injectable for tests.
 */
export function equityStatusFromProbeError(
  err: unknown,
  status: number,
  now: Date = new Date(),
): EquityMarketStatus {
  if (isMarketClosedError(err, now) || status >= 500) return 'closed';
  return 'unknown';
}
