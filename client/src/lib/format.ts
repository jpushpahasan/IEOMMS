const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-11-23 -> 23 Nov 2026 (unambiguous for UAE users). */
export function fmtDate(v?: string | null) {
  if (!v) return '—';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v);
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function fmtDateTime(v?: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  return d.toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Local wall-clock timestamp from the API ("2026-12-11 01:30:00") -> "11 Dec 2026, 01:30". */
export function fmtTs(v?: string | null, withDate = true) {
  if (!v) return '—';
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (!m) return String(v);
  return withDate ? `${fmtDate(m[1])}, ${m[2]}` : m[2];
}
/** API timestamp -> value for <input type="datetime-local">. */
export const toLocalInput = (v?: string | null) => (v ? String(v).slice(0, 16).replace(' ', 'T') : '');
/** Today's date in the UAE (YYYY-MM-DD). */
export const uaeToday = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
export const uaeNowInput = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 16);

export function fmtMoney(v?: string | number | null, currency = 'AED') {
  if (v === null || v === undefined || v === '') return '—';
  return `${currency} ${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function age(dob?: string | null) {
  if (!dob) return null;
  const d = new Date(`${dob}T00:00:00`);
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}

export function daysUntil(v?: string | null) {
  if (!v) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${v}T00:00:00`).getTime() - today.getTime()) / 864e5);
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export const fileSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
