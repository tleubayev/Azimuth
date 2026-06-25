'use client';

import { useCallback, useEffect, useState } from 'react';
import { TonConnectButton } from '@tonconnect/ui-react';
import { ArrowDownToLine, Clock, Receipt, Wallet, Check, CreditCard } from 'lucide-react';
import { Sheet, SheetHeader, AmountField, Button, SideToggle, Spinner } from '@/components/ui';
import { useTon } from '@/lib/hooks/useTon';
import { useFunding } from '@/lib/hooks/useFunding';
import { useFunding as useFundingControls } from './funding-context';
import { useWallet } from '@/lib/contexts/wallet-context';
import { depositableAmount } from '@/lib/deposit/deposit';
import { buildHostedCheckoutUrl, openExternal } from '@/lib/funding/halliday';
import { truncTo } from '@/lib/format';
import { FUNDING_OPTION_KEYS, FUNDING_TARGETS, type FundingTargetKey } from '@/lib/config/chains';

/** Render a Symbiosis base-units token amount human-readable (truncate, 2dp). */
function fmtBase(a: { amount: string; decimals?: number } | null | undefined): string {
  if (!a) return '0';
  const decimals = a.decimals ?? 6;
  const raw = a.amount.replace(/[^0-9]/g, '');
  if (!raw) return '0';
  const digits = raw.padStart(decimals + 1, '0');
  const intPart = digits.slice(0, digits.length - decimals).replace(/^0+(?=\d)/, '');
  const frac = decimals > 0 ? digits.slice(digits.length - decimals).slice(0, 2) : '';
  return frac ? `${intPart}.${frac}` : intPart;
}

export function DepositSheet({ open, onClose, target: initialTarget }: { open: boolean; onClose: () => void; target: FundingTargetKey }) {
  const { connected, proofState } = useTon();
  const funding = useFunding();
  const { markDeposited } = useFundingControls();
  const { evmAddress } = useWallet();
  const [target, setTarget] = useState<FundingTargetKey>(initialTarget);
  const [amount, setAmount] = useState('');

  const { reset: resetFunding, refreshBalance } = funding;

  useEffect(() => {
    if (open) {
      setTarget(initialTarget);
      setAmount('');
      resetFunding();
      void refreshBalance(initialTarget);
    }
  }, [open, initialTarget, resetFunding, refreshBalance]);

  // Once a deposit lands, record it so the perps setup machine can show a
  // "funds landing" state until Hyperliquid credits the account value.
  useEffect(() => {
    if (funding.phase === 'done') markDeposited(FUNDING_TARGETS[target].product);
  }, [funding.phase, target, markDeposited]);

  const inFlight =
    funding.phase === 'signing' ||
    funding.phase === 'bridging' ||
    funding.phase === 'awaiting_funds' ||
    funding.phase === 'depositing';
  const hasQuote = funding.phase === 'quoted';

  // "Buy with card" (Halliday) — tokenized/Ethereum only (card → USDC on Ethereum).
  // Expected primary path is the external-browser fallback: Telegram's WebView
  // blocks Halliday's hosted KYC iframe/popups (same reason the Privy useFundWallet
  // path is dead here), so we open the Compass-hosted /onramp/checkout in the system
  // browser via openLink, snapshot the wallet balance, and let useFunding's arrival
  // poll auto-deposit once the USDC lands. See
  // docs/plans/2026-06-23-halliday-onramp-integration/04-telegram-miniapp-buy-with-card.md.
  const { startCardFunding } = funding;
  const cardFundingEnabled = Boolean(FUNDING_TARGETS[target].cardFundingEnabled);
  const showCardFunding = cardFundingEnabled && !inFlight && funding.phase !== 'done';
  const onBuyWithCard = useCallback(async () => {
    if (!evmAddress) return;
    // Snapshot the pre-purchase balance + start the arrival poll, THEN launch the
    // browser. (Ordering: arm the poll before the user leaves so funds aren't missed.)
    const started = await startCardFunding(target);
    if (!started) return;
    openExternal(buildHostedCheckoutUrl({ address: evmAddress }));
  }, [evmAddress, target, startCardFunding]);

  const changeTarget = useCallback(
    (k: FundingTargetKey) => {
      setTarget(k);
      if (hasQuote) resetFunding();
      void refreshBalance(k);
    },
    [hasQuote, resetFunding, refreshBalance],
  );
  const changeAmount = useCallback(
    (v: string) => {
      setAmount(v);
      if (hasQuote) resetFunding();
    },
    [hasQuote, resetFunding],
  );

  if (!open) return null;
  const preset = FUNDING_TARGETS[target];
  const wallet = funding.walletUsdc ?? 0;
  const depositable = funding.walletUsdc != null ? depositableAmount(preset, wallet) : null;
  const showDepositExisting = depositable != null && !inFlight && funding.phase !== 'done';

  return (
    <Sheet open={open} onClose={onClose} accent="var(--border-neon)" dismissible={!inFlight}>
      <SheetHeader eyebrow="// DEPOSIT" title={`Fund ${preset.label}`} subtitle={cardFundingEnabled ? 'Buy with a card or bridge from TON' : 'From your TON wallet'} onClose={onClose} />
      <div className="cp-hide-scroll" style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '70vh' }}>
        {funding.phase === 'done' ? (
          <Done label={preset.label} onClose={onClose} />
        ) : (
          <>
            <SideToggle
              value={target}
              onChange={(k) => changeTarget(k as FundingTargetKey)}
              disabled={inFlight}
              options={FUNDING_OPTION_KEYS.map((k) => ({ id: k, label: FUNDING_TARGETS[k].label, color: 'var(--primary)' }))}
            />
            <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-mute)' }}>{preset.description}</p>

            {showDepositExisting && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-dim)' }}>
                  <Wallet size={15} color="var(--primary)" />
                  <span className="cp-num" style={{ fontFamily: 'var(--font-mono)' }}>${truncTo(wallet, 2).toFixed(2)}</span> in wallet
                </span>
                <Button variant="primary" size="sm" onClick={() => funding.depositExisting(target)}>Deposit ${depositable}</Button>
              </div>
            )}

            {/* Buy with card (Halliday fiat on-ramp) — tokenized/Ethereum only. */}
            {showCardFunding && (
              <Button
                variant="primary"
                size="lg"
                full
                icon={<CreditCard size={16} />}
                disabled={!evmAddress}
                onClick={onBuyWithCard}
              >
                {evmAddress ? 'Buy with card' : 'Preparing wallet…'}
              </Button>
            )}

            {/* In-flight panel — shared by the card on-ramp and the TON bridge so it
                renders whether or not a TON wallet is connected. */}
            {inFlight && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 18, background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)' }}>
                <Spinner size={24} />
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  {funding.phase === 'signing'
                    ? 'Confirm in your TON wallet…'
                    : funding.phase === 'depositing'
                      ? `Depositing into ${preset.label}…`
                      : funding.phase === 'awaiting_funds'
                        ? 'Waiting for your card purchase…'
                        : 'Bridging — waiting for funds…'}
                </p>
                {funding.phase === 'awaiting_funds' && (
                  <p style={{ fontSize: 12, color: 'var(--text-mute)', textAlign: 'center', lineHeight: 1.5 }}>
                    Complete your card purchase in the browser, then return here — we’ll deposit your USDC automatically once it arrives.
                  </p>
                )}
                {funding.phase === 'bridging' && (
                  <p style={{ fontSize: 12, color: 'var(--text-mute)', textAlign: 'center', lineHeight: 1.5 }}>
                    This usually takes a few minutes. We’ll deposit automatically once it lands.
                  </p>
                )}
              </div>
            )}

            {/* The TON-bridge funding section is hidden while any funding leg is
                in-flight (card or bridge) — the shared panel above shows progress. */}
            {!inFlight && (
              <>
            <div className="cp-eyebrow" style={{ marginTop: 2 }}>{cardFundingEnabled ? 'Or bridge from TON' : 'Bridge from TON'}</div>

            <AmountField
              value={amount}
              onChange={changeAmount}
              token="USDC"
              availableLabel="Bridged to"
              available={preset.chainName}
              disabled={inFlight}
              hint={inFlight ? 'Bridging in progress…' : null}
            />

            {!connected ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>Connect your TON wallet to bridge funds.</p>
                <TonConnectButton />
              </div>
            ) : (
              <>
                {(funding.phase === 'idle' || funding.phase === 'quoting' || funding.phase === 'error') && !hasQuote && (
                  <Button
                    variant="primary"
                    size="lg"
                    full
                    disabled={funding.phase === 'quoting' || proofState !== 'verified'}
                    onClick={() => funding.getQuote(target, amount)}
                  >
                    {funding.phase === 'quoting' ? <><Spinner size={16} color="var(--text-on)" /> Getting quote…</>
                      : proofState === 'pending' ? <><Spinner size={16} color="var(--text-on)" /> Verifying wallet…</>
                      : 'Get quote'}
                  </Button>
                )}

                {hasQuote && funding.quote && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <Row icon={<ArrowDownToLine size={14} />} label="You receive">{fmtBase(funding.quote.amountOut)} {funding.quote.amountOut.symbol ?? 'USDC'}</Row>
                      {funding.quote.fee && <Row icon={<Receipt size={14} />} label="Fee">{fmtBase(funding.quote.fee)} {funding.quote.fee.symbol ?? ''}</Row>}
                      {funding.quote.estimatedTimeSeconds != null && <Row icon={<Clock size={14} />} label="Est. time">~{Math.round(funding.quote.estimatedTimeSeconds / 60)} min</Row>}
                    </div>
                    <Button variant="primary" size="lg" full onClick={() => funding.confirm()}>Sign in TON wallet</Button>
                    <Button variant="ghost" size="sm" full onClick={funding.reset}>Change amount</Button>
                  </div>
                )}
              </>
            )}
              </>
            )}

            {funding.error && (
              <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--neg)', background: 'var(--neg-soft)', padding: '10px 12px', clipPath: 'var(--clip-tag)' }}>{funding.error}</div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function Done({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px 0 8px', textAlign: 'center' }}>
      <div style={{ width: 72, height: 72, display: 'grid', placeItems: 'center', background: 'var(--pos-soft)', border: '1.5px solid var(--pos)', clipPath: 'var(--clip-notch)', boxShadow: 'var(--glow-green)' }}>
        <Check size={34} color="var(--pos)" />
      </div>
      <p style={{ fontSize: 14, fontWeight: 600 }}>Funded — your {label} account is ready.</p>
      <Button variant="secondary" size="md" full onClick={onClose}>Back to trading</Button>
    </div>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-dim)' }}>{icon}{label}</span>
      <span className="cp-num" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)', fontWeight: 600 }}>{children}</span>
    </div>
  );
}
