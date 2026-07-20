import { describe, it, expect } from 'vitest';
import { parseTradingStatus } from '@/lib/tokenized/tradingStatus';
import { marketTradable, tradingStateLabel } from '@/lib/compass/types';

describe('parseTradingStatus', () => {
  it('parses a CLOSED status (real API shape: snake_case) and marks it not tradable', () => {
    // Straight from the live OpenAPI `TradingStatus` example.
    const raw = {
      is_open: false,
      next_open: '2026-07-06T00:05:00Z',
      reason: 'Weekend or Holiday',
      state: 'CLOSED',
    };
    const status = parseTradingStatus(raw);
    expect(status).toEqual({
      isOpen: false,
      state: 'CLOSED',
      reason: 'Weekend or Holiday',
      nextOpen: '2026-07-06T00:05:00Z',
    });
    expect(marketTradable({ status })).toBe(false);
  });

  it('parses an OPEN status as tradable', () => {
    const status = parseTradingStatus({ is_open: true, state: 'OPEN', reason: null, session: 'regular' });
    expect(status?.isOpen).toBe(true);
    expect(marketTradable({ status })).toBe(true);
  });

  it('treats a PAUSED (halted) market as not tradable', () => {
    const status = parseTradingStatus({ is_open: false, state: 'PAUSED', reason: 'cash_dividend' });
    expect(marketTradable({ status })).toBe(false);
    expect(status?.state).toBe('PAUSED');
  });

  it('normalises lower-case / unknown states, defaulting unknown to OPEN', () => {
    expect(parseTradingStatus({ is_open: false, state: 'closed' })?.state).toBe('CLOSED');
    expect(parseTradingStatus({ is_open: true, state: 'wat' })?.state).toBe('OPEN');
  });

  it('fails open: a null / missing status is tradable', () => {
    expect(parseTradingStatus(null)).toBeNull();
    expect(parseTradingStatus(undefined)).toBeNull();
    // A market with no status must still be tradable (RWA / older API).
    expect(marketTradable({ status: null })).toBe(true);
    expect(marketTradable({})).toBe(true);
  });

  it('defaults is_open to true when the field is absent from a present block', () => {
    // Present block but no boolean — don't over-block; the state still informs.
    const status = parseTradingStatus({ state: 'LIMITED', reason: 'restricted' });
    expect(status?.isOpen).toBe(true);
    expect(status?.state).toBe('LIMITED');
  });
});

describe('tradingStateLabel', () => {
  it('gives short human labels for each state', () => {
    expect(tradingStateLabel('OPEN')).toBe('Open');
    expect(tradingStateLabel('CLOSED')).toBe('Closed');
    expect(tradingStateLabel('PAUSED')).toBe('Halted');
    expect(tradingStateLabel('LIMITED')).toBe('Limited');
  });
});
