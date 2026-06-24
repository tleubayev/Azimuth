'use client';

import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Check, Plus } from 'lucide-react';
import {
  Sheet, SheetHeader, SideToggle, AmountField, Button, Tag, Spinner,
} from '@/components/ui';
import { CandleChart } from './CandleChart';
import { BUILDER_FEE_ENABLED, BUILDER_FEE_RATE } from '@/lib/config/perps';
import { usePerpsCandles, usePerpsPositions } from '@/lib/hooks/perps/queries';
import { usePerpsTrade, usdToContractSize } from '@/lib/hooks/perps/usePerpsTrade';
import { useRefreshPerps } from '@/lib/hooks/perps/useRefreshPerps';
import { fmtPrice, fmtCompact, fmtUsd, fmtSignedUsd, fmtLeverage, truncTo } from '@/lib/format';
import type { PerpsMarket, PerpsPosition, CandleInterval } from '@/lib/compass/types';

export interface PerpsSelection {
  market: PerpsMarket;
  position?: PerpsPosition | null;
}

const INTERVALS: CandleInterval[] = ['15m', '1h', '4h', '1d'];

export function PerpsTradeSheet({
  selection,
  onClose,
  canTrade = true,
  onAddFunds,
}: {
  selection: PerpsSelection | null;
  onClose: () => void;
  /** When false, the market is browsable (chart/price) but the order action is
   *  locked behind funding — the submit becomes an "Add funds to trade" CTA. */
  canTrade?: boolean;
  onAddFunds?: () => void;
}) {
  const open = !!selection;
  const market = selection?.market ?? null;
  const position = selection?.position ?? null;

  const [side, setSide] = useState<'long' | 'short'>('long');
  const [leverage, setLeverage] = useState(1);
  const [interval, setInterval] = useState<CandleInterval>('1h');
  const [amt, setAmt] = useState('');
  const [done, setDone] = useState<{ verb: string } | null>(null);

  const { candles, isLoading: candlesLoading } = usePerpsCandles(open ? market?.asset ?? null : null, interval);
  const { withdrawable } = usePerpsPositions();
  const trade = usePerpsTrade();
  const { refreshAfterTx } = useRefreshPerps();

  useEffect(() => {
    if (selection) {
      // Opening an EXISTING position: start the leverage slider/tag at that
      // position's own leverage, so they don't contradict the panel below (and
      // adding to the position keeps its leverage). A fresh market starts at 1×.
      const pos = selection.position;
      const lev = Math.round(Number(pos?.leverage));
      const maxLev = selection.market.maxLeverage || 1;
      setSide('long');
      setLeverage(pos && Number.isFinite(lev) && lev >= 1 ? Math.min(lev, maxLev) : 1);
      setInterval('1h');
      setAmt('');
      setDone(null);
      trade.setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  const amtNum = parseFloat(amt || '0') || 0;
  const tooLow = amtNum > 0 && amtNum < 10;
  const exceeds = amtNum > withdrawable + 1e-9;
  const canSubmit = amtNum >= 10 && !exceeds && !trade.busy && (market?.markPrice ?? 0) > 0;

  const sideAccent = side === 'long' ? 'var(--pos)' : 'var(--neg)';

  const hint = useMemo(() => {
    if (withdrawable < 10) return 'Deposit at least $10 to trade';
    if (tooLow) return 'Minimum order is $10';
    if (exceeds) return 'Exceeds available balance';
    return null;
  }, [withdrawable, tooLow, exceeds]);

  if (!open || !market) return null;

  const subtitle = `${fmtPrice(market.markPrice)} · Vol ${market.volume24h != null ? fmtCompact(market.volume24h) : '—'}`;

  async function submitOpen() {
    if (!market) return;
    // `amt` is the collateral the user commits; leverage multiplies it into the
    // position's notional. At 1× notional == collateral (unchanged behavior).
    const size = usdToContractSize(amtNum * leverage, market.markPrice, market.szDecimals);
    try {
      await trade.openPosition({ asset: market.asset, side: side === 'long' ? 'buy' : 'sell', size, leverage });
      setDone({ verb: side === 'long' ? 'Long' : 'Short' });
      refreshAfterTx();
    } catch { /* error surfaced via trade.error */ }
  }

  async function submitClose() {
    if (!position) return;
    try {
      await trade.closePosition(position);
      setDone({ verb: 'Closed' });
      refreshAfterTx();
    } catch { /* error surfaced via trade.error */ }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      {done ? (
        <SuccessView verb={done.verb} label={market.asset} accent={done.verb === 'Closed' ? 'var(--primary)' : sideAccent} onClose={onClose} />
      ) : (
        <>
          <SheetHeader eyebrow="// PERPS" title={market.asset} subtitle={subtitle} onClose={onClose} />
          <div className="cp-hide-scroll" style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Tag color="var(--primary)">{market.category.toUpperCase()}</Tag>
              <Tag color="var(--warn)">{market.maxLeverage}× MAX</Tag>
              <Tag color="var(--text-dim)">{leverage}× CROSS</Tag>
            </div>

            {position && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700, letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase', color: 'var(--text-mute)' }}>
                    {position.side} {fmtLeverage(position.leverage)} · {position.size} {market.asset}
                  </div>
                  <div className="cp-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: position.unrealizedPnl >= 0 ? 'var(--pos)' : 'var(--neg)', marginTop: 2 }}>
                    {fmtSignedUsd(position.unrealizedPnl)} P&L
                  </div>
                  {BUILDER_FEE_ENABLED && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-mute)', marginTop: 3 }}>
                      {BUILDER_FEE_RATE} builder fee on close
                    </div>
                  )}
                </div>
                <Button variant="secondary" size="sm" disabled={trade.busy} onClick={submitClose}>
                  {trade.busy ? <Spinner size={15} /> : 'Close'}
                </Button>
              </div>
            )}

            <SideToggle
              value={side}
              onChange={(v) => setSide(v as 'long' | 'short')}
              options={[
                { id: 'long', label: 'Long', color: 'var(--pos)', icon: <TrendingUp size={15} /> },
                { id: 'short', label: 'Short', color: 'var(--neg)', icon: <TrendingDown size={15} /> },
              ]}
            />

            <div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {INTERVALS.map((iv) => (
                  <button
                    key={iv}
                    onClick={() => setInterval(iv)}
                    style={{
                      flex: 1, height: 28, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                      background: interval === iv ? 'var(--primary-soft)' : 'var(--surface-2)',
                      border: `1px solid ${interval === iv ? 'var(--border-neon)' : 'var(--border)'}`,
                      color: interval === iv ? 'var(--primary)' : 'var(--text-dim)', clipPath: 'var(--clip-tag)',
                    }}
                  >
                    {iv}
                  </button>
                ))}
              </div>
              <CandleChart candles={candles} loading={candlesLoading} />
            </div>

            {canTrade && market.maxLeverage > 1 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase', color: 'var(--text-mute)' }}>
                    Leverage
                  </span>
                  <span className="cp-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: sideAccent }}>
                    {leverage}×
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={market.maxLeverage}
                  step={1}
                  value={leverage}
                  onChange={(e) => setLeverage(Number(e.target.value))}
                  aria-label="Leverage"
                  style={{ width: '100%', accentColor: sideAccent, cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-mute)' }}>
                  <span>1×</span>
                  <span>{market.maxLeverage}× max</span>
                </div>
                {leverage > 1 && (
                  <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 10.5, lineHeight: 1.45, color: 'var(--warn)' }}>
                    {leverage}× leverage — a smaller adverse move can liquidate this position.
                  </div>
                )}
              </div>
            )}

            <AmountField
              value={amt}
              onChange={setAmt}
              token="USDC"
              available={truncTo(withdrawable, 2).toFixed(2)}
              onMax={() => setAmt(truncTo(withdrawable, 2).toFixed(2))}
              hint={hint}
              hintError={!!hint && hint !== 'Deposit at least $10 to trade'}
              disabled={!canTrade}
            />

            {amtNum > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>
                <span>Position size · {leverage}×</span>
                <span style={{ color: 'var(--text)', fontWeight: 700 }}>{fmtUsd(amtNum * leverage)}</span>
              </div>
            )}

            {trade.error && (
              <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--neg)', background: 'var(--neg-soft)', padding: '10px 12px', clipPath: 'var(--clip-tag)' }}>
                {trade.error}
              </div>
            )}
          </div>

          <div style={{ padding: 16, borderTop: '1px solid var(--border)' }}>
            {canTrade ? (
              <Button variant={side === 'long' ? 'success' : 'danger'} size="lg" full disabled={!canSubmit} onClick={submitOpen}>
                {trade.busy ? <Spinner size={16} color="var(--text-on)" /> : `${side === 'long' ? 'Long' : 'Short'} ${market.asset}${amtNum > 0 ? ` · ${fmtUsd(amtNum)}` : ''}`}
              </Button>
            ) : (
              <Button variant="primary" size="lg" full icon={<Plus size={16} />} onClick={() => onAddFunds?.()}>
                Add funds to trade
              </Button>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}

function SuccessView({ verb, label, accent, onClose }: { verb: string; label: string; accent: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '46px 24px 22px', textAlign: 'center' }}>
      <div style={{ width: 84, height: 84, display: 'grid', placeItems: 'center', background: `color-mix(in srgb, ${accent} 16%, var(--surface))`, border: `1.5px solid ${accent}`, clipPath: 'var(--clip-notch)', boxShadow: `0 0 28px color-mix(in srgb, ${accent} 60%, transparent)` }}>
        <Check size={40} color={accent} />
      </div>
      <div style={{ marginTop: 22, fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>Order executed</div>
      <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-mute)' }}>
        {verb} {label} · settled on-chain
      </div>
      <div style={{ width: '100%', marginTop: 30 }}>
        <Button variant="primary" size="lg" full onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}
