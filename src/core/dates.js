/**
 * Small date helpers. Everything works on local-midnight `Date` objects so that
 * day arithmetic never drifts across DST boundaries.
 */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Strip the time component, returning a new Date at local midnight. */
export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Add `n` whole days, staying anchored to local midnight. */
export function addDays(date, n) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** `YYYY-MM-DD` in local time (not UTC — `toISOString` would shift the day). */
export function toISODate(date) {
  const d = startOfDay(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Parse `YYYY-MM-DD` as a local-midnight date. */
export function fromISODate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Parse `YYYY-MM-DD` + `HH:MM` as a local date-time. */
export function fromISODateTime(iso, time = '09:00') {
  const [y, m, d] = String(iso).split('-').map(Number);
  const [hh, mm] = String(time).split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
}

/** Whole days between two dates, ignoring time-of-day. */
export function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / MS_PER_DAY);
}

export function isSameDay(a, b) {
  return toISODate(a) === toISODate(b);
}

/** e.g. "Mon 3 Nov" */
export function formatShort(date) {
  const d = startOfDay(date);
  return `${WEEKDAY_NAMES[d.getDay()]} ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
}

/** e.g. "Monday, 3 November 2025" */
export function formatLong(date) {
  return startOfDay(date).toLocaleDateString('en', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Absolute UTC stamp, e.g. `20251103T090000Z`. Used for DTSTAMP, which records
 * when the file was written and genuinely is a moment in time.
 */
export function toICSStamp(date) {
  return (
    `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
    `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`
  );
}

/**
 * Local wall-clock stamp with no timezone suffix, e.g. `20251103T090000`.
 *
 * RFC 5545 calls this a floating time, and it is the right semantics for a
 * study session: 18:00 means six in the evening wherever you happen to be.
 * Writing an absolute UTC instant instead would move every session by the
 * offset between the machine that generated the file and the calendar that
 * reads it — and would shift again the moment you travelled.
 */
export function toICSLocalStamp(date) {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  );
}
