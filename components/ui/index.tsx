'use client';

/**
 * Compass · Neon Terminal — UI primitives.
 *
 * Typed React ports of the design kit (.context/design/components/core/*.jsx and
 * ui_kits/telegram-app/kit.jsx). Every component styles purely via the CSS custom
 * properties defined in app/globals.css — reference the semantic aliases, never
 * raw hex. Icons are Lucide nodes passed in by callers (lucide-react).
 */

import React, {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Loader2, AlertTriangle, ChevronRight, X, MoreHorizontal } from 'lucide-react';
import { AzimuthMark } from '@/components/brand/AzimuthMark';
import { sanitizeDecimalInput } from '@/lib/format';

/* ────────────────────────────────── Button ───────────────────────────────── */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  notch?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

const BTN_SIZES: Record<ButtonSize, CSSProperties> = {
  sm: { height: 34, fontSize: 13, padding: '0 14px' },
  md: { height: 44, fontSize: 14, padding: '0 20px' },
  lg: { height: 'var(--h-control)', fontSize: 15, padding: '0 24px' },
};

const BTN_VARIANTS: Record<ButtonVariant, CSSProperties> = {
  primary: { background: 'var(--primary)', color: 'var(--text-on)', border: '1px solid var(--primary)', boxShadow: 'var(--glow-cyan-md)' },
  success: { background: 'var(--pos)', color: 'var(--text-on)', border: '1px solid var(--pos)', boxShadow: 'var(--glow-green)' },
  danger: { background: 'var(--neg)', color: 'var(--text-on)', border: '1px solid var(--neg)', boxShadow: 'var(--glow-red)' },
  secondary: { background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border-strong)', boxShadow: 'var(--edge-lit)' },
  ghost: { background: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--border)' },
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  full = false,
  notch = true,
  icon = null,
  iconRight = null,
  disabled = false,
  style,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        width: full ? '100%' : undefined,
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        letterSpacing: '0.02em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        clipPath: notch ? 'var(--clip-notch)' : undefined,
        borderRadius: notch ? 0 : 'var(--r-md)',
        transition: 'transform var(--t-fast) var(--ease-snap), filter var(--t-fast), background var(--t-fast)',
        ...BTN_SIZES[size],
        ...BTN_VARIANTS[variant],
        ...style,
      }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = 'scale(0.97)'; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
      {...rest}
    >
      {icon}
      {children}
      {iconRight}
    </button>
  );
}

/* ──────────────────────────────── IconButton ─────────────────────────────── */

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: number;
  active?: boolean;
}

export function IconButton({ children, size = 38, active = false, style, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      style={{
        width: size,
        height: size,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        background: active ? 'var(--primary-soft)' : 'var(--surface-2)',
        border: `1px solid ${active ? 'var(--border-neon)' : 'var(--border-strong)'}`,
        color: active ? 'var(--primary)' : 'var(--text-dim)',
        clipPath: 'var(--clip-notch)',
        cursor: 'pointer',
        boxShadow: active ? 'var(--glow-cyan-sm)' : 'var(--edge-lit)',
        transition: 'color var(--t-fast), border-color var(--t-fast), background var(--t-fast)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ────────────────────────────────── Panel ────────────────────────────────── */

export interface PanelProps {
  children: ReactNode;
  tone?: 'default' | 'cyan' | 'magenta';
  scanlines?: boolean;
  notch?: boolean;
  glow?: boolean;
  style?: CSSProperties;
}

export function Panel({ children, tone = 'default', scanlines = false, notch = true, glow = false, style }: PanelProps) {
  const tones = {
    default: { border: '1px solid var(--border)', halo: 'none' },
    cyan: { border: '1px solid var(--border-neon)', halo: 'var(--glow-cyan-sm)' },
    magenta: { border: '1px solid var(--accent)', halo: 'var(--glow-magenta)' },
  }[tone];
  return (
    <div
      style={{
        position: 'relative',
        background: 'var(--surface)',
        border: tones.border,
        boxShadow: glow ? `${tones.halo}, var(--edge-lit), var(--shadow-sm)` : 'var(--edge-lit), var(--shadow-sm)',
        clipPath: notch ? 'var(--clip-notch)' : undefined,
        borderRadius: notch ? 0 : 'var(--r-md)',
        padding: 'var(--pad-card)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {scanlines && (
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'var(--tex-scanlines)', backgroundSize: '100% 4px',
            opacity: 0.5, mixBlendMode: 'overlay',
          }}
        />
      )}
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  );
}

/* ─────────────────────────────────── Pill ────────────────────────────────── */

export type PillTone = 'solid' | 'cyan' | 'pos' | 'neg' | 'mute';

export function Pill({ children, tone = 'solid', dot = null, style }: { children: ReactNode; tone?: PillTone; dot?: ReactNode; style?: CSSProperties }) {
  const t = {
    solid: { bg: 'var(--cp-text)', fg: 'var(--text-on)', bd: 'transparent' },
    cyan: { bg: 'var(--primary-soft)', fg: 'var(--primary)', bd: 'var(--border-neon)' },
    pos: { bg: 'var(--pos-soft)', fg: 'var(--pos)', bd: 'transparent' },
    neg: { bg: 'var(--neg-soft)', fg: 'var(--neg)', bd: 'transparent' },
    mute: { bg: 'var(--surface-2)', fg: 'var(--text-dim)', bd: 'var(--border)' },
  }[tone];
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '5px 11px', borderRadius: 'var(--r-pill)',
        background: t.bg, color: t.fg, border: `1px solid ${t.bd}`,
        fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)',
        fontWeight: 600, letterSpacing: 'var(--ls-data)', whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {dot}
      {children}
    </span>
  );
}

/* ──────────────────────────────────── Tag ────────────────────────────────── */

export function Tag({ children, color = 'var(--primary)', tint, style }: { children: ReactNode; color?: string; tint?: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-micro)', fontWeight: 700,
        letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase', color,
        background: tint ?? `color-mix(in srgb, ${color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
        padding: '3px 8px', clipPath: 'var(--clip-tag)', whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/* ──────────────────────────────── StatusDot ──────────────────────────────── */

export type DotTone = 'cyan' | 'green' | 'red' | 'magenta' | 'amber' | 'mute';

export function StatusDot({ tone = 'green', pulse = true, label = null, style }: { tone?: DotTone; pulse?: boolean; label?: ReactNode; style?: CSSProperties }) {
  const t = {
    cyan: { c: 'var(--primary)', g: 'var(--glow-cyan-sm)' },
    green: { c: 'var(--pos)', g: 'var(--glow-green)' },
    red: { c: 'var(--neg)', g: 'var(--glow-red)' },
    magenta: { c: 'var(--accent)', g: 'var(--glow-magenta)' },
    amber: { c: 'var(--warn)', g: '0 0 10px rgba(255,179,31,0.6)' },
    mute: { c: 'var(--text-mute)', g: 'none' },
  }[tone];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...style }}>
      <span
        style={{
          width: 7, height: 7, borderRadius: '50%', background: t.c, boxShadow: t.g,
          animation: pulse ? 'cp-pulse 1400ms var(--ease-out) infinite' : 'none', flexShrink: 0,
        }}
      />
      {label != null && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-micro)', fontWeight: 600, letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
          {label}
        </span>
      )}
    </span>
  );
}

/* ──────────────────────────────── StatTile ───────────────────────────────── */

export function StatTile({ value, label, tone = 'default', align = 'center', style }: { value: ReactNode; label: ReactNode; tone?: 'default' | 'pos' | 'neg' | 'cyan'; align?: 'center' | 'start'; style?: CSSProperties }) {
  const color = { default: 'var(--text)', pos: 'var(--pos)', neg: 'var(--neg)', cyan: 'var(--primary)' }[tone];
  return (
    <div
      style={{
        position: 'relative', background: 'var(--surface)', border: '1px solid var(--border)',
        boxShadow: 'var(--edge-lit)', clipPath: 'var(--clip-notch)', padding: '14px 12px',
        display: 'flex', flexDirection: 'column', alignItems: align === 'center' ? 'center' : 'flex-start', gap: 4,
        ...style,
      }}
    >
      <div className="cp-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-title)', fontWeight: 700, color, textShadow: tone === 'cyan' ? 'var(--text-glow-cyan)' : 'none', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-micro)', fontWeight: 600, letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase', color: 'var(--text-mute)' }}>
        {label}
      </div>
    </div>
  );
}

/* ──────────────────────────────── MarketRow ──────────────────────────────── */

export interface MarketRowProps {
  ticker: ReactNode;
  symbol?: ReactNode;
  sub: ReactNode;
  subColor?: string;
  price: ReactNode;
  change?: number | null;
  changeLabel?: ReactNode;
  held?: boolean;
  /** Greyed-out, not tradable right now (e.g. market closed / halted). */
  unavailable?: boolean;
  /** Small chip beside the ticker when unavailable (e.g. 'Closed'). */
  statusLabel?: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
}

export function MarketRow({ ticker, symbol, sub, subColor = 'var(--primary)', price, change = null, changeLabel = null, held = false, unavailable = false, statusLabel = null, onClick, style }: MarketRowProps) {
  const up = (change ?? 0) >= 0;
  // A bare changeLabel (APY / volume) stays neutral; only a numeric `change` colors.
  const changeColor = change == null ? 'var(--text-dim)' : up ? 'var(--pos)' : 'var(--neg)';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: 'relative', width: '100%', textAlign: 'left',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '12px 14px', background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: held ? '2px solid var(--pos)' : '1px solid var(--border)',
        boxShadow: held ? 'inset 2px 0 12px -6px var(--pos)' : 'var(--edge-lit)',
        clipPath: 'var(--clip-notch)', cursor: onClick ? 'pointer' : 'default', color: 'inherit',
        fontFamily: 'var(--font-display)', transition: 'background var(--t-fast), border-color var(--t-fast)',
        // Greyed out when not tradable — desaturate + dim so it clearly reads as
        // unavailable, while staying tappable to view the chart/details.
        opacity: unavailable ? 0.5 : 1,
        filter: unavailable ? 'grayscale(1)' : undefined,
        ...style,
      }}
      onMouseEnter={unavailable ? undefined : (e) => { e.currentTarget.style.background = 'var(--surface-3)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
      onMouseLeave={unavailable ? undefined : (e) => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.01em' }}>{ticker}</span>
          {symbol != null && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, color: 'var(--text-mute)' }}>{symbol}</span>
          )}
          {statusLabel != null && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 2, padding: '1px 4px', lineHeight: 1 }}>{statusLabel}</span>
          )}
        </div>
        <div style={{ marginTop: 3, fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700, letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase', color: held ? 'var(--text-dim)' : subColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div className="cp-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{price}</div>
        <div className="cp-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 600, color: changeColor, marginTop: 3 }}>
          {changeLabel ?? (change == null ? '—' : `${up ? '+' : ''}${change}%`)}
        </div>
      </div>
    </button>
  );
}

/* ──────────────────────────────── SideToggle ─────────────────────────────── */

export interface SideOption {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  color?: string;
}

export function SideToggle({ options, value, onChange, disabled = false, style }: { options: SideOption[]; value: string; onChange?: (id: string) => void; disabled?: boolean; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: 'grid', gridTemplateColumns: `repeat(${options.length}, 1fr)`, gap: 4, padding: 4,
        background: 'var(--surface-2)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)',
        opacity: disabled ? 0.55 : 1, ...style,
      }}
    >
      {options.map((opt) => {
        const active = value === opt.id;
        const color = opt.color ?? 'var(--primary)';
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            onClick={() => { if (!disabled) onChange?.(opt.id); }}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 40, border: 'none',
              background: active ? color : 'transparent', color: active ? 'var(--text-on)' : 'var(--text-dim)',
              boxShadow: active ? `0 0 16px color-mix(in srgb, ${color} 55%, transparent)` : 'none',
              clipPath: 'var(--clip-notch)', fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700,
              letterSpacing: '0.04em', textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer', transition: 'background var(--t-fast), color var(--t-fast)',
            }}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────── AmountField ────────────────────────────── */

export interface AmountFieldProps {
  value: string;
  onChange?: (v: string) => void;
  token?: string;
  glyph?: string;
  availableLabel?: string;
  available?: string;
  onMax?: () => void;
  hint?: ReactNode;
  hintError?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}

export function AmountField({ value, onChange, token = 'USDC', glyph = '$', availableLabel = 'Available', available = '0.00', onMax, hint = null, hintError = false, disabled = false, style }: AmountFieldProps) {
  return (
    <div
      style={{
        position: 'relative', background: 'var(--surface-2)', border: '1px solid var(--border-strong)',
        boxShadow: 'var(--edge-lit)', clipPath: 'var(--clip-notch)', padding: '16px 18px', opacity: disabled ? 0.6 : 1, ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, color: 'var(--text-mute)' }}>{glyph}</span>
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange?.(sanitizeDecimalInput(e.target.value))}
          style={{
            flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)',
            fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em', padding: 0,
          }}
        />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--text)', background: 'var(--surface-3)', border: '1px solid var(--border-strong)', clipPath: 'var(--clip-tag)', padding: '7px 11px' }}>
          {token}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
        <span className="cp-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: hint && hintError ? 'var(--neg)' : 'var(--text-mute)' }}>
          {hint ?? `${availableLabel}: ${available} ${token}`}
        </span>
        {onMax && (
          <button
            type="button"
            onClick={onMax}
            disabled={disabled}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--primary)', background: 'var(--primary-soft)', border: '1px solid var(--border-neon)', clipPath: 'var(--clip-tag)', padding: '4px 10px', cursor: 'pointer' }}
          >
            MAX
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────────── TabBar ────────────────────────────────── */

export interface TabItem {
  id: string;
  label: ReactNode;
  icon: ReactNode;
}

export function TabBar({ items, value, onChange, style }: { items: TabItem[]; value: string; onChange?: (id: string) => void; style?: CSSProperties }) {
  return (
    <nav
      style={{
        position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${items.length}, 1fr)`,
        height: 'var(--nav-h)', background: 'color-mix(in srgb, var(--bg-void) 88%, transparent)',
        backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        borderTop: '1px solid var(--border-strong)', boxShadow: '0 -8px 24px rgba(0,0,0,0.6)',
        paddingBottom: 'var(--tg-safe-area-inset-bottom)', flexShrink: 0, ...style,
      }}
    >
      {items.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange?.(item.id)}
            style={{
              position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: active ? 'var(--primary)' : 'var(--text-mute)',
              filter: active ? 'drop-shadow(0 0 6px var(--primary))' : 'none', transition: 'color var(--t-fast)',
            }}
          >
            {active && <span aria-hidden style={{ position: 'absolute', top: 0, width: 30, height: 2, background: 'var(--primary)', boxShadow: 'var(--glow-cyan-md)' }} />}
            <span style={{ display: 'grid', placeItems: 'center', height: 22 }}>{item.icon}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* ───────────────────────────────── Avatar ────────────────────────────────── */

export function Avatar({ initial = 'A', src = null, size = 88, tone = 'cyan', style }: { initial?: string; src?: string | null; size?: number; tone?: 'cyan' | 'magenta' | 'green'; style?: CSSProperties }) {
  const t = {
    cyan: { c: 'var(--primary)', g: 'var(--glow-cyan-lg)' },
    magenta: { c: 'var(--accent)', g: 'var(--glow-magenta)' },
    green: { c: 'var(--pos)', g: 'var(--glow-green)' },
  }[tone];
  return (
    <div
      style={{
        width: size, height: size, display: 'grid', placeItems: 'center',
        background: `color-mix(in srgb, ${t.c} 14%, var(--surface))`, border: `1.5px solid ${t.c}`,
        clipPath: 'var(--clip-notch)', boxShadow: t.g, overflow: 'hidden', ...style,
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{ fontFamily: 'var(--font-display)', fontSize: size * 0.42, fontWeight: 700, color: t.c, textShadow: `0 0 16px ${t.c}` }}>{initial}</span>
      )}
    </div>
  );
}

/* ──────────────────────────────── SettingRow ─────────────────────────────── */

export function SettingRow({ icon, label, value = null, valueTone = 'mute', iconTone = 'cyan', onClick, style }: { icon: ReactNode; label: ReactNode; value?: ReactNode; valueTone?: 'mute' | 'cyan' | 'pos'; iconTone?: 'cyan' | 'magenta' | 'green'; onClick?: () => void; style?: CSSProperties }) {
  const it = {
    cyan: { c: 'var(--primary)', bg: 'var(--primary-soft)' },
    magenta: { c: 'var(--accent)', bg: 'var(--accent-soft)' },
    green: { c: 'var(--pos)', bg: 'var(--pos-soft)' },
  }[iconTone];
  const valueColor = { mute: 'var(--text-mute)', cyan: 'var(--primary)', pos: 'var(--pos)' }[valueTone];
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
        background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--edge-lit)',
        clipPath: 'var(--clip-notch)', cursor: onClick ? 'pointer' : 'default', color: 'inherit',
        fontFamily: 'var(--font-display)', textAlign: 'left', transition: 'background var(--t-fast), border-color var(--t-fast)', ...style,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-3)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      <span style={{ width: 40, height: 40, flexShrink: 0, display: 'grid', placeItems: 'center', background: it.bg, border: `1px solid color-mix(in srgb, ${it.c} 45%, transparent)`, color: it.c, clipPath: 'var(--clip-notch)' }}>
        {icon}
      </span>
      <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
      {value != null && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: valueColor }}>{value}</span>}
      <ChevronRight size={18} color="var(--text-mute)" style={{ flexShrink: 0 }} />
    </button>
  );
}

/* ─────────────────────────────── SheetHeader ─────────────────────────────── */

export function SheetHeader({ eyebrow = null, title, subtitle = null, onClose, style }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; onClose?: () => void; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '18px 18px 14px', borderBottom: '1px solid var(--border)', ...style }}>
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-micro)', fontWeight: 600, letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--primary)', marginBottom: 5 }}>{eyebrow}</div>}
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-h3)', fontWeight: 700, color: 'var(--text)', lineHeight: 1.1 }}>{title}</div>
        {subtitle && <div className="cp-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>{subtitle}</div>}
      </div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', border: '1px solid var(--border-strong)', color: 'var(--text-dim)', clipPath: 'var(--clip-notch)', cursor: 'pointer' }}>
          <X size={16} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}

/* ───────────────────────────── Chrome: TgBar ─────────────────────────────── */

export function TgBar({ title = 'azimuth', onClose, onMenu }: { title?: string; onClose?: () => void; onMenu?: () => void }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
        paddingTop: 'calc(12px + var(--tg-safe-area-inset-top))',
        background: 'color-mix(in srgb, var(--bg-void) 92%, transparent)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}
    >
      <button type="button" onClick={onClose} aria-label="Close" style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', visibility: onClose ? 'visible' : 'hidden' }}>
        <X size={20} />
      </button>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text)' }}>
        <span style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', border: '1px solid var(--border-neon)', clipPath: 'var(--clip-notch)', boxShadow: 'var(--glow-cyan-sm)' }}>
          <AzimuthMark size={13} />
        </span>
        {title}
      </div>
      <button type="button" onClick={onMenu} aria-label="More" style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', visibility: onMenu ? 'visible' : 'hidden' }}>
        <MoreHorizontal size={18} />
      </button>
    </div>
  );
}

/* ───────────────────────────── Chrome: Hero ──────────────────────────────── */

export function Hero({ eyebrow, left, right, children }: { eyebrow: ReactNode; left?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div
      className="cp-scanlines"
      style={{
        position: 'relative', flexShrink: 0, padding: '18px 16px 22px',
        background: 'linear-gradient(180deg, var(--surface) 0%, var(--bg) 100%)',
        borderBottom: '1px solid var(--border-strong)', overflow: 'hidden',
      }}
    >
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
          {left ?? <span style={{ width: 38 }} />}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-mute)' }}>{eyebrow}</span>
          {right ?? <span style={{ width: 38 }} />}
        </div>
        {children}
      </div>
    </div>
  );
}

/* ─────────────────────────── Chrome: AccountValue ────────────────────────── */

export function AccountValue({ whole, cents }: { whole: string; cents: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', fontFamily: 'var(--font-mono)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ fontSize: 46, fontWeight: 700, color: 'var(--text)', textShadow: '0 0 18px rgba(0,234,255,0.25)' }}>${whole}</span>
      <span style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-mute)', marginLeft: 2 }}>.{cents}</span>
    </div>
  );
}

/* ─────────────────────────── Chrome: SectionHead ─────────────────────────── */

export function SectionHead({ title, action, onAction }: { title: ReactNode; action?: ReactNode; onAction?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 2px 10px' }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.01em' }}>{title}</span>
      {action && (
        <button type="button" onClick={onAction} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--primary)' }}>
          {action}
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────── Sheet ───────────────────────────────── */

/**
 * Bottom sheet — scrim + container that slides up from the base of the screen
 * area. Mount it inside a `position: relative` container (the AppShell
 * screen-area). Renders nothing when `open` is false.
 *
 * Height is capped to `min(maxHeight, --tg-viewport-height)`. The static `dvh`
 * cap alone is NOT keyboard-aware: iOS WebKit doesn't recompute viewport units
 * when the on-screen keyboard opens, so a `92dvh` sheet stays full-screen-tall
 * while Telegram has shrunk the visible band to above the keyboard — the content
 * then gets crammed/compressed and tall items (e.g. the candle chart) pushed out
 * of view. `--tg-viewport-height` is the live height Telegram updates on every
 * keyboard toggle, so capping to it lets the inner `overflow-y:auto` scroll
 * cleanly instead. Falls back to the `dvh` cap outside Telegram (dev browser).
 */
export function Sheet({ open, onClose, children, accent = 'var(--border-neon)', maxHeight = '92dvh', dismissible = true, ariaLabel = 'Dialog' }: { open: boolean; onClose: () => void; children: ReactNode; accent?: string; maxHeight?: string; dismissible?: boolean; ariaLabel?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  // Focus the dialog on open (a11y); allow Esc to close ONLY when dismissible
  // (a money flow in-flight passes dismissible=false so it can't be torn down).
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    if (!dismissible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissible, onClose]);

  if (!open) return null;
  return (
    <>
      <div onClick={dismissible ? onClose : undefined} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(2,4,9,0.7)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', cursor: dismissible ? 'pointer' : 'default', animation: 'cp-rise var(--t-med) ease-out' }} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          outline: 'none',
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 61, maxHeight: `min(${maxHeight}, var(--tg-viewport-height, 100dvh))`,
          width: '100%', maxWidth: 'var(--app-w)', margin: '0 auto',
          display: 'flex', flexDirection: 'column', background: 'var(--bg)', borderTop: `1px solid ${accent}`,
          boxShadow: '0 -24px 60px rgba(0,0,0,0.8), 0 0 30px rgba(0,234,255,0.12)',
          clipPath: 'polygon(14px 0, 100% 0, 100% 100%, 0 100%, 0 14px)',
          animation: 'cp-sheet-up 320ms var(--ease-out)',
          paddingBottom: 'calc(12px + var(--tg-safe-area-inset-bottom))',
        }}
      >
        {children}
      </div>
    </>
  );
}

/* ─────────────────────────────── Busy / Error ────────────────────────────── */

export function Spinner({ size = 24, color = 'var(--primary)', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return <Loader2 size={size} color={color} style={{ animation: 'cp-spin 0.8s linear infinite', ...style }} />;
}

export function BusyView({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center' }}>
      <Spinner size={28} />
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13, color: 'var(--text-mute)', maxWidth: 280 }}>{subtitle}</div>}
    </div>
  );
}

export function ErrorView({ title, message, onRetry }: { title: ReactNode; message?: ReactNode; onRetry?: () => void }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, display: 'grid', placeItems: 'center', background: 'var(--neg-soft)', border: '1.5px solid var(--neg)', clipPath: 'var(--clip-notch)', boxShadow: 'var(--glow-red)' }}>
        <AlertTriangle size={28} color="var(--neg)" />
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
      {message && <div style={{ fontSize: 13, color: 'var(--text-mute)', maxWidth: 300, lineHeight: 1.5 }}>{message}</div>}
      {onRetry && <Button variant="secondary" size="md" onClick={onRetry}>Retry</Button>}
    </div>
  );
}
