'use client';

import { useEffect, useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { AmountField, Button, Spinner } from '@/components/ui';
import { useRwaSwap } from '@/lib/hooks/tokenized/useTokenizedTrade';
import { useTokenizedAccount, useEthUsdc } from '@/lib/hooks/tokenized/queries';
import { useRefreshTokenized } from '@/lib/hooks/tokenized/useRefreshTokenized';
import { fmtTokens, truncTo } from '@/lib/format';
import type { TokenizedMarket, TokenizedPosition } from '@/lib/compass/types';

const SLIPPAGES = ['0.1', '0.5', '1.0'];

/** Block explorer tx base + label, derived from the market's settlement chain. */
function explorerFor(chain: string): { base: string; label: string } {
  if (chain === 'base') return { base: 'https://basescan.org/tx/', label: 'View on Basescan' };
  return { base: 'https://etherscan.io/tx/', label: 'View on Etherscan' };
}

/**
 * RWA YIELD (Midas) trade form — swap flow: buy/sell → sign EIP-712 →
 * approve-execute (one tx, gas-sponsored). Embedded inside AssetDetailSheet.
 */
export function SpotSwapForm({
  market, side, position, onBack, onClose, onBusyChange,
}: {
  market: TokenizedMarket;
  side: 'buy' | 'sell';
  position?: TokenizedPosition | null;
  onBack: () => void;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const swap = useRwaSwap();
  const { refreshAfterTx } = useRefreshTokenized();
  // Spend side of a buy is the Spot account's (Safe) USDC — same balance shown on
  // the screen header. React Query dedupes, so this adds no extra request.
  const account = useTokenizedAccount();
  const { usdc: availableUsdc } = useEthUsdc(account.accountAddress);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('0.1');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => swap.reset(), []);

  const amtNum = parseFloat(amount || '0') || 0;
  // A sell can't exceed the held balance.
  const heldBalance = parseFloat(position?.balance ?? '0') || 0;
  const overBalance = side === 'sell' && amtNum > heldBalance;
  const token = side === 'buy' ? 'USDC' : market.symbol;
  const processing = swap.phase === 'reviewing' || swap.phase === 'signing' || swap.phase === 'broadcasting';

  // MAX: a sell fills the whole held balance; a buy spends all available USDC.
  const buyMax = truncTo(availableUsdc, 2);
  const setMax = (v: string) => { setAmount(v); if (swap.phase === 'quoted') swap.reset(); };
  const onMax =
    side === 'sell'
      ? heldBalance > 0 ? () => setMax(position?.balance ?? '0') : undefined
      : buyMax > 0 ? () => setMax(String(buyMax)) : undefined;

  // Lock the sheet while the swap is in flight (review/sign/broadcast).
  useEffect(() => { onBusyChange?.(processing); }, [processing, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  if (swap.phase === 'done') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ width: 80, height: 80, display: 'grid', placeItems: 'center', background: 'var(--pos-soft)', border: '1.5px solid var(--pos)', clipPath: 'var(--clip-notch)', boxShadow: 'var(--glow-green)' }}>
          <Check size={36} color="var(--pos)" />
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700 }}>{side === 'buy' ? 'Bought' : 'Sold'} {market.symbol}</div>
        {swap.txHash && (() => {
          const ex = explorerFor(market.chain);
          return (
            <a href={`${ex.base}${swap.txHash}`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--primary)' }}>
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
        onChange={(v) => { setAmount(v); if (swap.phase === 'quoted') swap.reset(); }}
        token={token}
        glyph={side === 'buy' ? '$' : ''}
        availableLabel={side === 'sell' ? 'Holding' : 'Available'}
        available={side === 'sell' ? (position?.balance ?? '0') : truncTo(availableUsdc, 2).toFixed(2)}
        onMax={onMax}
        disabled={processing}
        hint={overBalance ? `Max ${fmtTokens(heldBalance)} ${market.symbol}` : null}
        hintError={overBalance}
      />

      <div>
        <div className="cp-eyebrow" style={{ marginBottom: 6 }}>Max slippage</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {SLIPPAGES.map((s) => (
            <button key={s} onClick={() => setSlippage(s)} disabled={processing} style={{ flex: 1, height: 32, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, background: slippage === s ? 'var(--primary-soft)' : 'var(--surface-2)', border: `1px solid ${slippage === s ? 'var(--border-neon)' : 'var(--border)'}`, color: slippage === s ? 'var(--primary)' : 'var(--text-dim)', clipPath: 'var(--clip-tag)' }}>{s}%</button>
          ))}
        </div>
      </div>

      {swap.phase === 'quoted' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Row label="You receive (est.)">{swap.estimatedOut ? `${fmtTokens(swap.estimatedOut)} ${side === 'buy' ? market.symbol : 'USDC'}` : '—'}</Row>
          <Row label="Max slippage">{slippage}%</Row>
          <Row label="Settles on">Ethereum</Row>
        </div>
      )}

      {processing && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)' }}>
          <Spinner size={22} />
          <p style={{ fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
            {swap.phase === 'reviewing' ? 'Getting quote…' : swap.phase === 'signing' ? 'Sign in your wallet…' : 'Broadcasting…'}
          </p>
        </div>
      )}

      {swap.error && <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--neg)', background: 'var(--neg-soft)', padding: '10px 12px', clipPath: 'var(--clip-tag)' }}>{swap.error}</div>}

      {!processing && (
        swap.phase === 'quoted' ? (
          <Button variant={side === 'buy' ? 'success' : 'danger'} size="lg" full onClick={() => swap.confirm()}>{`Confirm ${side}`}</Button>
        ) : (
          <Button variant={side === 'buy' ? 'success' : 'danger'} size="lg" full disabled={amtNum <= 0 || overBalance} onClick={() => swap.review(side, market.symbol, amount, slippage)}>{`Review ${side}`}</Button>
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
