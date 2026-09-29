const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const fixed = (v: number, d: number) => v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

/** ₹ lakh, e.g. ₹481.7L (negatives: −₹4.0L) */
export const fmtL = (v: number, d = 1) => `${v < 0 && Math.abs(v) >= 0.5 * 10 ** -d ? '−' : ''}₹${fixed(Math.abs(v), d)}L`;
/** Signed ₹ lakh for changes, e.g. +₹4.0L / −₹21.7L */
export const fmtSL = (v: number, d = 1) => `${v > 0 ? '+' : ''}${fmtL(v, d)}`;
/** Whole number with Indian digit grouping. */
export const fmtInt = (v: number) => Math.round(v).toLocaleString('en-IN');
/** Rupees, e.g. ₹6,892 */
export const fmtInr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
export const fmtPct = (v: number, d = 1) => `${fixed(v, d)}%`;
export const fmtX = (v: number | null, d = 2) => (v === null ? '—' : `${v.toFixed(d)}x`);
export const fmtSigned = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fixed(Math.abs(v), d)}`;

/** "2026-03" → "Mar 2026" (or "March 2026" when long). */
export function monthLabel(m: string, long = false): string {
  const [y, mm] = m.split('-').map(Number);
  const name = MONTH_NAMES[mm - 1];
  return `${long ? name : name.slice(0, 3)} ${y}`;
}
/** "2026-03" → "Mar" */
export const monthShort = (m: string) => MONTH_NAMES[Number(m.split('-')[1]) - 1].slice(0, 3);

export function monthRangeLabel(months: string[]): string {
  if (!months.length) return '—';
  return months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}`;
}

export const pctChange = (cur: number, prev: number) => (prev === 0 ? 0 : ((cur - prev) / prev) * 100);
