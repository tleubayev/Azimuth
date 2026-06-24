'use client';

import { useMemo, useState } from 'react';
import { Plus, Minus, Repeat, Settings, Activity } from 'lucide-react';
import {
  Hero, AccountValue, SectionHead, Pill, StatusDot, MarketRow, IconButton, Button, BusyView,
} from '@/components/ui';
import { AssetDetailSheet } from '@/components/trade/AssetDetailSheet';
import { SpotMarketsSheet } from '@/components/trade/SpotMarketsSheet';
import { SpotActivitySheet } from '@/components/trade/SpotActivitySheet';
import { MarketHoursBanner } from '@/components/trade/MarketHoursBanner';
import { AccountMenu, type AccountAddressRow } from '@/components/trade/AccountMenu';
import {
  useTokenizedMarkets, useTokenizedPositions, useTokenizedAccount, useEthUsdc, useEquityMarketStatus, pnlIsDisplayable,
} from '@/lib/hooks/tokenized/queries';
import { useCreateTokenizedAccount } from '@/lib/hooks/tokenized/useTokenizedTrade';
import { useRefreshTokenized } from '@/lib/hooks/tokenized/useRefreshTokenized';
import { useFunding } from '@/components/funding/funding-context';
import { useWallet } from '@/lib/contexts/wallet-context';
import { fmtUsdParts, fmtPrice, fmtApy, fmtSignedUsd, truncTo, shortAddr } from '@/lib/format';
import { assetClassLabel, type TokenizedMarket } from '@/lib/compass/types';

export function SpotScreen() {
  const { evmAddress } = useWallet();
  const { markets, isLoading: marketsLoading } = useTokenizedMarkets();
  const { positions, totalUsd, accountPnl, isLoading: positionsLoading } = useTokenizedPositions();
  const account = useTokenizedAccount();
  const { isClosed: equityMarketClosed } = useEquityMarketStatus();
  const { usdc: safeUsdc, isLoading: safeUsdcLoading } = useEthUsdc(account.accountAddress);
  const create = useCreateTokenizedAccount();
  const { refreshAfterTx } = useRefreshTokenized();
  const { openDeposit, openWithdraw } = useFunding();

  const [detailMarket, setDetailMarket] = useState<TokenizedMarket | null>(null);
  const [marketsOpen, setMarketsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  const marketBySymbol = useMemo(() => {
    const m = new Map<string, TokenizedMarket>();
    markets.forEach((mk) => m.set(mk.symbol, mk));
    return m;
  }, [markets]);

  const positionBySymbol = useMemo(() => {
    const m = new Map<string, (typeof positions)[number]>();
    positions.forEach((p) => m.set(p.symbol, p));
    return m;
  }, [positions]);

  const hasPositions = positions.length > 0;
  const accountValue = totalUsd + safeUsdc;
  const { whole, cents } = fmtUsdParts(accountValue);
  const rwaMarkets = markets.filter((m) => m.provider === 'midas');

  const openDetail = (m: TokenizedMarket) => setDetailMarket(m);

  // Owner EVM wallet + the per-owner Spot account (Safe). The Safe address is the
  // counterfactual address, known even before the account is deployed.
  const accountBtn = <IconButton onClick={() => setAccountOpen(true)}><Settings size={17} /></IconButton>;
  const activityBtn = <IconButton onClick={() => setActivityOpen(true)}><Activity size={17} /></IconButton>;
  const accountRows: AccountAddressRow[] = [
    { label: 'Owner wallet (EVM)', addr: evmAddress, tone: 'cyan' },
    { label: 'Spot account (Safe)', addr: account.accountAddress, tone: 'magenta' },
  ];

  // ── Setup gating ──────────────────────────────────────────────────────────
  // Don't decide create-vs-active until the wallet + account query have settled
  // (a disabled query reports isLoading=false with default needsCreation=false).
  if (!evmAddress || (account.isLoading && !account.accountAddress)) return <BusyView title="Loading spot" />;

  if (account.needsCreation || (!account.isDeployed && !account.isLoading)) {
    return (
      <div className="cp-hide-scroll" style={{ height: '100%', overflowY: 'auto', position: 'relative' }}>
        <Hero eyebrow="// SPOT · TOKENIZED ASSETS" left={accountBtn} right={activityBtn}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, lineHeight: 1.15 }}>
            On-chain access to <span className="cp-neon-cyan">real-world assets.</span>
          </div>
        </Hero>
        <div style={{ padding: '18px 16px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>Set up your account</div>
            <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-dim)' }}>A non-custodial account that holds your tokenized stocks and assets. Setup is sponsored — no gas, one time.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0' }}>
              {accountRows.map((r) => (
                <div key={r.label} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                  <span style={{ color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{r.label}</span>
                  <span className="cp-num" style={{ color: r.tone === 'magenta' ? 'var(--accent)' : 'var(--primary)', fontWeight: 600 }}>{r.addr ? shortAddr(r.addr, 8, 6) : '—'}</span>
                </div>
              ))}
            </div>
            <Button variant="primary" size="lg" full disabled={create.busy} onClick={async () => { await create.createAccount(); account.refetch(); refreshAfterTx(); }}>
              {create.busy ? 'Setting up…' : 'Create account'}
            </Button>
            {create.error && <div style={{ fontSize: 12, color: 'var(--neg)' }}>{create.error}</div>}
          </div>
        </div>

        <AccountMenu open={accountOpen} onClose={() => setAccountOpen(false)} title="Spot account" rows={accountRows} />
      <SpotActivitySheet open={activityOpen} onClose={() => setActivityOpen(false)} />
      </div>
    );
  }

  // Hold the loading screen until the headline data — markets, positions and the
  // account's USDC — has all arrived. Otherwise the active view renders with
  // $0 / 0 positions and the numbers visibly pop in one by one each time the
  // screen opens. `isLoading` is true only on the FIRST load (no cached data), so
  // tab switches back stay instant and background refetches don't reflash this.
  if (marketsLoading || positionsLoading || safeUsdcLoading) return <BusyView title="Loading spot" />;

  // ── Active view ─────────────────────────────────────────────────────────────
  return (
    <div className="cp-hide-scroll" style={{ height: '100%', overflowY: 'auto', position: 'relative' }}>
      <Hero eyebrow="// SPOT · TOKENIZED ASSETS" left={accountBtn} right={activityBtn}>
        <div className="cp-eyebrow" style={{ marginBottom: 4 }}>Account value</div>
        <AccountValue whole={whole} cents={cents} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <Pill tone="solid" dot={<StatusDot tone={hasPositions ? 'green' : 'mute'} pulse={hasPositions} />}>{positions.length} {positions.length === 1 ? 'POSITION' : 'POSITIONS'}</Pill>
          <span className="cp-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-dim)' }}>${truncTo(safeUsdc, 2).toFixed(2)} available</span>
          {pnlIsDisplayable(accountPnl) && (
            <span className="cp-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 700, color: accountPnl.totalPnl >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtSignedUsd(accountPnl.totalPnl)}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <Button variant="secondary" size="md" full icon={<Plus size={14} />} onClick={() => openDeposit('tokenized')}>Deposit</Button>
          <Button variant="secondary" size="md" full icon={<Minus size={14} />} onClick={() => openWithdraw('tokenized')}>Withdraw</Button>
        </div>
      </Hero>

      <div style={{ padding: '18px 16px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {equityMarketClosed && <MarketHoursBanner />}
        <div>
          <SectionHead title={hasPositions ? 'Your holdings' : 'Top markets'} action="Explore" onAction={() => setMarketsOpen(true)} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {hasPositions
              ? positions.map((p) => {
                  const mk = marketBySymbol.get(p.symbol);
                  return (
                    <MarketRow
                      key={p.symbol}
                      ticker={p.underlyingTicker || p.symbol}
                      symbol={p.symbol}
                      sub={`${p.balance} ${p.symbol}`}
                      price={p.balanceUsd != null ? fmtPrice(p.balanceUsd) : fmtPrice(p.currentPriceUsd ?? 0)}
                      change={pnlIsDisplayable(p.pnl) ? Number(p.pnl.totalPnl.toFixed(2)) : null}
                      changeLabel={pnlIsDisplayable(p.pnl) ? fmtSignedUsd(p.pnl.totalPnl) : undefined}
                      held
                      onClick={mk ? () => openDetail(mk) : undefined}
                    />
                  );
                })
              : markets.filter((m) => m.provider !== 'midas').slice(0, 4).map((m) => (
                  <MarketRow key={m.symbol} ticker={m.underlyingTicker || m.symbol} symbol={m.symbol} sub={m.sectors[0] ?? 'EQUITIES'} price={fmtPrice(m.currentPriceUsd ?? 0)} change={m.change24hPct ?? null} onClick={() => openDetail(m)} />
                ))}
          </div>
        </div>

        {rwaMarkets.length > 0 && (
          <div>
            <SectionHead title="Discover · RWA" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rwaMarkets.map((m) => (
                <MarketRow key={m.symbol} ticker={m.underlyingTicker || m.symbol} symbol={m.symbol} sub={assetClassLabel(m.assetClass)} subColor="var(--accent)" price={fmtPrice(m.currentPriceUsd ?? 0)} changeLabel={fmtApy(m.apy7d)} onClick={() => openDetail(m)} />
              ))}
            </div>
          </div>
        )}

        <Button variant="primary" size="lg" full icon={<Repeat size={16} />} disabled={marketsLoading && markets.length === 0} onClick={() => setMarketsOpen(true)}>Explore markets</Button>
      </div>

      <AssetDetailSheet market={detailMarket} position={detailMarket ? positionBySymbol.get(detailMarket.symbol) ?? null : null} onClose={() => setDetailMarket(null)} />
      <SpotMarketsSheet open={marketsOpen} onClose={() => setMarketsOpen(false)} markets={markets} onSelect={(m) => { setMarketsOpen(false); openDetail(m); }} />
      <AccountMenu open={accountOpen} onClose={() => setAccountOpen(false)} title="Spot account" rows={accountRows} />
      <SpotActivitySheet open={activityOpen} onClose={() => setActivityOpen(false)} />
    </div>
  );
}
