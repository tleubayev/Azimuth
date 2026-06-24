/**
 * Number formatting for the Neon Terminal UI.
 *
 * Financial display rule (see memory `feedback_financial_truncation`): NEVER round
 * a displayed balance / position size / USD value UP. Everything here truncates
 * toward zero before formatting.
 */

const MINUS = '−'; // U+2212 minus sign (typographically correct for figures)

/** Coerce any numeric-ish input to a finite number (0 on failure). */
export function toNum(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Truncate toward zero to `dp` decimal places (never rounds up). */
export function truncTo(value: number | string, dp = 2): number {
  const n = toNum(value);
  if (dp <= 0) return Math.trunc(n);
  const f = Math.pow(10, dp);
  return Math.trunc(n * f) / f;
}

function grouped(n: number, dp: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Split a USD value into `{ whole, cents }` for the big hero numeral ($1,240 + .50). */
export function fmtUsdParts(value: number | string): { whole: string; cents: string } {
  const n = Math.abs(truncTo(value, 2));
  const whole = Math.trunc(n).toLocaleString('en-US');
  const cents = Math.round((n - Math.trunc(n)) * 100)
    .toString()
    .padStart(2, '0');
  return { whole, cents };
}

/** "$1,234.56" (truncated). */
export function fmtUsd(value: number | string, dp = 2): string {
  return `$${grouped(truncTo(value, dp), dp)}`;
}

/** Signed USD with color-friendly sign: "+$51.80" / "−$3.20". */
export function fmtSignedUsd(value: number | string, dp = 2): string {
  const n = truncTo(value, dp);
  const sign = n < 0 ? MINUS : '+';
  return `${sign}$${grouped(Math.abs(n), dp)}`;
}

/** Price with adaptive precision (>=10k → 0dp, >=1 → 2dp, <1 → 4dp). */
export function fmtPrice(value: number | string): string {
  const n = truncTo(value, 6);
  const a = Math.abs(n);
  if (a >= 10_000) return `$${grouped(truncTo(n, 0), 0)}`;
  if (a >= 1) return `$${grouped(truncTo(n, 2), 2)}`;
  return `$${grouped(truncTo(n, 4), 4)}`;
}

/** Token quantity: >=1 → 2dp, <1 → up to `dp` (default 4). */
export function fmtTokens(value: number | string, dp = 4): string {
  const n = truncTo(value, dp);
  if (Math.abs(n) >= 1) return grouped(truncTo(n, 2), 2);
  // Trim trailing zeros for small fractional balances.
  return String(truncTo(n, dp));
}

/** Signed percentage: "+1.23%" / "−0.62%" / "—" when null. */
export function fmtPct(value: number | string | null | undefined, dp = 2): string {
  if (value == null || value === '') return '—';
  const n = truncTo(value, dp);
  const sign = n > 0 ? '+' : n < 0 ? MINUS : '';
  return `${sign}${grouped(Math.abs(n), dp)}%`;
}

/** APY from a decimal fraction (e.g. 0.0512 → "5.12% APY"); always ×100. */
export function fmtApy(value: number | string | null | undefined, dp = 2): string {
  if (value == null || value === '') return '—';
  const pct = toNum(value) * 100;
  return `${grouped(truncTo(pct, dp), dp)}% APY`;
}

/** Leverage multiplier: "5×" (drops a trailing ".0"; "—" when absent). */
export function fmtLeverage(value: number | string | null | undefined): string {
  const n = toNum(value);
  if (n > 0) return `${n}×`;
  const raw = value == null ? '' : String(value).trim();
  return raw ? `${raw}×` : '—';
}

/** Compact USD: "$1.2M" / "$3.4B" / "$5.0T". */
export function fmtCompact(value: number | string): string {
  const n = truncTo(value, 0);
  const a = Math.abs(n);
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ];
  for (const [div, suffix] of units) {
    if (a >= div) return `$${truncTo(n / div, 2)}${suffix}`;
  }
  return fmtUsd(n, 0);
}

/** Short address: 0x1234…abcd. */
export function shortAddr(addr: string | null | undefined, lead = 6, tail = 4): string {
  if (!addr) return '';
  if (addr.length <= lead + tail + 1) return addr;
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

/**
 * Normalize a free-typed amount into a canonical dot-decimal string the API can
 * parse. Locale keyboards emit a comma decimal separator ("3,55") which is NOT a
 * valid decimal server-side (Pydantic: "Input should be a valid decimal"), so we
 * convert comma→dot, drop any non-digit/non-dot characters, and collapse to a
 * single decimal point.
 */
export function sanitizeDecimalInput(raw: string): string {
  let s = raw.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const first = s.indexOf('.');
  if (first !== -1) {
    s = s.slice(0, first + 1) + s.slice(first + 1).replace(/\./g, '');
  }
  return s;
}
