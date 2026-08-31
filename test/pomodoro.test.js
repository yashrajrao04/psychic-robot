import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  FOCUS,
  LONG_BREAK,
  SHORT_BREAK,
  advance,
  createTimer,
  elapsedMs,
  formatDuration,
  nextPhaseOf,
  pause,
  phaseDuration,
  progressPercent,
  remainingMs,
  resetAll,
  resetPhase,
  skip,
  start,
  summariseLog,
  tick,
  toggle,
} from '../src/core/pomodoro.js';

const T0 = 1_700_000_000_000;
const MIN = 60 * 1000;
const S = { ...DEFAULT_SETTINGS };

test('a new timer is a stopped 25-minute focus block', () => {
  const t = createTimer();
  assert.equal(t.phase, FOCUS);
  assert.equal(t.running, false);
  assert.equal(t.completedFocus, 0);
  assert.equal(remainingMs(t, S, T0), 25 * MIN);
  assert.equal(progressPercent(t, S, T0), 0);
});

test('time is measured against the clock, not counted down', () => {
  const t = start(createTimer(), T0);
  assert.equal(remainingMs(t, S, T0 + 10 * MIN), 15 * MIN);
  assert.equal(progressPercent(t, S, T0 + 10 * MIN), 40);

  // No ticks happened in between — the answer comes from the timestamps alone,
  // which is why a throttled or backgrounded tab cannot lose minutes.
  assert.equal(elapsedMs(t, T0 + 10 * MIN), 10 * MIN);
});

test('pause banks elapsed time and resume continues from it', () => {
  let t = start(createTimer(), T0);
  t = pause(t, T0 + 10 * MIN);
  assert.equal(t.running, false);
  assert.equal(t.accumulatedMs, 10 * MIN);

  // An hour passes while paused; nothing is consumed.
  assert.equal(remainingMs(t, S, T0 + 70 * MIN), 15 * MIN);

  t = start(t, T0 + 70 * MIN);
  assert.equal(remainingMs(t, S, T0 + 75 * MIN), 10 * MIN);
});

test('toggle flips between running and paused', () => {
  let t = createTimer();
  t = toggle(t, T0);
  assert.equal(t.running, true);
  t = toggle(t, T0 + MIN);
  assert.equal(t.running, false);
  assert.equal(t.accumulatedMs, MIN);
});

test('a completed focus block advances to a break and is credited', () => {
  const t = start(createTimer(), T0);
  const { timer, completed } = tick(t, S, T0 + 25 * MIN);

  assert.equal(completed, FOCUS);
  assert.equal(timer.phase, SHORT_BREAK);
  assert.equal(timer.completedFocus, 1);
  assert.equal(timer.running, true, 'auto-start carries straight into the break');
  assert.equal(remainingMs(timer, S, T0 + 25 * MIN), 5 * MIN);
});

test('an unfinished phase does not advance', () => {
  const t = start(createTimer(), T0);
  const { timer, completed } = tick(t, S, T0 + 24 * MIN);
  assert.equal(completed, null);
  assert.equal(timer, t, 'state is returned untouched');
});

test('a stopped timer never advances on its own', () => {
  const t = createTimer();
  const { timer, completed } = tick(t, S, T0 + 99 * MIN);
  assert.equal(completed, null);
  assert.equal(timer.phase, FOCUS);
});

test('coming back after a long absence credits the block but does not auto-run the break', () => {
  const t = start(createTimer(), T0);
  const { timer, completed } = tick(t, S, T0 + 60 * MIN);

  assert.equal(completed, FOCUS, 'the focus block did finish');
  assert.equal(timer.completedFocus, 1, 'and is credited');
  assert.equal(timer.phase, SHORT_BREAK);
  assert.equal(timer.running, false, 'but a break nobody took is not started for them');
});

test('a long break arrives every fourth focus block', () => {
  let t = createTimer();
  const phases = [];

  for (let i = 0; i < 4; i += 1) {
    t = start({ ...t, accumulatedMs: 0, startedAt: null }, T0);
    const focusDone = tick(t, S, T0 + phaseDuration(FOCUS, S));
    phases.push(focusDone.timer.phase);
    // Skip through the break to line up the next focus block.
    t = advance(focusDone.timer, S, { now: T0, credit: false, autoStart: false });
  }

  assert.deepEqual(phases, [SHORT_BREAK, SHORT_BREAK, SHORT_BREAK, LONG_BREAK]);
});

test('nextPhaseOf always returns focus after any break', () => {
  assert.equal(nextPhaseOf({ phase: SHORT_BREAK, completedFocus: 1 }, S), FOCUS);
  assert.equal(nextPhaseOf({ phase: LONG_BREAK, completedFocus: 4 }, S), FOCUS);
});

test('skipping ahead never inflates the completed count', () => {
  const t = start(createTimer(), T0);
  const skipped = skip(t, S, T0 + 2 * MIN);

  assert.equal(skipped.phase, SHORT_BREAK);
  assert.equal(skipped.completedFocus, 0, 'two minutes of work is not a pomodoro');
  assert.equal(skipped.running, false);
});

test('resetting clears the phase but resetAll clears the run', () => {
  let t = start(createTimer(), T0);
  t = tick(t, S, T0 + 25 * MIN).timer; // one block done
  t = { ...t, phase: FOCUS };

  const phaseReset = resetPhase(start(t, T0));
  assert.equal(phaseReset.accumulatedMs, 0);
  assert.equal(phaseReset.running, false);
  assert.equal(phaseReset.completedFocus, 1, 'the run is preserved');

  assert.equal(resetAll().completedFocus, 0);
});

test('custom durations are honoured and nonsense is clamped', () => {
  const custom = { ...S, focusMinutes: 50, shortBreakMinutes: 10 };
  assert.equal(phaseDuration(FOCUS, custom), 50 * MIN);
  assert.equal(phaseDuration(SHORT_BREAK, custom), 10 * MIN);

  assert.equal(phaseDuration(FOCUS, { ...S, focusMinutes: 0 }), MIN, 'zero would be an infinite loop');
  assert.equal(phaseDuration(FOCUS, { ...S, focusMinutes: -5 }), MIN);
});

test('remaining time never goes negative', () => {
  const t = start(createTimer(), T0);
  assert.equal(remainingMs(t, S, T0 + 300 * MIN), 0);
  assert.equal(progressPercent(t, S, T0 + 300 * MIN), 100);
});

test('durations format as mm:ss, and h:mm:ss past an hour', () => {
  assert.equal(formatDuration(25 * MIN), '25:00');
  assert.equal(formatDuration(90 * 1000), '1:30');
  assert.equal(formatDuration(5000), '0:05');
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(-500), '0:00');
  assert.equal(formatDuration(3600 * 1000 + 5 * MIN), '1:05:00');
});

test('the log summarises by day and by topic', () => {
  const log = [
    { iso: '2025-01-06', topicId: 'a', minutes: 25 },
    { iso: '2025-01-06', topicId: 'a', minutes: 25 },
    { iso: '2025-01-06', topicId: 'b', minutes: 25 },
    { iso: '2025-01-07', topicId: 'a', minutes: 25 },
  ];

  const today = summariseLog(log, { iso: '2025-01-06' });
  assert.equal(today.pomodoros, 3);
  assert.equal(today.minutes, 75);
  assert.deepEqual(
    today.byTopic.sort((x, y) => x.topicId.localeCompare(y.topicId)),
    [{ topicId: 'a', minutes: 50 }, { topicId: 'b', minutes: 25 }],
  );

  assert.equal(summariseLog(log).pomodoros, 4);
  assert.equal(summariseLog([]).minutes, 0);
});
