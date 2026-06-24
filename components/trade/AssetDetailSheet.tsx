'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { Sheet, SheetHeader, Button, Tag } from '@/components/ui';
import { CandleChart } from './CandleChart';
import { SpotOrderForm } from './SpotOrderSheet';
import { SpotSwapForm } from './SpotSwapSheet';
import { useTokenizedMarketDetail, useEquityMarketStatus } from '@/lib/hooks/tokenized/queries';
import { isSwapTraded, assetClassLabel, type TokenizedMarket, type TokenizedPosition, type TokenizedPeriod } from '@/lib/compass/types';
import { fmtPrice, fmtPct, fmtApy, fmtCompact, fmtSignedUsd } from '@/lib/format';

const PERIODS: TokenizedPeriod[] = ['1D', '1M', '3M', '6M', '1Y', 'ALL'];

export function AssetDetailSheet({ market, position, onClose }: { market: TokenizedMarket | null; position?: TokenizedPosition | null; onClose: () => void }) {
  const open = !!market;
  const [period, setPeriod] = useState<TokenizedPeriod>('1M');
  const [orderSide, setOrderSide] = useState<'buy' | 'sell' | null>(null);
  // A multi-step trade in flight locks the sheet so scrim/Esc can't tear it down.
  const [busy, setBusy] = useState(false);
  const { detail, isLoading } = useTokenizedMarketDetail(open ? market?.symbol ?? null : null, period);
  const { isClosed: equityMarketClosed } = useEquityMarketStatus();

  useEffect(() => {
    if (market) { setPeriod('1M'); setOrderSide(null); setBusy(false); }
  }, [market]);

  if (!open || !market) return null;
  const swapTraded = isSwapTraded(market.assetClass);
  const isMidas = market.provider === 'midas';
  const hasBalance = !!position && parseFloat(position.balance) > 0;
  // Equities (Ondo) can't be traded while the U.S. market is closed; Midas RWA
  // (swap-traded) is unaffected. Charts/detail above stay visible regardless.
  const tradingClosed = equityMarketClosed && !swapTraded;

  return (
    <Sheet open={open} onClose={onClose} dismissible={!busy}>
      <SheetHeader
        eyebrow="// SPOT"
        title={market.underlyingTicker || market.symbol}
        subtitle={`${market.symbol} · ${fmtPrice(market.currentPriceUsd ?? 0)}`}
        onClose={onClose}
      />

      {orderSide ? (
        swapTraded ? (
          <SpotSwapForm market={market} side={orderSide} position={position} onBack={() => setOrderSide(null)} onClose={onClose} onBusyChange={setBusy} />
        ) : (
          <SpotOrderForm market={market} side={orderSide} position={position} onBack={() => setOrderSide(null)} onClose={onClose} onBusyChange={setBusy} />
        )
      ) : (
        <>
          <div className="cp-hide-scroll" style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, flex: '1 1 auto', minHeight: 0 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {PERIODS.map((p) => (
                <button key={p} onClick={() => setPeriod(p)} style={{ flex: 1, height: 26, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', background: period === p ? 'var(--primary-soft)' : 'transparent', border: `1px solid ${period === p ? 'var(--border-neon)' : 'var(--border)'}`, color: period === p ? 'var(--primary)' : 'var(--text-mute)', clipPath: 'var(--clip-tag)' }}>{p}</button>
              ))}
            </div>

            <CandleChart candles={detail?.candles ?? []} loading={isLoading} height={170} />

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Tag color={isMidas ? 'var(--accent)' : 'var(--primary)'}>{assetClassLabel(market.assetClass)}</Tag>
              {market.sectors[0] && !isMidas && <Tag color="var(--text-dim)">{market.sectors[0]}</Tag>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {isMidas ? (
                <>
                  <Meta label="APY (7d)" value={fmtApy(market.apy7d)} />
                  <Meta label="TVL" value={market.tvlUsd != null ? fmtCompact(market.tvlUsd) : '—'} />
                </>
              ) : (
                <>
                  <Meta label="24h" value={fmtPct(market.change24hPct)} tone={(market.change24hPct ?? 0) >= 0 ? 'pos' : 'neg'} />
                  <Meta label="Mkt cap" value={detail?.marketCap != null ? fmtCompact(detail.marketCap) : '—'} />
                  <Meta label="52w high" value={detail?.priceHigh52w != null ? fmtPrice(detail.priceHigh52w) : '—'} />
                  <Meta label="52w low" value={detail?.priceLow52w != null ? fmtPrice(detail.priceLow52w) : '—'} />
                </>
              )}
            </div>

            {position?.pnl && position.pnl.totalDeposited > 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="cp-eyebrow">Your position</div>
                <Row label="Total P&L" value={fmtSignedUsd(position.pnl.totalPnl)} tone={position.pnl.totalPnl >= 0 ? 'pos' : 'neg'} />
                <Row label="Unrealized" value={fmtSignedUsd(position.pnl.unrealizedPnl)} />
                <Row label="Holding" value={`${position.balance} ${market.symbol}`} />
              </div>
            )}
          </div>

          <div style={{ padding: 16, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tradingClosed && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--warn)' }}>
                <Clock size={13} /> Market closed — trading resumes at the next U.S. session
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <Button variant="success" size="lg" full disabled={tradingClosed} onClick={() => setOrderSide('buy')}>Buy</Button>
              <Button variant="danger" size="lg" full disabled={!hasBalance || tradingClosed} onClick={() => setOrderSide('sell')}>Sell</Button>
            </div>
          </div>
        </>
      )}
    </Sheet>
  );
}

function Meta({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  const color = tone === 'pos' ? 'var(--pos)' : tone === 'neg' ? 'var(--neg)' : 'var(--text)';
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)', padding: '10px 12px' }}>
      <div className="cp-eyebrow">{label}</div>
      <div className="cp-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color, marginTop: 3 }}>{value}</div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  const color = tone === 'pos' ? 'var(--pos)' : tone === 'neg' ? 'var(--neg)' : 'var(--text)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span className="cp-num" style={{ fontFamily: 'var(--font-mono)', color, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
