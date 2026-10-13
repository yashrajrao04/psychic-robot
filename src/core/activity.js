/**
 * Automatic study-time tracking.
 *
 * Time accrues only while you are actually present: the app visible, and some
 * input — key, pointer, scroll, touch — within the idle limit. Two rules make
 * the numbers mean something:
 *
 *   1. Idle time is never credited. When a session pauses, it banks time up to
 *      your *last activity*, not up to the moment the pause was noticed.
 *      Crediting the gap would hand out five free minutes every time you walked
 *      away, and a study log that flatters you is worse than no log.
 *
 *   2. A short glance away does not end the session. Leave for less than the
 *      limit and it resumes where it was; stay away longer and it is closed and
 *      written to the log, so a new session starts when you come back.
 *
 * Pure: every function takes `now` and the visibility flag, so the whole
 * machine is testable without timers or a DOM.
 */

export const DEFAULT_IDLE_LIMIT_MINUTES = 5;

export const ACTIVE = 'active';
export const PAUSED = 'paused';

export function idleLimitMs(minutes = DEFAULT_IDLE_LIMIT_MINUTES) {
  return Math.max(1, Number(minutes) || DEFAULT_IDLE_LIMIT_MINUTES) * 60 * 1000;
}

/**
 * Begin tracking.
 *
 * @param {object} options
 * @param {string|null} options.subjectId Subject the time belongs to, if known.
 * @param {string|null} options.topicId   Topic in view, if any.
 * @param {string} options.context        Which part of the app — for context in the log.
 */
export function startSession({ subjectId = null, topicId = null, context = '', now = Date.now() } = {}) {
  return {
    subjectId,
    topicId,
    context,
    startedAt: now,
    accruedMs: 0,
    activeSince: now,
    lastActivityAt: now,
    awaySince: null,
  };
}

/** Milliseconds of genuinely present time, including the live stretch. */
export function accruedMs(session, now = Date.now()) {
  if (!session) return 0;
  const live = session.activeSince ? Math.max(0, now - session.activeSince) : 0;
  return session.accruedMs + live;
}

export function sessionState(session) {
  if (!session) return null;
  return session.activeSince ? ACTIVE : PAUSED;
}

/** Record input. Only meaningful while the page is visible. */
export function noteActivity(session, now = Date.now()) {
  if (!session) return session;
  return { ...session, lastActivityAt: now };
}

/**
 * Bank the live stretch and go quiet, crediting only up to `until` — the last
 * moment the learner was demonstrably there.
 */
function pauseAt(session, until, awaySince) {
  if (!session.activeSince) return session;
  const credited = Math.max(0, Math.min(until, Date.now() + 1e12) - session.activeSince);
  return {
    ...session,
    accruedMs: session.accruedMs + Math.max(0, credited),
    activeSince: null,
    awaySince,
  };
}

/** A finished session, in the shape the log stores. */
export function toLogEntry(session, { now = Date.now(), toISODate } = {}) {
  const ms = accruedMs(session, now);
  const endedAt = session.activeSince ? now : session.awaySince || now;
  return {
    subjectId: session.subjectId,
    topicId: session.topicId,
    context: session.context,
    ms,
    startedAt: session.startedAt,
    endedAt,
    iso: toISODate ? toISODate(new Date(endedAt)) : undefined,
  };
}

/**
 * Advance the session against the clock.
 *
 * @param {object} session
 * @param {object} options `{ now, visible, limitMs, hiddenAt }` — `hiddenAt` is
 *   when the tab actually went to the background, if that was observed.
 * @returns {{session: object|null, closed: object|null, transition: string|null}}
 *   `closed` is a finished session to log; `transition` is one of
 *   'paused' | 'resumed' | 'stopped', for the UI to report.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function evaluate(
  session,
  { now = Date.now(), visible = true, limitMs = idleLimitMs(), hiddenAt = null } = {},
) {
  if (!session) return { session, closed: null, transition: null };

  const idleFor = now - session.lastActivityAt;
  const present = visible && idleFor < limitMs;
  const isActive = Boolean(session.activeSince);

  // Present and running: nothing to do.
  if (present && isActive) return { session, closed: null, transition: null };

  // Just left — bank time up to the last moment they were really here.
  //
  // Which moment that is depends on *how* they left. Falling idle is only
  // detectable after the fact, so the credit stops at the last real input.
  // Switching tabs announces itself instantly, so `hiddenAt` is the exact
  // moment — and reading a page for three minutes without touching the mouse
  // should still count as those three minutes. Without that distinction,
  // anyone who reads rather than clicks is billed as idle.
  let current = session;
  let transition = null;
  if (!present && isActive) {
    const leftAt = visible
      ? session.lastActivityAt
      : clamp(hiddenAt ?? session.lastActivityAt, session.lastActivityAt, now);
    current = pauseAt(session, leftAt, leftAt);
    transition = PAUSED;
  }

  // Away long enough to call it a day. Checked in the same pass as the pause
  // above: a tab backgrounded for an hour is throttled to a single tick on
  // return, and that one tick has to both bank the time and close the session.
  if (!current.activeSince) {
    const awayFor = now - (current.awaySince ?? current.lastActivityAt);
    if (awayFor >= limitMs) {
      return { session: null, closed: current, transition: 'stopped' };
    }
  }

  // Back within the grace period: carry on where it left off.
  if (present && !current.activeSince) {
    return {
      session: { ...current, activeSince: now, lastActivityAt: now, awaySince: null },
      closed: null,
      transition: 'resumed',
    };
  }

  return { session: current, closed: null, transition };
}

/** End a session deliberately — switching subject, or closing the app. */
export function endSession(session, { now = Date.now() } = {}) {
  if (!session) return null;
  const settled = session.activeSince ? pauseAt(session, now, now) : session;
  return { ...settled, endedAt: now };
}

/* ---------------------------------------------------------------- totals -- */

const MINUTE = 60 * 1000;

/** Round to whole minutes. Use `formatSpan` for anything user-facing. */
export function toMinutes(ms) {
  return Math.round(ms / MINUTE);
}

/**
 * Human duration. Sub-minute spans show as seconds rather than "0m", which
 * reads as "nothing was recorded" when something was.
 */
export function formatSpan(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return hours < 10 ? `${hours.toFixed(1)}h` : `${Math.round(hours)}h`;
}

/**
 * Sum a log by subject.
 *
 * @param {Array} log    entries from `toLogEntry`
 * @param {object} options `{ since }` — only count entries ending at or after this.
 */
export function totalsBySubject(log = [], { since = null } = {}) {
  const entries = since === null ? log : log.filter((e) => e.endedAt >= since);
  const bySubject = new Map();
  let total = 0;

  for (const entry of entries) {
    const key = entry.subjectId || '__unassigned';
    bySubject.set(key, (bySubject.get(key) || 0) + (entry.ms || 0));
    total += entry.ms || 0;
  }

  const rows = [...bySubject.entries()]
    .map(([subjectId, ms]) => ({
      subjectId: subjectId === '__unassigned' ? null : subjectId,
      ms,
      minutes: toMinutes(ms),
      share: total ? Math.round((ms / total) * 100) : 0,
    }))
    .sort((a, b) => b.ms - a.ms);

  return { rows, total, minutes: toMinutes(total), sessions: entries.length };
}

/** Totals for one day, keyed by the entry's local-date stamp. */
export function totalsForDay(log = [], iso) {
  return totalsBySubject(log.filter((e) => e.iso === iso));
}

/**
 * Merge a finished session into the log, folding it into the previous entry
 * when it continues the same subject within a few minutes. Without this, a day
 * of normal use becomes hundreds of fragments.
 */
export function appendToLog(log, entry, { mergeWindowMs = 10 * MINUTE } = {}) {
  const next = [...log];
  const last = next[next.length - 1];

  if (
    last &&
    last.subjectId === entry.subjectId &&
    last.topicId === entry.topicId &&
    last.iso === entry.iso &&
    entry.startedAt - last.endedAt <= mergeWindowMs
  ) {
    next[next.length - 1] = { ...last, ms: last.ms + entry.ms, endedAt: entry.endedAt };
    return next;
  }

  next.push(entry);
  return next;
}
