'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Sheet, SheetHeader, MarketRow } from '@/components/ui';
import { assetClassLabel, marketTradable, tradingStateLabel, type TokenizedMarket, type TokenizedAssetClass } from '@/lib/compass/types';
import { fmtPrice, fmtApy } from '@/lib/format';

const CLASSES: (TokenizedAssetClass | 'ALL')[] = ['ALL', 'EQUITY', 'T_BILLS', 'BASIS_TRADE', 'BTC_YIELD'];

export function SpotMarketsSheet({ open, onClose, markets, onSelect }: { open: boolean; onClose: () => void; markets: TokenizedMarket[]; onSelect: (m: TokenizedMarket) => void }) {
  const [search, setSearch] = useState('');
  const [cls, setCls] = useState<TokenizedAssetClass | 'ALL'>('ALL');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return markets.filter((m) => {
      if (cls !== 'ALL' && m.assetClass !== cls) return false;
      if (!q) return true;
      return m.symbol.toLowerCase().includes(q) || m.underlyingTicker.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
    });
  }, [markets, search, cls]);

  if (!open) return null;

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader eyebrow="// SPOT" title="Markets" subtitle={`${markets.length} tokenized assets`} onClose={onClose} />
      <div style={{ padding: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', border: '1px solid var(--border-strong)', clipPath: 'var(--clip-notch)', padding: '10px 12px' }}>
          <Search size={16} color="var(--text-mute)" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search markets"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: 14 }}
          />
        </div>
        <div className="cp-hide-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {CLASSES.map((c) => (
            <button key={c} onClick={() => setCls(c)} style={{ flexShrink: 0, height: 30, padding: '0 12px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', background: cls === c ? 'var(--primary-soft)' : 'var(--surface-2)', border: `1px solid ${cls === c ? 'var(--border-neon)' : 'var(--border)'}`, color: cls === c ? 'var(--primary)' : 'var(--text-dim)', clipPath: 'var(--clip-tag)' }}>
              {c === 'ALL' ? 'All' : assetClassLabel(c)}
            </button>
          ))}
        </div>
      </div>
      <div className="cp-hide-scroll" style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '52vh' }}>
        {filtered.map((m) => {
          const unavailable = !marketTradable(m);
          return (
            <MarketRow
              key={`${m.symbol}-${m.chain}`}
              ticker={m.underlyingTicker || m.symbol}
              symbol={m.symbol}
              sub={m.provider === 'midas' ? assetClassLabel(m.assetClass) : (m.sectors[0] ?? 'EQUITIES')}
              subColor={m.provider === 'midas' ? 'var(--accent)' : 'var(--primary)'}
              price={fmtPrice(m.currentPriceUsd ?? 0)}
              change={m.provider === 'midas' ? null : (m.change24hPct ?? null)}
              changeLabel={m.provider === 'midas' ? fmtApy(m.apy7d) : undefined}
              unavailable={unavailable}
              statusLabel={unavailable && m.status ? tradingStateLabel(m.status.state) : undefined}
              onClick={() => onSelect(m)}
            />
          );
        })}
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '24px 0', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-mute)' }}>No matches</div>
        )}
      </div>
    </Sheet>
  );
}
