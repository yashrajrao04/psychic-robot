/**
 * Activity engine — turns real presence into tracked study time.
 *
 * Browser facts this has to work around:
 *   - A backgrounded tab has its timers throttled to roughly once a minute, so
 *     nothing here may count ticks. Everything is computed from timestamps.
 *   - `visibilitychange` fires the moment the tab is hidden, which is a far
 *     better signal than waiting for input to dry up.
 *   - Input events fire hundreds of times a second, so they are throttled
 *     before touching any state.
 */

import * as store from './store.js';
import { toISODate } from '../core/dates.js';
import {
  ACTIVE,
  PAUSED,
  evaluate,
  endSession,
  idleLimitMs,
  noteActivity,
  startSession,
  toLogEntry,
  accruedMs,
  sessionState,
} from '../core/activity.js';
import { pause as pausePomodoro } from '../core/pomodoro.js';

/** Which app tab maps to which subject, and whether it is subject-specific. */
function currentContext() {
  const state = store.getState();
  const tab = state.tab;
  const topics = store.topicsWithSubject();
  const byId = (id) => topics.find((t) => t.id === id) || null;

  // Tabs that are about one topic attribute their time to that topic's subject.
  let topic = null;
  if (tab === 'pomodoro') topic = byId(state.pomodoro.topicId);
  else if (tab === 'feynman') topic = byId(state.feynman.topicId) || topics[0] || null;

  if (topic) return { subjectId: topic.subjectId, topicId: topic.id, context: tab };

  // Today's scheduled work is the best guess for the planning tabs; if several
  // topics are due, the time is genuinely not attributable to one subject.
  return { subjectId: null, topicId: null, context: tab };
}

function sameContext(a, b) {
  return a && b && a.subjectId === b.subjectId && a.topicId === b.topicId && a.context === b.context;
}

let session = null;
let started = false;
let lastInputAt = 0;
let lastSessionNote = 0;
let hiddenAt = null;
let listeners = [];

/** Live status for the header chip, read on each render. */
export function activityStatus() {
  if (!session) return { state: 'idle', subjectId: null, ms: 0 };
  return {
    state: sessionState(session),
    subjectId: session.subjectId,
    context: session.context,
    ms: accruedMs(session),
  };
}

function closeAndLog(finished, now) {
  if (!finished) return;
  const entry = toLogEntry(finished, { now, toISODate });
  store.logActivity(entry);
}

/** Switch the tracked subject, banking whatever the old one earned. */
function retarget(next, now) {
  if (session) closeAndLog(endSession(session, { now }), now);
  session = startSession({ ...next, now });
}

function step() {
  const now = Date.now();
  const visible = document.visibilityState === 'visible';
  const limitMs = idleLimitMs(store.idleLimitMinutes());
  const context = currentContext();

  if (!session) {
    // Only begin a new session once the learner is actually here.
    if (visible && now - lastInputAt < limitMs) {
      session = startSession({ ...context, now });
      session.lastActivityAt = lastInputAt || now;
      store.setActivityStatus(ACTIVE);
    }
    return;
  }

  // Moved to a different subject or section: bank the old, start the new.
  if (!sameContext(session, context)) {
    retarget(context, now);
    return;
  }

  const before = sessionState(session);
  const result = evaluate(session, { now, visible, limitMs, hiddenAt });
  session = result.session;

  if (result.closed) {
    closeAndLog(result.closed, now);
    store.setActivityStatus('stopped');
    pausePomodoroForAbsence(now);
    return;
  }

  if (result.transition === PAUSED && before !== PAUSED) {
    store.setActivityStatus(PAUSED);
    pausePomodoroForAbsence(now);
  } else if (result.transition === 'resumed') {
    store.setActivityStatus(ACTIVE);
  }
}

/**
 * The same presence rule applies to the Pomodoro: a focus block you were not
 * present for is not a focus block. Progress is paused, never discarded —
 * throwing away twenty real minutes because someone answered the door would be
 * punitive, and the banked time is still honest.
 */
function pausePomodoroForAbsence(now) {
  const { timer } = store.getState().pomodoro;
  if (!timer.running) return;

  // The Pomodoro keeps the progress it has made, unlike the time tracker.
  //
  // The tracker answers "how long were you demonstrably studying?", so it
  // credits only up to your last keystroke. The Pomodoro answers "how far
  // through this block are you?" — a countdown you started deliberately.
  // Rewinding it to the last keystroke means anyone who starts a block and then
  // watches a video without touching the mouse comes back to a timer reset to
  // 25:00, with twenty real minutes silently destroyed. So it freezes where it
  // is: the block stops, which is what was asked for, but nothing is thrown
  // away. Stopping is enough to prevent an unattended block ever completing.
  const until = Math.max(timer.startedAt || 0, Math.min(now, hiddenAt ?? now));
  store.setTimer(pausePomodoro(timer, until));
}


function onInput() {
  const now = Date.now();
  // The timestamp itself is always current — it is one number, and letting the
  // throttle staleify it made "pause at last input" land before the work even
  // started. Only the session-object churn is throttled.
  lastInputAt = now;
  if (now - lastSessionNote < 2000) return;
  lastSessionNote = now;
  if (session) session = noteActivity(session, now);
}

function onVisibility() {
  const now = Date.now();
  if (document.visibilityState === 'visible') {
    hiddenAt = null;
    lastInputAt = now;
    lastSessionNote = now;
    if (session) session = noteActivity(session, now);
  } else {
    // Recorded here because this event is the only place the exact moment of
    // leaving is known; a throttled interval would notice minutes late.
    hiddenAt = now;
  }
  step();
}

/** Bank whatever is in flight before the page goes away. */
function onUnload() {
  if (!session) return;
  closeAndLog(endSession(session, { now: Date.now() }), Date.now());
  session = null;
}

export function startActivityEngine({ intervalMs = 1000 } = {}) {
  if (started) return;
  started = true;
  lastInputAt = Date.now();

  const inputEvents = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart', 'focus'];
  for (const name of inputEvents) {
    const handler = () => onInput();
    window.addEventListener(name, handler, { passive: true, capture: true });
    listeners.push([name, handler]);
  }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onUnload);

  setInterval(step, intervalMs);
  step();
}

/** Test seam: drive the engine by hand without waiting on real minutes. */
export function __debug() {
  return {
    get session() {
      return session;
    },
    step,
    onInput,
    reset() {
      session = null;
      lastInputAt = Date.now();
    },
  };
}
