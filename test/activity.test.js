import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVE,
  PAUSED,
  accruedMs,
  appendToLog,
  endSession,
  evaluate,
  idleLimitMs,
  noteActivity,
  sessionState,
  startSession,
  toLogEntry,
  toMinutes,
  formatSpan,
  totalsBySubject,
  totalsForDay,
} from '../src/core/activity.js';

const T0 = 1_700_000_000_000;
const MIN = 60 * 1000;
const LIMIT = idleLimitMs(5);

const opts = (now, visible = true) => ({ now, visible, limitMs: LIMIT });

test('time accrues only while present', () => {
  let s = startSession({ subjectId: 'bio', now: T0 });
  assert.equal(sessionState(s), ACTIVE);

  s = noteActivity(s, T0 + 2 * MIN);
  assert.equal(toMinutes(accruedMs(s, T0 + 2 * MIN)), 2);

  // Still active a minute later — the clock keeps running.
  assert.equal(toMinutes(accruedMs(s, T0 + 3 * MIN)), 3);
});

test('idle time is never credited', () => {
  let s = startSession({ subjectId: 'bio', now: T0 });
  s = noteActivity(s, T0 + 10 * MIN); // worked for ten minutes, then walked off

  // Four minutes later nothing has happened yet: still inside the grace period,
  // so the clock is still notionally running.
  assert.equal(evaluate(s, opts(T0 + 14 * MIN)).transition, null);

  // Past the limit, the session closes — and credits only the ten real minutes.
  // The six idle ones are discarded retroactively, not banked.
  const r = evaluate(s, opts(T0 + 16 * MIN));
  assert.equal(r.transition, 'stopped');
  assert.equal(toMinutes(r.closed.accruedMs), 10, 'the idle minutes must not be credited');
});

test('going idle at the keyboard stops the clock outright', () => {
  // Unlike a glance at another tab, falling idle is measured from the last
  // keystroke — so by the time it is detected, the limit has already elapsed
  // and there is nothing to resume into.
  let s = noteActivity(startSession({ subjectId: 'bio', now: T0 }), T0 + MIN);
  const r = evaluate(s, opts(T0 + 6 * MIN + 1));

  assert.equal(r.transition, 'stopped');
  assert.equal(r.session, null);
  assert.equal(toMinutes(r.closed.accruedMs), 1);
});

test('a short glance at another tab resumes the same session', () => {
  let s = startSession({ subjectId: 'bio', now: T0 });
  s = noteActivity(s, T0 + 5 * MIN);

  // Switched to another browser tab — known immediately, so it pauses at once.
  const paused = evaluate(s, { now: T0 + 5 * MIN + 1000, visible: false, limitMs: LIMIT });
  assert.equal(paused.transition, PAUSED);
  assert.equal(sessionState(paused.session), PAUSED);

  // Back two minutes later, inside the five-minute limit.
  const back = noteActivity(paused.session, T0 + 7 * MIN);
  const resumed = evaluate(back, opts(T0 + 7 * MIN));

  assert.equal(resumed.transition, 'resumed');
  assert.equal(sessionState(resumed.session), ACTIVE);
  assert.equal(resumed.closed, null, 'the session was not split');
  assert.equal(
    toMinutes(accruedMs(resumed.session, T0 + 7 * MIN)),
    5,
    'the two minutes away are still excluded',
  );
});

test('five minutes on another tab stops the clock and closes the session', () => {
  let s = startSession({ subjectId: 'bio', now: T0 });
  s = noteActivity(s, T0 + 8 * MIN);

  // Hidden at the 8-minute mark, still hidden five minutes later.
  const paused = evaluate(s, { now: T0 + 8 * MIN + 500, visible: false, limitMs: LIMIT });
  assert.equal(paused.transition, PAUSED);

  const r = evaluate(paused.session, { now: T0 + 13 * MIN + 1, visible: false, limitMs: LIMIT });
  assert.equal(r.transition, 'stopped');
  assert.equal(r.session, null, 'tracking has stopped');
  assert.ok(r.closed, 'and the work so far was banked');
  assert.equal(toMinutes(accruedMs(r.closed, T0 + 13 * MIN)), 8);
});

test('a backgrounded tab pauses immediately rather than waiting to go idle', () => {
  let s = startSession({ subjectId: 'bio', now: T0 });
  s = noteActivity(s, T0 + 3 * MIN);

  // Visible=false one second later: we know they left, so do not wait.
  const r = evaluate(s, { now: T0 + 3 * MIN + 1000, visible: false, limitMs: LIMIT });
  assert.equal(r.transition, PAUSED);
  assert.equal(toMinutes(accruedMs(r.session, T0 + 3 * MIN + 1000)), 3);
});

test('an hour in the background closes the session in a single evaluation', () => {
  // A throttled background tab may only get one tick when it comes back, so
  // that one tick has to both bank the time and stop the clock.
  let s = startSession({ subjectId: 'bio', now: T0 });
  s = noteActivity(s, T0 + 4 * MIN);

  const r = evaluate(s, { now: T0 + 64 * MIN, visible: false, limitMs: LIMIT });
  assert.equal(r.transition, 'stopped');
  assert.equal(r.session, null);
  assert.equal(toMinutes(r.closed.accruedMs), 4, 'only the four real minutes survive');
});

test('ending deliberately banks the time in flight', () => {
  let s = startSession({ subjectId: 'bio', now: T0 });
  const ended = endSession(s, { now: T0 + 6 * MIN });
  assert.equal(toMinutes(ended.accruedMs), 6);
  assert.equal(ended.activeSince, null);
});

test('a log entry carries subject, duration and day', () => {
  let s = startSession({ subjectId: 'bio', topicId: 't1', context: 'learn', now: T0 });
  const entry = toLogEntry(endSession(s, { now: T0 + 25 * MIN }), {
    now: T0 + 25 * MIN,
    toISODate: () => '2025-01-06',
  });

  assert.equal(entry.subjectId, 'bio');
  assert.equal(entry.topicId, 't1');
  assert.equal(entry.context, 'learn');
  assert.equal(toMinutes(entry.ms), 25);
  assert.equal(entry.iso, '2025-01-06');
});

/* ---------------------------------------------------------------- totals -- */

const log = [
  { subjectId: 'bio', ms: 30 * MIN, iso: '2025-01-06', endedAt: T0, startedAt: T0 - 30 * MIN },
  { subjectId: 'math', ms: 60 * MIN, iso: '2025-01-06', endedAt: T0, startedAt: T0 - 60 * MIN },
  { subjectId: 'bio', ms: 10 * MIN, iso: '2025-01-06', endedAt: T0, startedAt: T0 - 10 * MIN },
  { subjectId: null, ms: 20 * MIN, iso: '2025-01-06', endedAt: T0, startedAt: T0 - 20 * MIN },
  { subjectId: 'bio', ms: 15 * MIN, iso: '2025-01-05', endedAt: T0 - 86400000, startedAt: T0 - 86400000 },
];

test('totals group by subject, biggest first, with shares', () => {
  const totals = totalsForDay(log, '2025-01-06');

  assert.equal(totals.minutes, 120);
  assert.deepEqual(
    totals.rows.map((r) => [r.subjectId, r.minutes]),
    [['math', 60], ['bio', 40], [null, 20]],
  );
  assert.equal(totals.rows[0].share, 50);
  assert.equal(totals.rows.reduce((n, r) => n + r.share, 0), 100);
});

test('unattributed time is reported separately, not hidden', () => {
  const totals = totalsForDay(log, '2025-01-06');
  const unassigned = totals.rows.find((r) => r.subjectId === null);
  assert.ok(unassigned, 'planning time still has to show up somewhere');
  assert.equal(unassigned.minutes, 20);
});

test('a since filter windows the log', () => {
  const recent = totalsBySubject(log, { since: T0 - MIN });
  assert.equal(recent.sessions, 4, 'yesterday is excluded');
  assert.equal(totalsBySubject(log).sessions, 5);
  assert.equal(totalsBySubject([]).minutes, 0);
});

test('consecutive stretches on one subject merge instead of fragmenting', () => {
  const base = { subjectId: 'bio', topicId: null, iso: '2025-01-06' };
  let out = [];

  out = appendToLog(out, { ...base, ms: 5 * MIN, startedAt: T0, endedAt: T0 + 5 * MIN });
  // Resumed two minutes later — the same sitting, not a new one.
  out = appendToLog(out, { ...base, ms: 7 * MIN, startedAt: T0 + 7 * MIN, endedAt: T0 + 14 * MIN });

  assert.equal(out.length, 1, 'one sitting, not two fragments');
  assert.equal(toMinutes(out[0].ms), 12);
  assert.equal(out[0].endedAt, T0 + 14 * MIN);

  // An hour later is a separate sitting.
  out = appendToLog(out, { ...base, ms: 3 * MIN, startedAt: T0 + 80 * MIN, endedAt: T0 + 83 * MIN });
  assert.equal(out.length, 2);

  // A different subject never merges.
  out = appendToLog(out, { ...base, subjectId: 'math', ms: 3 * MIN, startedAt: T0 + 84 * MIN, endedAt: T0 + 87 * MIN });
  assert.equal(out.length, 3);
});

test('the idle limit is configurable and clamped to something sane', () => {
  assert.equal(idleLimitMs(5), 5 * MIN);
  assert.equal(idleLimitMs(1), MIN);
  assert.equal(idleLimitMs(0), 5 * MIN, 'zero would stop the clock instantly');
  assert.equal(idleLimitMs(undefined), 5 * MIN);

  // A two-minute limit stops sooner than the default would.
  let s = noteActivity(startSession({ now: T0 }), T0 + MIN);
  const r = evaluate(s, { now: T0 + 3 * MIN + 1, visible: true, limitMs: idleLimitMs(2) });
  assert.equal(r.transition, 'stopped');
});

test('durations read as something rather than "0m"', () => {
  assert.equal(formatSpan(0), '0s');
  assert.equal(formatSpan(1200), '1s');
  assert.equal(formatSpan(45 * 1000), '45s');
  assert.equal(formatSpan(90 * 1000), '2m');
  assert.equal(formatSpan(25 * MIN), '25m');
  assert.equal(formatSpan(90 * MIN), '1.5h');
  assert.equal(formatSpan(12 * 60 * MIN), '12h');
});
