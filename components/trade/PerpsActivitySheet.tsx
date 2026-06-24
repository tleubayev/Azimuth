'use client';

import { Sheet, SheetHeader, BusyView } from '@/components/ui';
import { usePerpsActivity } from '@/lib/hooks/perps/queries';
import { fmtPrice } from '@/lib/format';
import type { PerpsActivityItem } from '@/lib/compass/types';

export function PerpsActivitySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activity, partialErrors, isLoading } = usePerpsActivity(open);
  if (!open) return null;

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader eyebrow="// PERPS" title="Activity" subtitle="Fills & open orders" onClose={onClose} />
      <div className="cp-hide-scroll" style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '60vh' }}>
        {partialErrors.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--warn)', background: 'color-mix(in srgb, var(--warn) 12%, transparent)', padding: '8px 10px', clipPath: 'var(--clip-tag)' }}>
            Some activity couldn’t be loaded.
          </div>
        )}
        {isLoading ? (
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

function Row({ item }: { item: PerpsActivityItem }) {
  const buy = item.side === 'buy';
  const color = buy ? 'var(--pos)' : 'var(--neg)';
  const when = item.timeMs ? new Date(item.timeMs).toLocaleString() : '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 13px', background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color }}>{item.side}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{item.asset}</span>
          {item.kind === 'order' && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-mute)' }}>{item.reduceOnly ? 'reduce' : 'limit'}</span>}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-mute)', marginTop: 2 }}>{when}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div className="cp-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{fmtPrice(item.price)}</div>
        <div className="cp-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{item.size}</div>
      </div>
    </div>
  );
}
