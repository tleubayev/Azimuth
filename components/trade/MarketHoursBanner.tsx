'use client';

import { Clock } from 'lucide-react';

/**
 * Shown on the Spot screen when the U.S. equity market is closed (per the live
 * 1inch/Ondo signal — see `lib/tokenized/marketStatus.ts`). Tokenized stocks
 * can't be traded until the market reopens; Midas RWA stays open, so we say so.
 * Charts and the market list remain visible — only trading is blocked.
 */
export function MarketHoursBanner() {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        background: 'color-mix(in srgb, var(--warn) 12%, transparent)',
        border: '1px solid color-mix(in srgb, var(--warn) 38%, transparent)',
        clipPath: 'var(--clip-notch)',
        padding: '12px 14px',
      }}
    >
      <Clock size={16} style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 1 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--warn)' }}>
          U.S. markets closed
        </div>
        <div style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          Tokenized stocks resume at the next U.S. trading session. RWA assets stay open.
        </div>
      </div>
    </div>
  );
}
