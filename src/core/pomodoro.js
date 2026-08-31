/**
 * Pomodoro timer — a pure state machine.
 *
 * All state is timestamps, never a countdown integer that something has to
 * decrement. A tick is therefore just arithmetic against the clock, which means
 * the timer stays correct when the tab is throttled, backgrounded, or reloaded
 * mid-session — the three places naive timers quietly lose minutes.
 */

export const FOCUS = 'focus';
export const SHORT_BREAK = 'shortBreak';
export const LONG_BREAK = 'longBreak';

export const PHASE_LABELS = {
  [FOCUS]: 'Focus',
  [SHORT_BREAK]: 'Short break',
  [LONG_BREAK]: 'Long break',
};

export const DEFAULT_SETTINGS = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  cyclesBeforeLongBreak: 4,
  autoStart: true,
};

/** How long a phase runs, in ms. */
export function phaseDuration(phase, settings = DEFAULT_SETTINGS) {
  const minutes =
    phase === FOCUS
      ? settings.focusMinutes
      : phase === LONG_BREAK
        ? settings.longBreakMinutes
        : settings.shortBreakMinutes;
  return Math.max(1, Number(minutes) || 1) * 60 * 1000;
}

/** A fresh, stopped timer sitting at the start of a focus phase. */
export function createTimer() {
  return {
    phase: FOCUS,
    running: false,
    startedAt: null,
    accumulatedMs: 0,
    completedFocus: 0,
  };
}

/** Milliseconds elapsed in the current phase. */
export function elapsedMs(timer, now = Date.now()) {
  const live = timer.running && timer.startedAt ? Math.max(0, now - timer.startedAt) : 0;
  return timer.accumulatedMs + live;
}

/** Milliseconds left in the current phase (never negative). */
export function remainingMs(timer, settings = DEFAULT_SETTINGS, now = Date.now()) {
  return Math.max(0, phaseDuration(timer.phase, settings) - elapsedMs(timer, now));
}

/** 0–100 progress through the current phase. */
export function progressPercent(timer, settings = DEFAULT_SETTINGS, now = Date.now()) {
  const duration = phaseDuration(timer.phase, settings);
  return Math.min(100, Math.round((elapsedMs(timer, now) / duration) * 100));
}

export function start(timer, now = Date.now()) {
  if (timer.running) return timer;
  return { ...timer, running: true, startedAt: now };
}

export function pause(timer, now = Date.now()) {
  if (!timer.running) return timer;
  return { ...timer, running: false, startedAt: null, accumulatedMs: elapsedMs(timer, now) };
}

export function toggle(timer, now = Date.now()) {
  return timer.running ? pause(timer, now) : start(timer, now);
}

/** Restart the current phase from zero, keeping the cycle count. */
export function resetPhase(timer) {
  return { ...timer, running: false, startedAt: null, accumulatedMs: 0 };
}

/** Back to a clean focus phase, cycle count included. */
export function resetAll() {
  return createTimer();
}

/** Which phase follows this one. */
export function nextPhaseOf(timer, settings = DEFAULT_SETTINGS) {
  if (timer.phase !== FOCUS) return FOCUS;
  const completed = timer.completedFocus + 1;
  const every = Math.max(1, Number(settings.cyclesBeforeLongBreak) || 4);
  return completed % every === 0 ? LONG_BREAK : SHORT_BREAK;
}

/**
 * Move to the next phase.
 *
 * `auto` marks a transition the clock made rather than the user. A focus phase
 * only counts as a completed pomodoro when it actually ran its length, so
 * skipping ahead never inflates the count.
 */
export function advance(timer, settings = DEFAULT_SETTINGS, { now = Date.now(), credit = false, autoStart = false } = {}) {
  const phase = nextPhaseOf(timer, settings);
  return {
    phase,
    running: autoStart,
    startedAt: autoStart ? now : null,
    accumulatedMs: 0,
    completedFocus: timer.completedFocus + (credit && timer.phase === FOCUS ? 1 : 0),
  };
}

/** User-driven skip: moves on without crediting an unfinished pomodoro. */
export function skip(timer, settings = DEFAULT_SETTINGS, now = Date.now()) {
  return advance(timer, settings, { now, credit: false, autoStart: false });
}

/**
 * Bring the timer up to date with the clock.
 *
 * Advances at most one phase per call, and only auto-starts the next phase if
 * the current one has just finished. If the tab was closed for an hour, the
 * focus block is still credited but the break is left stopped — silently
 * burning through six breaks nobody took would make the count a lie.
 *
 * @returns {{timer: object, completed: string|null}} `completed` names the
 *   phase that just ended, for the caller to log or chime on.
 */
export function tick(timer, settings = DEFAULT_SETTINGS, now = Date.now()) {
  if (!timer.running) return { timer, completed: null };

  const overshoot = elapsedMs(timer, now) - phaseDuration(timer.phase, settings);
  if (overshoot < 0) return { timer, completed: null };

  const wasPresent = overshoot < 60 * 1000; // came back within a minute
  return {
    timer: advance(timer, settings, {
      now,
      credit: true,
      autoStart: Boolean(settings.autoStart) && wasPresent,
    }),
    completed: timer.phase,
  };
}

/** `mm:ss`, or `h:mm:ss` past an hour. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Focus minutes logged per topic, and per day, from a flat log. */
export function summariseLog(log = [], { iso } = {}) {
  const entries = iso ? log.filter((e) => e.iso === iso) : log;
  const byTopic = new Map();
  let minutes = 0;

  for (const entry of entries) {
    minutes += entry.minutes || 0;
    const key = entry.topicId || 'unassigned';
    byTopic.set(key, (byTopic.get(key) || 0) + (entry.minutes || 0));
  }

  return {
    pomodoros: entries.length,
    minutes,
    byTopic: [...byTopic.entries()].map(([topicId, mins]) => ({ topicId, minutes: mins })),
  };
}
