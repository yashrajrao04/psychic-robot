/**
 * Pomodoro view.
 *
 * The app re-renders wholesale on every state change, so a timer that ticked by
 * re-rendering would rebuild the DOM sixty times a minute and fight every other
 * interaction. Instead the engine runs on its own interval, independent of
 * rendering, and pokes a single display hook. Only a phase *change* touches the
 * store — roughly twice an hour rather than once a second.
 */

import { el, section, empty, details } from '../dom.js';
import * as store from '../store.js';
import {
  FOCUS,
  LONG_BREAK,
  PHASE_LABELS,
  SHORT_BREAK,
  formatDuration,
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
} from '../../core/pomodoro.js';
import { toISODate } from '../../core/dates.js';

let displayHook = null;
let engineStarted = false;
let audioContext = null;

/** A short two-tone chime. Silent failure is fine — it is a nicety, not the feature. */
function chime(rising = true) {
  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioContext.currentTime;
    [0, 0.18].forEach((offset, i) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.frequency.value = rising ? [660, 880][i] : [880, 660][i];
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.2, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.18);
    });
  } catch {
    /* audio blocked or unsupported */
  }
}

function baseTitle() {
  return 'Study Buddy — Spaced Repetition Planner';
}

/**
 * Drive the clock. Runs for the life of the page, not the life of the view, so
 * the timer keeps counting while the learner is on another tab of the app.
 */
export function startPomodoroEngine() {
  if (engineStarted) return;
  engineStarted = true;

  setInterval(() => {
    const { timer, settings, topicId } = store.getState().pomodoro;
    const { timer: next, completed } = tick(timer, settings);

    if (completed) {
      if (completed === FOCUS) {
        store.logPomodoro({ topicId, minutes: settings.focusMinutes });
      }
      store.setTimer(next); // triggers a re-render, which re-registers the hook
      chime(completed !== FOCUS);
      return;
    }

    if (displayHook) displayHook();

    // Reflect the countdown in the tab title, so it is useful while buried.
    if (timer.running) {
      document.title = `${formatDuration(remainingMs(timer, settings))} · ${PHASE_LABELS[timer.phase]}`;
    } else if (document.title !== baseTitle()) {
      document.title = baseTitle();
    }
  }, 500);
}

function phasePill(phase) {
  const tone = phase === FOCUS ? 'hard' : phase === LONG_BREAK ? 'easy' : 'medium';
  return el('span', { class: `pill pill-${tone}`, text: PHASE_LABELS[phase] });
}

function settingsPanel(settings) {
  const numberField = (label, key, min, max) =>
    el('label', { class: 'field' }, [
      el('span', { text: label }),
      el('input', {
        type: 'number',
        class: 'input',
        min,
        max,
        value: settings[key],
        onChange: (e) => {
          const value = Math.max(min, Math.min(max, Number(e.target.value) || min));
          e.target.value = value;
          store.updatePomodoroSettings({ [key]: value });
        },
      }),
    ]);

  return section('Timer settings', 'Changes apply to the next phase, not the one running.', [
    el('div', { class: 'settings-grid' }, [
      numberField('Focus (min)', 'focusMinutes', 5, 90),
      numberField('Short break (min)', 'shortBreakMinutes', 1, 30),
      numberField('Long break (min)', 'longBreakMinutes', 5, 60),
      numberField('Focus blocks before a long break', 'cyclesBeforeLongBreak', 2, 8),
    ]),
    el('label', { class: 'check-item' }, [
      el('input', {
        type: 'checkbox',
        id: 'pomodoro-auto',
        checked: settings.autoStart,
        onChange: (e) => store.updatePomodoroSettings({ autoStart: e.target.checked }),
      }),
      el('label', { for: 'pomodoro-auto' }, [
        el('span', { text: 'Start the next phase automatically' }),
      ]),
    ]),
    el('p', {
      class: 'muted small',
      text:
        'If you leave the tab for longer than the phase, the finished block is still counted but the next one waits ' +
        'for you — a count that included six breaks you never took would not be worth keeping.',
    }),
  ]);
}

function todayStats(log, topics) {
  const today = summariseLog(log, { iso: toISODate(new Date()) });
  const allTime = summariseLog(log);
  const nameOf = (id) => topics.find((t) => t.id === id)?.topic || 'Unassigned';

  return section('Focus log', 'Time actually spent, not time planned.', [
    el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat' }, [
        el('p', { class: 'stat-value', text: String(today.pomodoros) }),
        el('p', { class: 'stat-label', text: 'Focus blocks today' }),
        el('p', { class: 'muted small', text: `${today.minutes} minutes` }),
      ]),
      el('div', { class: 'stat' }, [
        el('p', { class: 'stat-value', text: String(allTime.pomodoros) }),
        el('p', { class: 'stat-label', text: 'Blocks all time' }),
        el('p', {
          class: 'muted small',
          // "0 hours" for a 25-minute total reads like a bug rather than a stat.
          text:
            allTime.minutes < 60
              ? `${allTime.minutes} minutes`
              : `${(allTime.minutes / 60).toFixed(1)} hours`,
        }),
      ]),
    ]),
    today.byTopic.length
      ? el('ul', { class: 'bullets' }, today.byTopic.map((row) =>
          el('li', { text: `${nameOf(row.topicId)} — ${row.minutes} min today` }),
        ))
      : el('p', { class: 'muted small', text: 'Nothing logged today yet. A block counts once it runs its full length.' }),
  ]);
}

export function renderPomodoro(plan, { goToTab } = {}) {
  const state = store.getState();
  const { timer, settings, topicId, log } = state.pomodoro;
  const topics = store.topicsWithSubject();
  const selected = topics.find((t) => t.id === topicId) || null;

  const remaining = remainingMs(timer, settings);
  const clock = el('p', { class: 'timer-clock', text: formatDuration(remaining) });
  const bar = el('div', { class: 'progress-fill', style: { width: `${progressPercent(timer, settings)}%` } });

  // The engine calls this every half-second. It touches two nodes and nothing
  // else — no diffing, no re-render, no lost focus in other inputs.
  displayHook = () => {
    if (!clock.isConnected) {
      displayHook = null;
      return;
    }
    const current = store.getState().pomodoro;
    clock.textContent = formatDuration(remainingMs(current.timer, current.settings));
    bar.style.width = `${progressPercent(current.timer, current.settings)}%`;
  };

  const cycleDots = el(
    'div',
    { class: 'cycle-dots', title: `${timer.completedFocus} focus blocks completed this run` },
    Array.from({ length: Math.max(1, settings.cyclesBeforeLongBreak) }, (_, i) =>
      el('span', {
        class: `cycle-dot${i < timer.completedFocus % settings.cyclesBeforeLongBreak ? ' is-done' : ''}`,
      }),
    ),
  );

  const timerPanel = el('div', { class: 'panel' }, [
    el('header', { class: 'panel-head row' }, [
      el('div', {}, [
        el('h2', { text: 'Pomodoro' }),
        el('p', { class: 'muted', text: 'Work in blocks. The break is part of the method, not a reward.' }),
      ]),
      phasePill(timer.phase),
    ]),
    el('div', { class: 'panel-body' }, [
      el('div', { class: `timer-face phase-${timer.phase}${timer.running ? ' is-running' : ''}` }, [
        clock,
        el('p', {
          class: 'muted small',
          text: selected
            ? `${PHASE_LABELS[timer.phase]} · ${selected.subject} — ${selected.topic}`
            : `${PHASE_LABELS[timer.phase]} · no topic selected`,
        }),
        el('div', { class: 'progress' }, [bar]),
        cycleDots,
      ]),

      el('div', { class: 'button-row centered-row' }, [
        el('button', {
          class: 'btn primary',
          text: timer.running ? 'Pause' : remaining === phaseDuration(timer.phase, settings) ? 'Start' : 'Resume',
          onClick: () => {
            // First click also unlocks audio for the end-of-phase chime.
            try {
              audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
              if (audioContext.state === 'suspended') audioContext.resume();
            } catch {
              /* ignore */
            }
            store.setTimer(toggle(timer));
          },
        }),
        el('button', {
          class: 'btn',
          text: 'Restart phase',
          onClick: () => store.setTimer(resetPhase(timer)),
        }),
        el('button', {
          class: 'btn',
          text: 'Skip ahead',
          title: 'Move to the next phase without counting this one',
          onClick: () => store.setTimer(skip(timer, settings)),
        }),
        el('button', {
          class: 'btn danger',
          text: 'Reset all',
          onClick: () => {
            store.setTimer(resetAll());
            document.title = baseTitle();
          },
        }),
      ]),

      el('label', { class: 'field' }, [
        el('span', { text: 'What are you working on?' }),
        el(
          'select',
          {
            class: 'input select',
            onChange: (e) => store.setPomodoroTopic(e.target.value || null),
          },
          [
            el('option', { value: '', text: '— no topic —', selected: !topicId }),
            ...topics.map((t) =>
              el('option', { value: t.id, text: `${t.subject} — ${t.topic}`, selected: t.id === topicId }),
            ),
          ],
        ),
        el('p', { class: 'muted small', text: 'Completed focus blocks are logged against this topic.' }),
      ]),

      timer.phase !== FOCUS
        ? el('p', {
            class: 'notice ok',
            text:
              timer.phase === LONG_BREAK
                ? 'Long break. Get away from the desk — consolidation happens when you stop, not while you push.'
                : 'Short break. Stand up, look at something further than arm’s length away, and do not start a new task.',
          })
        : null,
    ]),
  ]);

  const todaySessions = plan.sessions.filter((s) => s.iso === toISODate(new Date()));

  return el('div', { class: 'view' }, [
    timerPanel,
    todaySessions.length
      ? section('Due today', 'Pick one to focus on and its tasks come with it.', [
          el('div', { class: 'card-grid' }, todaySessions.map((s) =>
            el('article', { class: `session-card diff-${s.difficulty}` }, [
              el('h3', { class: 'session-title' }, [
                el('span', { class: 'subject-tag', text: s.subject }),
                el('span', { text: s.topic }),
              ]),
              el('p', { class: 'muted small', text: `${s.repLabel} · D${s.ladderDay}` }),
              el('button', {
                class: `btn${s.topicId === topicId ? '' : ' primary'}`,
                text: s.topicId === topicId ? 'Selected' : 'Focus on this',
                disabled: s.topicId === topicId,
                onClick: () => {
                  store.setPomodoroTopic(s.topicId);
                  store.setTimer(start(resetPhase(store.getState().pomodoro.timer)));
                },
              }),
              details(`pomo:${s.id}`, `${s.tasks.length} tasks`, el('ul', { class: 'bullets' },
                s.tasks.map((t) => el('li', { text: `${t.text}${t.minutes ? ` (${t.minutes}m)` : ''}` })),
              )),
            ]),
          )),
        ])
      : section('Due today', null, [
          empty('Nothing scheduled today — you can still run a block on any topic above.', 'Open the plan', () => goToTab?.('plan')),
        ]),
    todayStats(log, topics),
    settingsPanel(settings),
  ]);
}
