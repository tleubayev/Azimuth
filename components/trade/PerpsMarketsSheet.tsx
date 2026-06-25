'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Sheet, SheetHeader, MarketRow } from '@/components/ui';
import { fmtPrice, fmtCompact } from '@/lib/format';
import type { PerpsMarket } from '@/lib/compass/types';

/** Friendly labels for the HIP-3 perp categories the API returns
 *  (`stock` / `commodity` / `forex`); unknown values are title-cased. */
const CATEGORY_LABELS: Record<string, string> = {
  stock: 'Stocks',
  commodity: 'Commodities',
  forex: 'Forex',
  crypto: 'Crypto',
};

/** Preferred filter-chip order; categories not listed here are appended A→Z. */
const CATEGORY_ORDER = ['stock', 'commodity', 'forex', 'crypto'];

function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] ?? (cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : cat);
}

/**
 * Full, searchable perps market browser — mirrors `SpotMarketsSheet`. The
 * `usePerpsMarkets` hook already returns the COMPLETE market list (sorted by
 * 24h volume desc), so filtering is done client-side here; tapping a row hands
 * the chosen market back to the screen, which opens the trade sheet.
 */
export function PerpsMarketsSheet({
  open,
  onClose,
  markets,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  markets: PerpsMarket[];
  onSelect: (m: PerpsMarket) => void;
}) {
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<string>('ALL');

  // Start every open with a clean slate — the sheet is always mounted (toggled
  // via `open`), so without this a stale query / category chip from a previous
  // visit would silently hide most markets on reopen.
  useEffect(() => {
    if (open) { setSearch(''); setCat('ALL'); }
  }, [open]);

  // Only render chips for categories actually present in the data, so the filter
  // never offers an option that would return nothing.
  const categories = useMemo(() => {
    const present = new Set(markets.map((m) => m.category).filter(Boolean));
    const ordered = CATEGORY_ORDER.filter((c) => present.has(c));
    const extras = [...present].filter((c) => !CATEGORY_ORDER.includes(c)).sort();
    return ['ALL', ...ordered, ...extras];
  }, [markets]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return markets.filter((m) => {
      if (cat !== 'ALL' && m.category !== cat) return false;
      if (!q) return true;
      return (
        m.asset.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        categoryLabel(m.category).toLowerCase().includes(q)
      );
    });
  }, [markets, search, cat]);

  if (!open) return null;

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader eyebrow="// PERPS" title="Markets" subtitle={`${markets.length} perp markets`} onClose={onClose} />
      <div style={{ padding: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', border: '1px solid var(--border-strong)', clipPath: 'var(--clip-notch)', padding: '10px 12px' }}>
          <Search size={16} color="var(--text-mute)" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search markets"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: 14 }}
          />
        </div>
        {categories.length > 2 && (
          <div className="cp-hide-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
            {categories.map((c) => (
              <button key={c} onClick={() => setCat(c)} style={{ flexShrink: 0, height: 30, padding: '0 12px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', background: cat === c ? 'var(--primary-soft)' : 'var(--surface-2)', border: `1px solid ${cat === c ? 'var(--border-neon)' : 'var(--border)'}`, color: cat === c ? 'var(--primary)' : 'var(--text-dim)', clipPath: 'var(--clip-tag)' }}>
                {/* Display the raw category (uppercased) so chips read the same as
                    each row's `sub` (e.g. STOCK) — friendly labels are kept only
                    for forgiving search ("stocks" still matches). */}
                {c === 'ALL' ? 'All' : c}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="cp-hide-scroll" style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 auto', minHeight: 0 }}>
        {filtered.map((m) => (
          <MarketRow
            key={m.asset}
            ticker={m.asset}
            symbol={`${m.maxLeverage}×`}
            sub={m.category.toUpperCase()}
            price={fmtPrice(m.markPrice)}
            changeLabel={m.volume24h != null ? `Vol ${fmtCompact(m.volume24h)}` : undefined}
            onClick={() => onSelect(m)}
          />
        ))}
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '24px 0', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-mute)' }}>No matches</div>
        )}
      </div>
    </Sheet>
  );
}
