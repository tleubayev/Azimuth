'use client';

import { Sheet, SheetHeader, BusyView } from '@/components/ui';
import { useTokenizedActivity } from '@/lib/hooks/tokenized/queries';
import { fmtTokens, fmtUsd, fmtSignedUsd } from '@/lib/format';
import type { TokenizedActivityItem } from '@/lib/compass/types';

export function SpotActivitySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activity, isLoading } = useTokenizedActivity();
  if (!open) return null;

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader eyebrow="// SPOT" title="Activity" subtitle="Buys, sells & transfers" onClose={onClose} />
      <div className="cp-hide-scroll" style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '60vh' }}>
        {isLoading && activity.length === 0 ? (
          <BusyView title="Loading activity" />
        ) : activity.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-mute)' }}>
            No activity yet
          </div>
        ) : (
          activity.map((it) => <Row key={it.id} item={it} />)
        )}
      </div>
    </Sheet>
  );
}

const MINUS = '−'; // U+2212, matches lib/format house style

type Descriptor = { label: string; color: string; usd: string | null; tokens: string };

/** Per-event-type display: a colored label, the token leg (the headline) and the
 *  USDC leg (the sub-line). Transfers have no USDC side. */
function describe(item: TokenizedActivityItem): Descriptor {
  const ticker = item.underlyingTicker || item.symbol;
  switch (item.eventType) {
    case 'buy':
      return {
        label: 'Buy',
        color: 'var(--pos)',
        usd: item.inputAmount != null ? fmtUsd(item.inputAmount) : null,
        tokens: `+${fmtTokens(item.outputAmount ?? '0')} ${ticker}`,
      };
    case 'sell':
      return {
        label: 'Sell',
        color: 'var(--neg)',
        usd: item.outputAmount != null ? fmtUsd(item.outputAmount) : null,
        tokens: `${MINUS}${fmtTokens(item.inputAmount ?? '0')} ${ticker}`,
      };
    case 'transfer_in':
      return {
        label: 'Received',
        color: 'var(--accent)',
        usd: null,
        tokens: `+${fmtTokens(item.outputAmount ?? '0')} ${ticker}`,
      };
    case 'transfer_out':
      return {
        label: 'Sent',
        color: 'var(--text-mute)',
        usd: null,
        tokens: `${MINUS}${fmtTokens(item.inputAmount ?? '0')} ${ticker}`,
      };
  }
}

function Row({ item }: { item: TokenizedActivityItem }) {
  const d = describe(item);
  const when = item.timeMs ? new Date(item.timeMs).toLocaleString() : '';
  const pnlNum = item.realizedPnl != null ? parseFloat(item.realizedPnl) : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 13px', background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: d.color }}>{d.label}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{item.underlyingTicker || item.symbol}</span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-mute)', marginTop: 2 }}>{when}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div className="cp-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{d.tokens}</div>
        <div className="cp-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
          {d.usd ?? '—'}
          {pnlNum != null && (
            <span style={{ marginLeft: 6, color: pnlNum >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtSignedUsd(item.realizedPnl ?? '0')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
