'use client';

import { useState } from 'react';
import { CandlestickChart, User } from 'lucide-react';
import { TgBar, TabBar, BusyView } from '@/components/ui';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { SpotScreen } from '@/components/screens/SpotScreen';
import { ProfileScreen } from '@/components/screens/ProfileScreen';
import { useWallet } from '@/lib/contexts/wallet-context';

type Tab = 'spot' | 'profile';

export function AppShell() {
  const { authenticated, ready } = useWallet();
  const [tab, setTab] = useState<Tab>('spot');

  return (
    <div
      className="cp-app"
      style={{
        // DEFINITE height = Telegram's stable viewport height (falls back to
        // 100dvh outside Telegram). A fixed height makes the screen area scroll
        // internally and keeps the TabBar pinned as an always-visible footer —
        // with min-height the column grows and the nav drops below the fold.
        position: 'relative',
        maxWidth: 'var(--app-w)',
        margin: '0 auto',
        height: 'var(--tg-viewport-stable-height, 100dvh)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <TgBar title="azimuth" />

      <div className="screen-area" style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {!ready ? (
          <BusyView title="Loading azimuth" />
        ) : !authenticated ? (
          <OnboardingFlow />
        ) : tab === 'spot' ? (
          <SpotScreen />
        ) : (
          <ProfileScreen />
        )}
      </div>

      {ready && authenticated && (
        <TabBar
          value={tab}
          onChange={(t) => setTab(t as Tab)}
          items={[
            { id: 'spot', label: 'Spot', icon: <CandlestickChart size={22} /> },
            { id: 'profile', label: 'Profile', icon: <User size={22} /> },
          ]}
        />
      )}
    </div>
  );
}
