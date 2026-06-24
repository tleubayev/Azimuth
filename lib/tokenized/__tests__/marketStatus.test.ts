import { describe, it, expect } from 'vitest';
import { isMarketClosedError, isUsEquityMarketClosed, equityStatusFromProbeError } from '../marketStatus';

// Fixed instants (June 2026, EDT = UTC-4). 2026-06-20 is a Saturday.
const SAT_AFTERNOON = new Date('2026-06-20T19:56:00Z'); // Sat 15:56 ET — closed
const WED_NOON = new Date('2026-06-17T16:00:00Z'); // Wed 12:00 ET — open
const FRI_EVENING_CLOSED = new Date('2026-06-20T00:30:00Z'); // Fri 20:30 ET — closed (after 7:59pm)
const FRI_AFTERNOON_OPEN = new Date('2026-06-19T22:00:00Z'); // Fri 18:00 ET — open
const SUN_EVENING_CLOSED = new Date('2026-06-21T23:00:00Z'); // Sun 19:00 ET — closed (before 8:05pm)
const SUN_NIGHT_OPEN = new Date('2026-06-22T00:30:00Z'); // Sun 20:30 ET — open (after 8:05pm)

describe('isUsEquityMarketClosed (Ondo weekend window, ET)', () => {
  it('closed all day Saturday', () => expect(isUsEquityMarketClosed(SAT_AFTERNOON)).toBe(true));
  it('closed Friday after 7:59pm ET', () => expect(isUsEquityMarketClosed(FRI_EVENING_CLOSED)).toBe(true));
  it('closed Sunday before 8:05pm ET', () => expect(isUsEquityMarketClosed(SUN_EVENING_CLOSED)).toBe(true));
  it('open midweek', () => expect(isUsEquityMarketClosed(WED_NOON)).toBe(false));
  it('open Friday afternoon', () => expect(isUsEquityMarketClosed(FRI_AFTERNOON_OPEN)).toBe(false));
  it('open Sunday after 8:05pm ET', () => expect(isUsEquityMarketClosed(SUN_NIGHT_OPEN)).toBe(false));
});

describe('isMarketClosedError', () => {
  it('matches the real wrapped message the proxy forwards today', () => {
    // What FusionApiUnavailable → proxy → CompassError.message actually looks like.
    const e = new Error('1inch Fusion API returned 400 — market is closed; code=MARKET_CLOSED');
    expect(isMarketClosedError(e)).toBe(true);
  });

  it('matches a future clean / friendly closed message', () => {
    expect(isMarketClosedError(new Error('U.S. market is closed. Try again when it reopens.'))).toBe(true);
  });

  it('matches the bare MARKET_CLOSED code form', () => {
    expect(isMarketClosedError(new Error('code=MARKET_CLOSED'))).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isMarketClosedError(new Error('Market Is Closed'))).toBe(true);
  });

  it('accepts a plain string', () => {
    expect(isMarketClosedError('market is closed')).toBe(true);
  });

  it('still matches the explicit phrase regardless of the clock', () => {
    expect(isMarketClosedError(new Error('market is closed'), WED_NOON)).toBe(true);
  });

  it('treats the post-#1221 generic "swap service unavailable" as closed ONLY on the weekend', () => {
    // After #1221 a closed market is masked as this generic 502 message.
    const masked = new Error('The swap service is temporarily unavailable. Try again shortly.');
    expect(isMarketClosedError(masked, SAT_AFTERNOON)).toBe(true); // weekend → closed
    expect(isMarketClosedError(masked, WED_NOON)).toBe(false); // weekday → real outage, not masked
  });

  it('never masks a genuine timeout / unreachable as closed, even on the weekend', () => {
    expect(isMarketClosedError(new Error('The swap service timed out. Try again shortly.'), SAT_AFTERNOON)).toBe(false);
    expect(isMarketClosedError(new Error('The swap service is unreachable. Try again shortly.'), SAT_AFTERNOON)).toBe(false);
  });

  it('does NOT match real liquidity / outage failures', () => {
    expect(isMarketClosedError(new Error('No 1inch Fusion resolver could fill the order'))).toBe(false);
    expect(isMarketClosedError(new Error('FUSION_NO_LIQUIDITY'))).toBe(false);
    expect(isMarketClosedError(new Error('1inch Fusion API returned 502'))).toBe(false);
  });

  it('does NOT match non-error inputs', () => {
    expect(isMarketClosedError(null)).toBe(false);
    expect(isMarketClosedError(undefined)).toBe(false);
    expect(isMarketClosedError(404)).toBe(false);
    // A bare object isn't trusted — only Error / string carry a real message.
    expect(isMarketClosedError({ message: 'market is closed' })).toBe(false);
  });
});

describe('equityStatusFromProbeError', () => {
  it('reports closed on an upstream 5xx — masked closed market (incl. holidays) or venue outage', () => {
    // Today's Juneteenth case: closed market masked by #1221 as a 502, on a Friday.
    expect(equityStatusFromProbeError(new Error('Swap service unavailable'), 502, WED_NOON)).toBe('closed');
    expect(equityStatusFromProbeError(new Error('anything'), 500, WED_NOON)).toBe('closed');
  });

  it('reports closed on the explicit market-closed phrase regardless of status', () => {
    expect(equityStatusFromProbeError(new Error('market is closed'), 400, WED_NOON)).toBe('closed');
  });

  it('stays unknown for auth / rate-limit / other 4xx — no false "market closed"', () => {
    expect(equityStatusFromProbeError(new Error('Unauthorized'), 401, WED_NOON)).toBe('unknown');
    expect(equityStatusFromProbeError(new Error('Request failed (429)'), 429, WED_NOON)).toBe('unknown');
    expect(equityStatusFromProbeError(new Error('Insufficient liquidity'), 409, WED_NOON)).toBe('unknown');
    expect(equityStatusFromProbeError(new Error('boom'), 0, WED_NOON)).toBe('unknown');
  });
});
