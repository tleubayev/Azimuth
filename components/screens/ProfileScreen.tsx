'use client';

import { Wallet, LifeBuoy } from 'lucide-react';
import { Avatar, StatTile, SettingRow } from '@/components/ui';
import { useWallet } from '@/lib/contexts/wallet-context';
import { useTelegram } from '@/lib/providers/telegram-provider';
import { useTon } from '@/lib/hooks/useTon';
import { usePerpsPositions } from '@/lib/hooks/perps/queries';
import { useTokenizedPositions, pnlIsDisplayable } from '@/lib/hooks/tokenized/queries';
import { fmtSignedUsd, shortAddr } from '@/lib/format';

const SUPPORT_URL = 'https://discord.com/invite/ujetyJJPYr';

export function ProfileScreen() {
  const { user } = useTelegram();
  const { evmAddress } = useWallet();
  const { tonAddress, connected, connect, disconnect } = useTon();
  const perps = usePerpsPositions();
  const tok = useTokenizedPositions();

  const name = user?.firstName || user?.username || (evmAddress ? shortAddr(evmAddress) : 'Trader');
  const initial = (name[0] ?? 'C').toUpperCase();
  const caption = user?.username ? `@${user.username}` : evmAddress ? shortAddr(evmAddress, 6, 4) : 'COMPASS';

  const perpsPnl = perps.positions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const tokPnl = pnlIsDisplayable(tok.accountPnl) ? tok.accountPnl.totalPnl : 0;
  const totalPnl = perpsPnl + tokPnl;

  return (
    <div className="cp-hide-scroll" style={{ height: '100%', overflowY: 'auto' }}>
      <div
        className="cp-scanlines"
        style={{
          position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '34px 16px 24px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <Avatar initial={initial} src={user?.photoUrl ?? null} tone="green" size={92} />
        <div style={{ marginTop: 16, fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.01em' }}>{name}</div>
        <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-mute)' }}>{caption}</div>
      </div>

      <div style={{ padding: '18px 16px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <div className="cp-eyebrow" style={{ marginBottom: 10, paddingLeft: 2 }}>Spot + Perps · open P&L</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <StatTile value={fmtSignedUsd(totalPnl)} label="P&L" tone={totalPnl >= 0 ? 'pos' : 'neg'} />
            <StatTile value="—" label="Win rate" tone="cyan" />
            <StatTile value="—" label="Volume" />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SettingRow
            icon={<Wallet size={18} />}
            label="Wallet"
            value={connected ? shortAddr(tonAddress) : 'Connect'}
            valueTone={connected ? 'cyan' : 'mute'}
            iconTone="cyan"
            onClick={() => (connected ? disconnect() : connect())}
          />
          <SettingRow icon={<LifeBuoy size={18} />} label="Support" iconTone="magenta" onClick={() => window.open(SUPPORT_URL, '_blank', 'noopener,noreferrer')} />
        </div>

        <div style={{ textAlign: 'center', marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 10.5, lineHeight: 1.8, color: 'var(--text-mute)', letterSpacing: '0.06em' }}>
          <span>POWERED BY COMPASS SDK</span>
        </div>
      </div>
    </div>
  );
}
