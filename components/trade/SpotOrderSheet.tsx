'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, AlertTriangle } from 'lucide-react';
import { AmountField, Button, Spinner } from '@/components/ui';
import { useEquityOrder, TOKENIZED_LIMITS } from '@/lib/hooks/tokenized/useTokenizedTrade';
import { useTokenizedAccount, useEthUsdc } from '@/lib/hooks/tokenized/queries';
import { useRefreshTokenized } from '@/lib/hooks/tokenized/useRefreshTokenized';
import { fmtTokens, truncTo } from '@/lib/format';
import type { TokenizedMarket, TokenizedPosition } from '@/lib/compass/types';

/** Block explorer tx base + label, derived from the market's settlement chain. */
function explorerFor(chain: string): { base: string; label: string } {
  if (chain === 'base') return { base: 'https://basescan.org/tx/', label: 'View on Basescan' };
  return { base: 'https://etherscan.io/tx/', label: 'View on Etherscan' };
}

/**
 * EQUITY (Ondo) trade form — Fusion order flow:
 * quote → build-order → (approve) → sign order → submit → poll. Embedded inside
 * AssetDetailSheet (not its own Sheet).
 */
export function SpotOrderForm({
  market, side, position, onBack, onClose, onBusyChange,
}: {
  market: TokenizedMarket;
  side: 'buy' | 'sell';
  position?: TokenizedPosition | null;
  onBack: () => void;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const order = useEquityOrder();
  const { refreshAfterTx } = useRefreshTokenized();
  // Spend side of a buy is the Spot account's (Safe) USDC — same balance shown on
  // the screen header. React Query dedupes, so this adds no extra request.
  const account = useTokenizedAccount();
  const { usdc: availableUsdc } = useEthUsdc(account.accountAddress);
  const [amount, setAmount] = useState('');
  const [riskAck, setRiskAck] = useState(false);

  // abort poll on unmount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => order.reset(), []);

  const price = market.currentPriceUsd ?? 0;
  const amtNum = parseFloat(amount || '0') || 0;
  // A sell with no resolvable price can't be USD-gated client-side — skip the gate
  // and let the resolver surface a specific error (mirrors the widget OrderSheet).
  const canCheckUsd = side === 'buy' || price > 0;
  const usdEquivalent = side === 'buy' ? amtNum : amtNum * price;
  // No minimum order — any positive amount can be quoted; smaller orders simply
  // come back with higher recommended slippage (surfaced in the quote + risk gate).
  const aboveMax = canCheckUsd && usdEquivalent > TOKENIZED_LIMITS.MAX_ORDER_USD;
  // A sell can't exceed the held balance.
  const heldBalance = parseFloat(position?.balance ?? '0') || 0;
  const overBalance = side === 'sell' && amtNum > heldBalance;
  const token = side === 'buy' ? 'USDC' : market.symbol;

  // MAX: a sell fills the whole held balance; a buy spends all available USDC,
  // capped at the per-order maximum so it doesn't trip the "above max" gate.
  const buyMax = truncTo(Math.min(availableUsdc, TOKENIZED_LIMITS.MAX_ORDER_USD), 2);
  const setMax = (v: string) => { setAmount(v); setRiskAck(false); if (order.phase === 'quoted') order.reset(); };
  const onMax =
    side === 'sell'
      ? heldBalance > 0 ? () => setMax(position?.balance ?? '0') : undefined
      : buyMax > 0 ? () => setMax(String(buyMax)) : undefined;

  const highSlippage = (order.quote?.recommendedSlippageBps ?? 0) >= 200;
  const needsAck = highSlippage && !riskAck;

  const hint = useMemo(() => {
    if (overBalance) return `Max ${fmtTokens(heldBalance)} ${market.symbol}`;
    if (aboveMax) return `Maximum order is $${TOKENIZED_LIMITS.MAX_ORDER_USD.toLocaleString()}`;
    return null;
  }, [overBalance, heldBalance, market.symbol, aboveMax]);

  // Lock the sheet while a multi-step order is in flight (approve/sign/submit/poll).
  const processing = ['approving', 'signing', 'submitting', 'polling'].includes(order.phase);
  useEffect(() => { onBusyChange?.(processing); }, [processing, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  if (order.phase === 'done' && order.result) {
    const { status, fillTxHash } = order.result;
    const title = status === 'filled' ? `${side === 'buy' ? 'Bought' : 'Sold'} ${market.symbol}`
      : status === 'expired' ? 'Order expired' : status === 'cancelled' ? 'Order cancelled' : 'Order submitted';
    const ok = status === 'filled';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ width: 80, height: 80, display: 'grid', placeItems: 'center', background: ok ? 'var(--pos-soft)' : 'var(--surface-2)', border: `1.5px solid ${ok ? 'var(--pos)' : 'var(--border-strong)'}`, clipPath: 'var(--clip-notch)', boxShadow: ok ? 'var(--glow-green)' : 'none' }}>
          <Check size={36} color={ok ? 'var(--pos)' : 'var(--text-dim)'} />
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700 }}>{title}</div>
        {fillTxHash && (() => {
          const ex = explorerFor(market.chain);
          return (
            <a href={`${ex.base}${fillTxHash}`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--primary)' }}>
              {ex.label} <ExternalLink size={13} />
            </a>
          );
        })()}
        <Button variant="primary" size="lg" full style={{ marginTop: 12 }} onClick={() => { refreshAfterTx(); onClose(); }}>Done</Button>
      </div>
    );
  }

  return (
    <div className="cp-hide-scroll" style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '64vh' }}>
      <button onClick={onBack} disabled={processing} style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', padding: 0 }}>← Back</button>

      <AmountField
        value={amount}
        onChange={(v) => { setAmount(v); setRiskAck(false); if (order.phase === 'quoted') order.reset(); }}
        token={token}
        glyph={side === 'buy' ? '$' : ''}
        availableLabel={side === 'sell' ? 'Holding' : 'Available'}
        available={side === 'sell' ? (position?.balance ?? '0') : truncTo(availableUsdc, 2).toFixed(2)}
        onMax={onMax}
        disabled={processing}
        hint={hint}
        hintError={!!hint}
      />

      {order.phase !== 'quoted' && (
        <p style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-mute)', fontFamily: 'var(--font-mono)' }}>
          No minimum — but the smaller the order, the higher the slippage. We’ll show the quote before you confirm.
        </p>
      )}

      {order.phase === 'quoted' && order.quote && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Row label="You receive (est.)">{order.quote.amountOut ? `${fmtTokens(order.quote.amountOut)} ${order.quote.outSymbol ?? ''}` : '—'}</Row>
          <Row label="Max slippage">{(order.quote.recommendedSlippageBps / 100).toFixed(2)}%</Row>
          {order.quote.estFillSeconds != null && <Row label="Est. fill">~{order.quote.estFillSeconds}s</Row>}
        </div>
      )}

      {order.phase === 'quoted' && highSlippage && (
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'color-mix(in srgb, var(--warn) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--warn) 40%, transparent)', clipPath: 'var(--clip-tag)', padding: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={riskAck} onChange={(e) => setRiskAck(e.target.checked)} style={{ marginTop: 2 }} />
          <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--warn)' }}>
            <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            Thin liquidity — high price impact. I understand and want to proceed.
          </span>
        </label>
      )}

      {processing && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)' }}>
          <Spinner size={22} />
          <p style={{ fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
            {order.phase === 'approving' ? 'Sign approval…' : order.phase === 'signing' ? 'Sign order…' : order.phase === 'submitting' ? 'Submitting…' : 'Waiting for fill…'}
          </p>
        </div>
      )}

      {order.error && <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--neg)', background: 'var(--neg-soft)', padding: '10px 12px', clipPath: 'var(--clip-tag)' }}>{order.error}</div>}

      {!processing && (
        order.phase === 'quoted' && order.quote ? (
          <Button
            variant={side === 'buy' ? 'success' : 'danger'} size="lg" full
            disabled={needsAck}
            onClick={() => order.confirm(side, market.symbol, amount, order.quote!.recommendedSlippageBps)}
          >
            {`Confirm ${side === 'buy' ? 'buy' : 'sell'}`}
          </Button>
        ) : (
          <Button
            variant={side === 'buy' ? 'success' : 'danger'} size="lg" full
            disabled={amtNum <= 0 || aboveMax || overBalance || order.phase === 'quoting'}
            onClick={() => { setRiskAck(false); order.getQuote(side, market.symbol, amount); }}
          >
            {order.phase === 'quoting' ? <><Spinner size={16} color="var(--text-on)" /> Getting quote…</> : `Review ${side === 'buy' ? 'buy' : 'sell'}`}
          </Button>
        )
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span className="cp-num" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)', fontWeight: 600 }}>{children}</span>
    </div>
  );
}
