'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Settings, Activity, Plus, Minus, Zap, Lock, Check } from 'lucide-react';
import {
  Hero, AccountValue, SectionHead, Pill, StatusDot, MarketRow, IconButton, Button, BusyView, Spinner,
} from '@/components/ui';
import { CandleChart } from '@/components/trade/CandleChart';
import { PerpsTradeSheet, type PerpsSelection } from '@/components/trade/PerpsTradeSheet';
import { PerpsActivitySheet } from '@/components/trade/PerpsActivitySheet';
import { AccountMenu, type AccountAddressRow } from '@/components/trade/AccountMenu';
import { usePerpsMarkets, usePerpsPositions } from '@/lib/hooks/perps/queries';
import { usePerpsTrade } from '@/lib/hooks/perps/usePerpsTrade';
import { usePerpsSetup } from '@/lib/hooks/perps/usePerpsSetup';
import { useRefreshPerps } from '@/lib/hooks/perps/useRefreshPerps';
import { useFunding } from '@/components/funding/funding-context';
import { useWallet } from '@/lib/contexts/wallet-context';
import { fmtUsdParts, fmtPrice, fmtSignedUsd, fmtCompact, fmtLeverage, shortAddr, truncTo } from '@/lib/format';
import type { PerpsMarket } from '@/lib/compass/types';

/** How long after a perps deposit we show "funds landing" before reverting to
 *  the plain fund prompt (Hyperliquid normally credits within ~1 min). */
const PENDING_WINDOW_MS = 10 * 60 * 1000;

export function PerpsScreen() {
  const { evmAddress } = useWallet();
  const { markets, isLoading: marketsLoading } = usePerpsMarkets();
  const { positions, accountValue, withdrawable, isLoading: positionsLoading } = usePerpsPositions();
  const setup = usePerpsSetup();
  const trade = usePerpsTrade();
  const { refreshAfterTx } = useRefreshPerps();
  const { openDeposit, openWithdraw, lastDeposit } = useFunding();

  const [selection, setSelection] = useState<PerpsSelection | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const marketByAsset = useMemo(() => {
    const m = new Map<string, PerpsMarket>();
    markets.forEach((mk) => m.set(mk.asset, mk));
    return m;
  }, [markets]);

  const totalPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const hasPositions = positions.length > 0;
  const { whole, cents } = fmtUsdParts(accountValue);

  const heroLeft = <IconButton onClick={() => setAccountOpen(true)}><Settings size={17} /></IconButton>;
  const heroRight = <IconButton onClick={() => setActivityOpen(true)}><Activity size={17} /></IconButton>;

  // Hyperliquid has no separate product account — your perps account IS the
  // embedded EVM wallet (you fund it and trade from it).
  const perpsRows: AccountAddressRow[] = [{ label: 'Perps account (EVM)', addr: evmAddress, tone: 'cyan' }];

  // ── Setup gating: loading → fund → enable → ready ─────────────────────────
  // "Enable trading" stays locked until funds actually land in Hyperliquid
  // (setup.status === 'enable', i.e. accountValue > 0). See usePerpsSetup for
  // why the signing payload alone is NOT a safe go-ahead.
  if (setup.status === 'loading') return <BusyView title="Loading perps" />;

  if (setup.status !== 'ready') {
    const funded = setup.status === 'enable'; // accountValue > 0, not yet unified
    // A perps deposit was just submitted but Hyperliquid hasn't credited it yet
    // (bridge + L1 credit takes ~1 min) — show "landing" instead of a bare lock.
    const depositPending =
      !funded &&
      lastDeposit?.product === 'perps' &&
      Date.now() - lastDeposit.at < PENDING_WINDOW_MS;

    const enable = async () => {
      if (!funded || !setup.signingPayload) return;
      await trade.enableUnifiedAccount(setup.signingPayload);
      refreshAfterTx();
      setup.refresh();
    };

    return (
      <div className="cp-hide-scroll" style={{ height: '100%', overflowY: 'auto', position: 'relative' }}>
        <Hero eyebrow="// PERPS · PUBLIC MARKETS" left={heroLeft} right={heroRight}>
          <div className="cp-eyebrow" style={{ marginBottom: 4 }}>Account value</div>
          <AccountValue whole={whole} cents={cents} />
        </Hero>
        <div style={{ padding: '18px 16px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>Set up perps trading</div>
              <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-dim)', marginTop: 6 }}>
                Fund your account from your TON wallet, then enable trading with a one-time signature.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0' }}>
              {perpsRows.map((r) => (
                <div key={r.label} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                  <span style={{ color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{r.label}</span>
                  <span className="cp-num" style={{ color: 'var(--primary)', fontWeight: 600 }}>{r.addr ? shortAddr(r.addr, 8, 6) : '—'}</span>
                </div>
              ))}
            </div>

            {/* Step 1 — Fund. Must complete before Step 2 unlocks. */}
            <SetupStep
              index={1}
              title="Fund account"
              tone={funded ? 'done' : 'active'}
              icon={funded ? <Check size={15} /> : depositPending ? <Spinner size={15} /> : undefined}
              sub={
                funded
                  ? `$${truncTo(setup.accountValue, 2).toFixed(2)} in your Hyperliquid account`
                  : depositPending
                    ? 'Funds on the way from TON — this usually takes ~1 min.'
                    : 'Bridge USDC from your TON wallet ($15 minimum).'
              }
            >
              {!funded && (
                <Button variant={depositPending ? 'secondary' : 'primary'} size="lg" full icon={<Plus size={16} />} onClick={() => openDeposit('perps')}>
                  {depositPending ? 'Add more funds' : 'Add funds'}
                </Button>
              )}
            </SetupStep>

            {/* Step 2 — Enable. Locked until funds land (accountValue > 0):
                enabling before Hyperliquid holds a balance is rejected. */}
            <SetupStep
              index={2}
              title="Enable trading"
              tone={funded ? 'active' : 'locked'}
              icon={funded ? undefined : <Lock size={13} />}
              sub={
                funded
                  ? 'Sign once to enable your unified account.'
                  : depositPending
                    ? 'Unlocks automatically once your funds land.'
                    : 'Add funds first to unlock.'
              }
            >
              {funded && (
                <Button
                  variant="primary" size="lg" full icon={<Zap size={16} />}
                  disabled={!setup.signingPayload || trade.busy}
                  onClick={enable}
                >
                  {trade.busy ? 'Enabling…' : 'Enable trading'}
                </Button>
              )}
            </SetupStep>

            {trade.error && (
              <div style={{ fontSize: 12, color: 'var(--neg)', lineHeight: 1.5 }}>
                {trade.error} — if you just funded, give it a moment and try again.
              </div>
            )}
          </div>
          <PreviewMarkets markets={markets} loading={marketsLoading} onSelect={setSelection} />
        </div>

        {/* Markets are browsable during setup, but trading is locked until the
            account is funded + enabled — the sheet shows an "Add funds" CTA. */}
        <PerpsTradeSheet
          selection={selection}
          onClose={() => setSelection(null)}
          canTrade={false}
          onAddFunds={() => { setSelection(null); openDeposit('perps'); }}
        />
        <AccountMenu open={accountOpen} onClose={() => setAccountOpen(false)} title="Perps account" rows={perpsRows} />
        <PerpsActivitySheet open={activityOpen} onClose={() => setActivityOpen(false)} />
      </div>
    );
  }

  // The account is enabled, but markets / positions may still be loading on a
  // cold open — hold the loading screen so the active view doesn't flash an empty
  // markets list and a $0 account value that then pop in. `isLoading` is first
  // load only, so tab switches back and background refetches don't reflash.
  if (marketsLoading || positionsLoading) return <BusyView title="Loading perps" />;

  // ── Active view ─────────────────────────────────────────────────────────────
  return (
    <div className="cp-hide-scroll" style={{ height: '100%', overflowY: 'auto', position: 'relative' }}>
      <Hero eyebrow="// PERPS · PUBLIC MARKETS" left={heroLeft} right={heroRight}>
        <div className="cp-eyebrow" style={{ marginBottom: 4 }}>Account value</div>
        <AccountValue whole={whole} cents={cents} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <Pill tone="solid" dot={<StatusDot tone="green" pulse />}>{positions.length} {positions.length === 1 ? 'POSITION' : 'POSITIONS'}</Pill>
          <span className="cp-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-dim)' }}>${truncTo(withdrawable, 2).toFixed(2)} available</span>
          {hasPositions && (
            <span className="cp-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 700, color: totalPnl >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtSignedUsd(totalPnl)} P&L</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <Button variant="secondary" size="md" full icon={<Plus size={14} />} onClick={() => openDeposit('perps')}>Deposit</Button>
          <Button variant="secondary" size="md" full icon={<Minus size={14} />} onClick={() => openWithdraw('perps')}>Withdraw</Button>
        </div>
      </Hero>

      <div style={{ padding: '18px 16px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <SectionHead title={hasPositions ? 'Your positions' : 'Markets'} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {positions.map((p) => {
              const mk = marketByAsset.get(p.asset);
              const mark = p.markPrice ?? mk?.markPrice ?? null;
              return (
                <MarketRow
                  key={p.asset}
                  ticker={p.asset}
                  symbol={fmtLeverage(p.leverage)}
                  sub={`${p.side.toUpperCase()} · ${p.size} ${p.asset}`}
                  price={mark != null ? fmtPrice(mark) : '—'}
                  change={Number(p.unrealizedPnl.toFixed(2))}
                  changeLabel={fmtSignedUsd(p.unrealizedPnl)}
                  held
                  onClick={() => mk && setSelection({ market: mk, position: p })}
                />
              );
            })}
            {markets.slice(0, hasPositions ? 4 : 6).map((m) => (
              <MarketRow
                key={m.asset}
                ticker={m.asset}
                symbol={`${m.maxLeverage}×`}
                sub={m.category.toUpperCase()}
                price={fmtPrice(m.markPrice)}
                changeLabel={m.volume24h != null ? `Vol ${fmtCompact(m.volume24h)}` : undefined}
                onClick={() => setSelection({ market: m })}
              />
            ))}
          </div>
        </div>
      </div>

      <PerpsTradeSheet selection={selection} onClose={() => setSelection(null)} />
      <PerpsActivitySheet open={activityOpen} onClose={() => setActivityOpen(false)} />
      <AccountMenu open={accountOpen} onClose={() => setAccountOpen(false)} title="Perps account" rows={perpsRows} />
    </div>
  );
}

/** One row of the perps setup state machine: a numbered/locked/done step with
 *  an optional CTA. `done` and `active` read full-opacity; `locked` is dimmed. */
type StepTone = 'active' | 'done' | 'locked';

function SetupStep({
  index, title, sub, tone, icon, children,
}: {
  index: number;
  title: ReactNode;
  sub: ReactNode;
  tone: StepTone;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  const c = {
    active: { border: 'var(--border-neon)', bg: 'var(--primary-soft)', fg: 'var(--primary)', glow: 'var(--glow-cyan-sm)' },
    done: { border: 'color-mix(in srgb, var(--pos) 45%, transparent)', bg: 'var(--pos-soft)', fg: 'var(--pos)', glow: 'none' },
    locked: { border: 'var(--border)', bg: 'var(--surface-2)', fg: 'var(--text-mute)', glow: 'none' },
  }[tone];
  return (
    <div style={{ background: 'var(--surface-2)', border: `1px solid ${c.border}`, clipPath: 'var(--clip-notch)', padding: 14, opacity: tone === 'locked' ? 0.6 : 1, boxShadow: c.glow === 'none' ? undefined : c.glow }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 30, height: 30, flexShrink: 0, display: 'grid', placeItems: 'center', background: c.bg, border: `1px solid ${c.border}`, color: c.fg, clipPath: 'var(--clip-notch)', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>
          {icon ?? index}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14.5, fontWeight: 700, color: tone === 'locked' ? 'var(--text-dim)' : 'var(--text)' }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 2, lineHeight: 1.45 }}>{sub}</div>
        </div>
      </div>
      {children && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}

/** Markets list shown during setup — browsable (tap to preview a market), but
 *  the trade action inside the sheet stays locked until the account is funded. */
function PreviewMarkets({
  markets,
  loading,
  onSelect,
}: {
  markets: PerpsMarket[];
  loading: boolean;
  onSelect: (sel: PerpsSelection) => void;
}) {
  return (
    <div>
      <SectionHead title="Markets" />
      {loading && markets.length === 0 ? (
        <CandleChart candles={[]} loading height={120} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {markets.slice(0, 6).map((m) => (
            <MarketRow
              key={m.asset}
              ticker={m.asset}
              symbol={`${m.maxLeverage}×`}
              sub={m.category.toUpperCase()}
              price={fmtPrice(m.markPrice)}
              changeLabel={m.volume24h != null ? `Vol ${fmtCompact(m.volume24h)}` : undefined}
              onClick={() => onSelect({ market: m })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
