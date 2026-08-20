/**
 * Testing Mode — adaptive question practice built from the learner's own notes.
 * Hints escalate; answers are never given.
 */

import { el, section, empty, inlineMarkdown } from '../dom.js';
import * as store from '../store.js';
import {
  DIFFICULTY_LEVELS,
  adaptSession,
  adaptationMessage,
  createSession,
  generateQuestions,
  gradeAttempt,
  hintsFor,
} from '../../core/testing.js';
import { compareNotes } from '../../core/notes.js';
import { isDirectAnswerRequest, buildGuidedRedirect } from '../../core/policy.js';

/** Transient practice state — a quiz in progress is not worth persisting. */
const ui = {
  topicId: null,
  difficulty: 'medium',
  customMix: ['easy', 'medium'],
  session: null,
  pool: null,
  current: null,
  used: new Set(),
  answer: '',
  hintsShown: 0,
  grade: null,
  message: null,
  redirect: null,
};

function resetPractice() {
  ui.session = null;
  ui.pool = null;
  ui.current = null;
  ui.used = new Set();
  ui.answer = '';
  ui.hintsShown = 0;
  ui.grade = null;
  ui.message = null;
  ui.redirect = null;
}

/** Pull the next unused question at the session's current level. */
function nextQuestion() {
  const level = DIFFICULTY_LEVELS[ui.session.levelIndex];
  const order = [level, ...DIFFICULTY_LEVELS.filter((l) => l !== level)];
  for (const candidate of order) {
    const question = (ui.pool[candidate] || []).find((q) => !ui.used.has(q.text));
    if (question) {
      ui.used.add(question.text);
      return question;
    }
  }
  return null;
}

function startPractice(topic, notes) {
  const pool = {};
  for (const level of DIFFICULTY_LEVELS) {
    const result = generateQuestions({ notes, topic: topic.topic, difficulty: level, count: 8 });
    if (!result.ok) return result;
    pool[level] = result.questions;
  }
  ui.pool = pool;
  ui.session = createSession(ui.difficulty === 'custom' ? ui.customMix[0] : ui.difficulty);
  ui.used = new Set();
  ui.answer = '';
  ui.hintsShown = 0;
  ui.grade = null;
  ui.current = nextQuestion();
  return { ok: true };
}

function difficultyChooser() {
  const options = [...DIFFICULTY_LEVELS, 'custom'];
  return el('div', { class: 'field' }, [
    el('span', { text: 'Difficulty' }),
    el(
      'div',
      { class: 'topic-picker' },
      options.map((level) =>
        el('button', {
          type: 'button',
          class: `chip${ui.difficulty === level ? ' is-active' : ''}`,
          text: level[0].toUpperCase() + level.slice(1),
          onClick: () => {
            ui.difficulty = level;
            store.refresh();
          },
        }),
      ),
    ),
    ui.difficulty === 'custom'
      ? el('div', {}, [
          el('p', { class: 'muted small', text: 'Mix the levels you want drawn from:' }),
          el(
            'div',
            { class: 'topic-picker' },
            DIFFICULTY_LEVELS.map((level) =>
              el('button', {
                type: 'button',
                class: `chip${ui.customMix.includes(level) ? ' is-active' : ''}`,
                text: level,
                onClick: () => {
                  ui.customMix = ui.customMix.includes(level)
                    ? ui.customMix.filter((l) => l !== level)
                    : [...ui.customMix, level];
                  if (!ui.customMix.length) ui.customMix = [level];
                  store.refresh();
                },
              }),
            ),
          ),
        ])
      : null,
    el('p', {
      class: 'muted small',
      text: 'Whatever you pick, difficulty adapts as you go: two clean answers steps it up, two misses steps it down.',
    }),
  ]);
}

function questionPanel(topic, comparison) {
  const question = ui.current;

  if (!question) {
    return section('Question set complete', null, [
      el('p', {
        text:
          `You have worked through the questions available from your notes on ${topic.topic}. ` +
          'That is a signal to go add material, not to keep re-testing the same ground.',
      }),
      el('div', { class: 'button-row' }, [
        el('button', {
          class: 'btn primary',
          text: 'Restart practice',
          onClick: () => {
            resetPractice();
            store.refresh();
          },
        }),
      ]),
    ]);
  }

  const answerBox = el('textarea', {
    class: 'input textarea',
    rows: 6,
    placeholder: 'Work through it here. Reasoning matters more than length — say why, not just what.',
    'aria-label': 'Your answer',
    onInput: (e) => {
      ui.answer = e.target.value;
    },
  });
  answerBox.value = ui.answer;

  const hints = hintsFor(question, comparison);
  const stats = ui.session;

  return el('div', {}, [
    el('div', { class: 'panel' }, [
      el('header', { class: 'panel-head row' }, [
        el('div', {}, [
          el('h2', { text: `Question ${stats.answered + 1}` }),
          el('p', { class: 'muted', text: `${topic.subject} — ${topic.topic}` }),
        ]),
        el('div', { class: 'quiz-stats' }, [
          el('span', { class: `pill pill-${question.level}`, text: question.level }),
          el('span', { class: 'muted small', text: `${stats.strong}/${stats.answered} strong` }),
        ]),
      ]),
      el('div', { class: 'panel-body' }, [
        ui.message ? el('p', { class: 'notice ok', text: ui.message }) : null,
        el('p', { class: 'question', html: inlineMarkdown(question.text) }),
        answerBox,

        el('div', { class: 'button-row' }, [
          el('button', {
            class: 'btn primary',
            text: 'Check my reasoning',
            onClick: () => {
              if (isDirectAnswerRequest(ui.answer)) {
                ui.redirect = buildGuidedRedirect(ui.answer);
                ui.grade = null;
              } else {
                ui.redirect = null;
                ui.grade = gradeAttempt(question, ui.answer);
              }
              store.refresh();
            },
          }),
          el('button', {
            class: 'btn',
            text: ui.hintsShown < hints.length ? `Give me a hint (${ui.hintsShown}/${hints.length})` : 'No hints left',
            disabled: ui.hintsShown >= hints.length,
            onClick: () => {
              ui.hintsShown += 1;
              store.refresh();
            },
          }),
          el('button', {
            class: 'btn',
            text: 'Next question',
            onClick: () => {
              if (ui.grade && ui.grade.quality !== 'empty') {
                ui.session = adaptSession(ui.session, ui.grade);
                ui.message = adaptationMessage(ui.session);
              } else {
                ui.message = null;
              }
              ui.answer = '';
              ui.hintsShown = 0;
              ui.grade = null;
              ui.redirect = null;
              ui.current = nextQuestion();
              store.refresh();
            },
          }),
        ]),

        ui.redirect
          ? el('div', { class: 'guard' }, [
              el('h3', { text: ui.redirect.headline }),
              el('p', { class: 'muted', text: ui.redirect.reason }),
              el(
                'ol',
                { class: 'guard-steps' },
                ui.redirect.steps.map((s) => el('li', {}, [el('strong', { text: s.title }), el('p', { text: s.detail })])),
              ),
            ])
          : null,

        ui.grade
          ? el('div', { class: `feedback is-${ui.grade.quality}` }, [
              el('h4', { text: ui.grade.verdict }),
              el('p', { text: ui.grade.note }),
              el('p', {
                class: 'muted small',
                text: 'I will tell you whether your reasoning is heading the right way — the answer itself stays yours to build.',
              }),
            ])
          : null,

        ui.hintsShown > 0
          ? el('div', { class: 'hints' }, [
              el('h4', { text: 'Hints' }),
              ...hints.slice(0, ui.hintsShown).map((hint) =>
                el('div', { class: 'hint' }, [el('strong', { text: `${hint.label}: ` }), hint.text]),
              ),
            ])
          : null,
      ]),
    ]),
  ]);
}

export function renderTesting(plan, { goToTab } = {}) {
  const topics = store.topicsWithSubject();

  if (!topics.length) {
    return el('div', { class: 'view' }, [
      section('Testing Mode', null, [
        empty('Add a topic first — questions are generated from your own notes on it.', 'Add topics', () => goToTab?.('subjects')),
      ]),
    ]);
  }

  if (!ui.topicId || !topics.some((t) => t.id === ui.topicId)) {
    ui.topicId = topics[0].id;
    resetPractice();
  }
  const topic = topics.find((t) => t.id === ui.topicId);
  const notes = store.getNotes(topic.id);

  const notesBox = el('textarea', {
    class: 'input textarea',
    rows: 6,
    placeholder: 'Notes on this topic. The more you give, the more specific the questions.',
    'aria-label': 'Notes for question generation',
    onInput: (e) => store.saveNotes(topic.id, e.target.value),
  });
  notesBox.value = notes;

  const setup = section('Testing Mode', 'Questions come strictly from your notes, so they stay on-topic and at the right level.', [
    el('div', { class: 'settings-grid' }, [
      el('label', { class: 'field' }, [
        el('span', { text: 'Topic' }),
        el(
          'select',
          {
            class: 'input select',
            onChange: (e) => {
              ui.topicId = e.target.value;
              resetPractice();
              store.refresh();
            },
          },
          topics.map((t) => el('option', { value: t.id, text: `${t.subject} — ${t.topic}`, selected: t.id === ui.topicId })),
        ),
      ]),
    ]),
    el('label', { class: 'field' }, [el('span', { text: 'Your notes / relevant information' }), notesBox]),
    difficultyChooser(),
    el('div', { class: 'button-row' }, [
      el('button', {
        class: 'btn primary',
        text: ui.session ? 'Restart practice' : 'Start practice',
        onClick: () => {
          const result = startPractice(topic, store.getNotes(topic.id));
          if (!result.ok) {
            ui.session = null;
            ui.contextError = result;
          } else {
            ui.contextError = null;
          }
          store.refresh();
        },
      }),
    ]),
  ]);

  if (ui.contextError) {
    return el('div', { class: 'view' }, [
      setup,
      section('Not enough to test on yet', null, [
        el('p', { class: 'notice', text: ui.contextError.message }),
        el('p', { text: 'Do one of these first:' }),
        el(
          'ul',
          { class: 'bullets' },
          ui.contextError.options.map((option) => el('li', { text: option })),
        ),
        el('div', { class: 'button-row' }, [
          el('button', { class: 'btn', text: 'Open Study Buddy', onClick: () => goToTab?.('buddy') }),
          el('button', { class: 'btn', text: 'Open calendar', onClick: () => goToTab?.('plan') }),
        ]),
      ]),
    ]);
  }

  if (!ui.session) {
    return el('div', { class: 'view' }, [
      setup,
      section('How this works', null, [
        el('ul', { class: 'bullets' }, [
          el('li', { text: 'Questions are drawn from the terms and claims in your own notes — nothing off-syllabus.' }),
          el('li', { text: 'Answer in the box. You get told whether your reasoning is on track, never what the answer is.' }),
          el('li', { text: 'Stuck? Hints escalate from "what is this asking" to "which part of your notes to reread". They stop there.' }),
          el('li', { text: 'Two strong answers in a row and the questions get harder. Two misses and it drops back to foundations.' }),
        ]),
      ]),
    ]);
  }

  const comparison = notes.trim() ? compareNotes(notes, { subject: topic.subject, topic: topic.topic }) : null;
  return el('div', { class: 'view' }, [setup, questionPanel(topic, comparison)]);
}
