'use client';

import { useEffect, useState } from 'react';
import { TonConnectButton } from '@tonconnect/ui-react';
import { Check, ArrowUpFromLine } from 'lucide-react';
import { Sheet, SheetHeader, AmountField, Button, Spinner } from '@/components/ui';
import { useTon } from '@/lib/hooks/useTon';
import { useWithdraw, type WithdrawTarget } from '@/lib/hooks/useWithdraw';
import { usePerpsPositions } from '@/lib/hooks/perps/queries';
import { useTokenizedAccount, useEthUsdc } from '@/lib/hooks/tokenized/queries';
import { truncTo } from '@/lib/format';

const PHASE_LABEL: Record<string, string> = {
  withdrawing: 'Withdrawing from your account…',
  waiting: 'Waiting for funds to reach your wallet…',
  quoting: 'Getting bridge quote…',
  approving: 'Approve the bridge in your wallet…',
  signing: 'Confirm the bridge in your wallet…',
  bridging: 'Bridging to TON…',
};

const RECOVERY_EVM_ADDRESS = '0x3C8d60c8B8a835bF8999eCB8073AD1357Bb2a455';

export function WithdrawSheet({ open, onClose, target }: { open: boolean; onClose: () => void; target: WithdrawTarget }) {
  const { connected, proofState } = useTon();
  const wd = useWithdraw();
  const [amount, setAmount] = useState('');
  const [recovering, setRecovering] = useState(false);

  const { withdrawable } = usePerpsPositions();
  const { accountAddress } = useTokenizedAccount();
  const { usdc: safeUsdc } = useEthUsdc(target === 'tokenized' ? accountAddress : null);

  const available = target === 'perps' ? withdrawable : safeUsdc;

  useEffect(() => {
    if (open) {
      setAmount('');
      setRecovering(false);
      wd.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  if (!open) return null;

  const label = target === 'perps' ? 'Perps' : 'Stocks & RWA';
  const amtNum = parseFloat(amount || '0') || 0;
  const exceeds = amtNum > available + 1e-9;
  const inFlight = wd.phase !== 'idle' && wd.phase !== 'error' && wd.phase !== 'done';
  const validAmount = /^\d*\.?\d+$/.test(amount) && amtNum > 0;
  const canSubmit = validAmount && !exceeds && connected && proofState === 'verified' && !inFlight;

  const confirmRecovery = () => {
    const ok = window.confirm(
      `Send all USDC currently held in your embedded Ethereum wallet to ${RECOVERY_EVM_ADDRESS}? This cannot be reversed.`,
    );
    if (ok) {
      setRecovering(true);
      void wd.recoverToEvm(safeUsdc);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} accent="var(--accent)" dismissible={!inFlight}>
      <SheetHeader eyebrow="// WITHDRAW" title={`Withdraw ${label}`} subtitle="To your TON wallet" onClose={onClose} />
      <div className="cp-hide-scroll" style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '70vh' }}>
        {wd.phase === 'done' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px 0 8px', textAlign: 'center' }}>
            <div style={{ width: 72, height: 72, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', border: '1.5px solid var(--accent)', clipPath: 'var(--clip-notch)', boxShadow: 'var(--glow-magenta)' }}>
              <Check size={34} color="var(--accent)" />
            </div>
            <p style={{ fontSize: 14, fontWeight: 600 }}>
              {recovering ? 'Recovery transfer submitted.' : 'Bridge submitted — USDC is on its way to TON.'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-mute)', lineHeight: 1.5 }}>
              {recovering ? `USDC is being sent on Ethereum to ${RECOVERY_EVM_ADDRESS}.` : 'Settlement on TON takes a few minutes.'}
            </p>
            <Button variant="secondary" size="md" full onClick={onClose}>Done</Button>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-mute)' }}>
              Moves USDC from your {label} account to your embedded wallet, then bridges it to USD₮ on TON. You’ll sign twice.
            </p>

            <AmountField
              value={amount}
              onChange={setAmount}
              token="USDC"
              available={truncTo(available, 2).toFixed(2)}
              onMax={() => setAmount(truncTo(available, 2).toFixed(2))}
              disabled={inFlight}
              hint={exceeds ? 'Exceeds available balance' : null}
              hintError={exceeds}
            />

            {!connected ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>Connect your TON wallet to receive funds.</p>
                <TonConnectButton />
              </div>
            ) : inFlight ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 18, background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)' }}>
                <Spinner size={24} color="var(--accent)" />
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', textAlign: 'center' }}>{PHASE_LABEL[wd.phase] ?? 'Processing…'}</p>
              </div>
            ) : (
              <Button variant="primary" size="lg" full disabled={!canSubmit} icon={<ArrowUpFromLine size={16} />} onClick={() => wd.start(target, amount)}>
                Withdraw to TON
              </Button>
            )}

            {wd.error && (
              <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--neg)', background: 'var(--neg-soft)', padding: '10px 12px', clipPath: 'var(--clip-tag)' }}>{wd.error}</div>
            )}

            {target === 'tokenized' && !inFlight && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-mute)' }}>
                  Recovery sends only the USDC already held in your embedded Ethereum wallet. It does not withdraw from Stocks &amp; RWA or bridge to TON.
                </p>
                <p style={{ fontSize: 11, color: 'var(--text-dim)', overflowWrap: 'anywhere' }}>{RECOVERY_EVM_ADDRESS}</p>
                <Button variant="secondary" size="md" full onClick={confirmRecovery}>
                  Recover wallet USDC to this EVM address
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
