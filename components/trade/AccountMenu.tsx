'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Check, LogOut, Wallet } from 'lucide-react';
import { Sheet, SheetHeader, Button, StatusDot } from '@/components/ui';
import { useWallet } from '@/lib/contexts/wallet-context';
import { useTon } from '@/lib/hooks/useTon';
import { shortAddr } from '@/lib/format';

export interface AccountAddressRow {
  label: string;
  addr: string | null;
  tone?: 'cyan' | 'magenta';
}

/**
 * Account menu sheet — copyable address rows (e.g. the trading/owner EVM wallet
 * and a product account address), the TON link status, and logout. Shared by the
 * Perps and Spot screens.
 */
export function AccountMenu({
  open,
  onClose,
  title = 'Account',
  rows,
  showTon = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  rows: AccountAddressRow[];
  showTon?: boolean;
}) {
  const { adapter } = useWallet();
  const { tonAddress, connected, proofState } = useTon();
  if (!open) return null;

  return (
    <Sheet open={open} onClose={onClose} ariaLabel="Account">
      <SheetHeader eyebrow="// ACCOUNT" title={title} onClose={onClose} />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((r) => (
          <AddrRow key={r.label} label={r.label} addr={r.addr} tone={r.tone ?? 'cyan'} />
        ))}
        {showTon && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700, letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase', color: 'var(--text-mute)' }}>
              <Wallet size={14} /> TON wallet
            </span>
            {connected ? (
              <StatusDot tone={proofState === 'verified' ? 'green' : 'amber'} label={shortAddr(tonAddress)} pulse={false} />
            ) : (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>Not connected</span>
            )}
          </div>
        )}
        {adapter.logout && (
          <Button variant="ghost" size="md" full icon={<LogOut size={16} />} onClick={() => adapter.logout?.()}>
            Log out
          </Button>
        )}
      </div>
    </Sheet>
  );
}

function AddrRow({ label, addr, tone }: { label: string; addr: string | null; tone: 'cyan' | 'magenta' }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const color = tone === 'cyan' ? 'var(--primary)' : 'var(--accent)';

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)', cursor: addr ? 'pointer' : 'default', color: 'inherit', textAlign: 'left' }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700, letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase', color: 'var(--text-mute)' }}>{label}</div>
        <div className="cp-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color, marginTop: 3, wordBreak: 'break-all' }}>{addr ? shortAddr(addr, 10, 8) : '—'}</div>
      </div>
      {addr && (copied ? <Check size={16} color="var(--pos)" /> : <Copy size={16} color="var(--text-mute)" />)}
    </button>
  );
}
