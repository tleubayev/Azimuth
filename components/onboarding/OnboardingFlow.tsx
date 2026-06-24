'use client';

import { Send, CandlestickChart, TrendingUp, Wallet } from 'lucide-react';
import { useWallet } from '@/lib/contexts/wallet-context';
import { useTelegram } from '@/lib/providers/telegram-provider';
import { Button, Spinner } from '@/components/ui';
import { AzimuthWordmark } from '@/components/brand/AzimuthWordmark';

/**
 * First-run / signed-out experience (Neon Terminal). Inside Telegram, seamless
 * Privy login auto-runs (useTelegramLogin) — we reflect its progress. Telegram is
 * the only sign-in method.
 */
export function OnboardingFlow() {
  const { isTelegram } = useTelegram();
  const { loginState, retryLogin } = useWallet();
  const loggingIn = loginState === 'logging-in';

  return (
    <div className="cp-scanlines" style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 30, padding: 28, textAlign: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        <AzimuthWordmark height={52} priority />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="cp-eyebrow">azimuth · terminal</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.01em' }}>
            Trade the world&apos;s <span className="cp-neon-cyan">markets.</span>
          </h1>
          <p style={{ maxWidth: 280, fontSize: 13, lineHeight: 1.5, color: 'var(--text-dim)' }}>
            Tokenized stocks, RWAs and perps — funded straight from your TON wallet.
          </p>
        </div>
      </div>

      <ul style={{ width: '100%', maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 12, listStyle: 'none', padding: 0, margin: 0, textAlign: 'left' }}>
        <Feature icon={<CandlestickChart size={16} />} label="Tokenized stocks & RWAs" />
        <Feature icon={<TrendingUp size={16} />} label="Hyperliquid perps · long / short" />
        <Feature icon={<Wallet size={16} />} label="Fund from your TON wallet" />
      </ul>

      <div style={{ width: '100%', maxWidth: 300 }}>
        {loggingIn ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <Spinner size={24} />
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Setting up your wallet…</p>
          </div>
        ) : isTelegram ? (
          <Button variant="primary" size="lg" full icon={<Send size={18} />} onClick={() => retryLogin()}>Continue with Telegram</Button>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-mute)', lineHeight: 1.5 }}>Open this app from your Telegram bot for the full experience.</p>
        )}
      </div>
    </div>
  );
}

function Feature({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: 'var(--text-dim)' }}>
      <span style={{ color: 'var(--primary)', flexShrink: 0, display: 'grid', placeItems: 'center', width: 30, height: 30, background: 'var(--primary-soft)', border: '1px solid var(--border-neon)', clipPath: 'var(--clip-notch)' }}>{icon}</span>
      {label}
    </li>
  );
}
