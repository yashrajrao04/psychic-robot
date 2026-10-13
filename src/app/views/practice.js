/**
 * Tailored Practice — it picks the topic, it picks the difficulty, and it goes
 * up every time.
 *
 * The Testing tab waits to be told what to do. This one decides: it looks at
 * what is scheduled today, what has gone stale, and where you are weakest, then
 * opens one rung below your current level and climbs from there. Your level
 * persists, so tomorrow starts above where today finished.
 */

import { el, section, empty, inlineMarkdown } from '../dom.js';
import * as store from '../store.js';
import {
  bandAt,
  levelLabel,
  openingLevel,
  overallProgress,
  planSession,
  applyResult,
  recordFor,
  selectTopic,
  summarise,
  MAX_LEVEL,
} from '../../core/practice.js';
import { assessContext, generateQuestions, gradeAttempt, hintsFor } from '../../core/testing.js';
import { compareNotes } from '../../core/notes.js';
import { isDirectAnswerRequest, buildGuidedRedirect } from '../../core/policy.js';
import { toISODate } from '../../core/dates.js';

const ui = {
  session: null,
  index: 0,
  question: null,
  answer: '',
  grade: null,
  hintsShown: 0,
  redirect: null,
  before: null,
  answered: 0,
  strong: 0,
  done: null,
  why: '',
  error: null,
};

function reset() {
  Object.assign(ui, {
    session: null, index: 0, question: null, answer: '', grade: null,
    hintsShown: 0, redirect: null, before: null, answered: 0, strong: 0,
    done: null, why: '', error: null,
  });
}

/** Topics with enough notes to build real questions from. */
function practisableTopics() {
  return store.topicsWithSubject().filter((t) => assessContext(store.getNotes(t.id), t.topic).ok);
}

function questionFor(topic, band) {
  const result = generateQuestions({
    notes: store.getNotes(topic.id),
    topic: topic.topic,
    difficulty: band,
    count: 6,
  });
  if (!result.ok) return null;
  // Avoid repeating a stem already used this session.
  const used = ui.session?.used || [];
  return result.questions.find((q) => !used.includes(q.text)) || result.questions[0] || null;
}

function startSession(plan) {
  const topics = practisableTopics();
  if (!topics.length) {
    ui.error = 'none';
    return;
  }

  const dueToday = plan.sessions.filter((s) => s.iso === toISODate(new Date())).map((s) => s.topicId);
  const records = store.practiceRecords();
  const pick = selectTopic({ topics, dueTopicIds: dueToday, records });
  if (!pick) {
    ui.error = 'none';
    return;
  }

  const record = recordFor(records, pick.topic.id);
  const session = planSession({ topic: pick.topic, record });
  session.used = [];

  ui.session = session;
  ui.before = record;
  ui.index = 0;
  ui.answered = 0;
  ui.strong = 0;
  ui.done = null;
  ui.error = null;
  ui.why = dueToday.includes(pick.topic.id)
    ? 'scheduled for today'
    : !record.attempts
      ? 'never practised'
      : 'longest since you last looked at it';

  ui.question = questionFor(pick.topic, bandAt(session, 0));
  ui.answer = '';
  ui.grade = null;
  ui.hintsShown = 0;
}

function advance() {
  const session = ui.session;
  const topics = store.topicsWithSubject();
  const topic = topics.find((t) => t.id === session.topicId);

  // Bank the graded answer into the persistent level before moving on.
  if (ui.grade && ui.grade.quality !== 'empty') {
    const current = recordFor(store.practiceRecords(), session.topicId);
    store.setPracticeRecord(session.topicId, applyResult(current, ui.grade.quality));
    ui.answered += 1;
    if (ui.grade.quality === 'strong') ui.strong += 1;
  }

  if (ui.question) session.used.push(ui.question.text);
  ui.index += 1;

  if (ui.index >= session.steps.length) {
    const after = recordFor(store.practiceRecords(), session.topicId);
    ui.done = summarise({ before: ui.before, after, answered: ui.answered, strong: ui.strong });
    ui.question = null;
    return;
  }

  ui.question = questionFor(topic, bandAt(session, ui.index));
  ui.answer = '';
  ui.grade = null;
  ui.hintsShown = 0;
  ui.redirect = null;
}

function progressPanel() {
  const topics = store.topicsWithSubject();
  const records = store.practiceRecords();
  const progress = overallProgress(records, topics);
  const rows = topics
    .filter((t) => records[t.id])
    .map((t) => ({ topic: t, record: recordFor(records, t.id) }))
    .sort((a, b) => b.record.level - a.record.level);

  return section('Your levels', `${progress.practised} topic(s) practised · average ${progress.averageLevel} of ${MAX_LEVEL} · ${progress.mastered} at mastery`, [
    rows.length
      ? el('ul', { class: 'level-list' }, rows.map(({ topic, record }) =>
          el('li', { class: 'level-row' }, [
            el('span', { class: 'level-name', text: topic.topic }),
            el('span', { class: 'level-track' }, [
              el('span', { class: 'level-fill', style: { width: `${(record.level / MAX_LEVEL) * 100}%` } }),
            ]),
            el('span', { class: 'level-badge', text: levelLabel(record.level) }),
          ]),
        ))
      : el('p', { class: 'muted small', text: 'No levels yet. Finish a set and your topics start climbing.' }),
  ]);
}

function questionPanel() {
  const session = ui.session;
  const level = session.steps[ui.index];
  const topic = store.topicsWithSubject().find((t) => t.id === session.topicId);
  const notes = store.getNotes(session.topicId);
  const comparison = notes.trim() ? compareNotes(notes, { topic: session.topic }) : null;
  const hints = ui.question ? hintsFor(ui.question, comparison) : [];

  const answerBox = el('textarea', {
    class: 'input textarea',
    rows: 6,
    placeholder: 'Work it through here. Reasoning counts for more than length.',
    'aria-label': 'Your answer',
    onInput: (e) => {
      ui.answer = e.target.value;
    },
  });
  answerBox.value = ui.answer;

  return el('div', { class: 'panel' }, [
    el('header', { class: 'panel-head row' }, [
      el('div', {}, [
        el('h2', { text: `Question ${ui.index + 1} of ${session.steps.length}` }),
        el('p', { class: 'muted', text: `${session.subject} — ${session.topic}` }),
      ]),
      el('div', { class: 'quiz-stats' }, [
        el('span', { class: 'pill pill-hard', text: levelLabel(level) }),
        el('span', { class: 'muted small', text: `${ui.strong}/${ui.answered} clean` }),
      ]),
    ]),
    el('div', { class: 'panel-body' }, [
      el('div', { class: 'ladder-strip' }, session.steps.map((step, i) =>
        el('span', {
          class: `ladder-step${i === ui.index ? ' is-current' : ''}${i < ui.index ? ' is-done' : ''}`,
          title: levelLabel(step),
        }),
      )),

      ui.question
        ? el('p', { class: 'question', html: inlineMarkdown(ui.question.text) })
        : el('p', { class: 'notice', text: 'Ran out of distinct questions from your notes on this topic — add more material and the set will go deeper.' }),

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
              ui.grade = gradeAttempt(ui.question, ui.answer);
            }
            store.refresh();
          },
        }),
        el('button', {
          class: 'btn',
          text: ui.hintsShown < hints.length ? `Hint (${ui.hintsShown}/${hints.length})` : 'No hints left',
          disabled: ui.hintsShown >= hints.length,
          onClick: () => {
            ui.hintsShown += 1;
            store.refresh();
          },
        }),
        el('button', {
          class: 'btn',
          text: ui.index + 1 >= session.steps.length ? 'Finish set' : 'Next — harder',
          onClick: () => {
            advance();
            store.refresh();
          },
        }),
      ]),

      ui.redirect
        ? el('div', { class: 'guard' }, [
            el('h3', { text: ui.redirect.headline }),
            el('p', { class: 'muted', text: ui.redirect.reason }),
          ])
        : null,

      ui.grade
        ? el('div', { class: `feedback is-${ui.grade.quality}` }, [
            el('h4', { text: ui.grade.verdict }),
            el('p', { text: ui.grade.note }),
          ])
        : null,

      ui.hintsShown > 0
        ? el('div', { class: 'hints' }, hints.slice(0, ui.hintsShown).map((h) =>
            el('div', { class: 'hint' }, [el('strong', { text: `${h.label}: ` }), h.text]),
          ))
        : null,
    ]),
  ]);
}

export function renderPractice(plan, { goToTab } = {}) {
  const topics = store.topicsWithSubject();

  if (!topics.length) {
    return el('div', { class: 'view' }, [
      section('Tailored practice', null, [
        empty('Add a topic first — practice is built from your own notes.', 'Add topics', () => goToTab?.('subjects')),
      ]),
    ]);
  }

  if (ui.error === 'none') {
    return el('div', { class: 'view' }, [
      section('Tailored practice', null, [
        el('p', { class: 'notice', text: 'None of your topics have enough notes to build real questions from yet.' }),
        el('p', { text: 'Practice is generated from what you have written, so it stays on your syllabus rather than the internet’s.' }),
        el('div', { class: 'button-row' }, [
          el('button', { class: 'btn primary', text: 'Add notes in Study Buddy', onClick: () => goToTab?.('buddy') }),
          el('button', { class: 'btn', text: 'Try again', onClick: () => { reset(); store.refresh(); } }),
        ]),
      ]),
    ]);
  }

  if (ui.done) {
    return el('div', { class: 'view' }, [
      section(ui.done.headline, `${ui.session.subject} — ${ui.session.topic}`, [
        el('p', { text: ui.done.note }),
        el('div', { class: 'button-row' }, [
          el('button', {
            class: 'btn primary',
            text: 'Next set — it picks again',
            onClick: () => {
              reset();
              startSession(plan);
              store.refresh();
            },
          }),
          el('button', { class: 'btn', text: 'Stop for now', onClick: () => { reset(); store.refresh(); } }),
        ]),
      ]),
      progressPanel(),
    ]);
  }

  if (ui.session) {
    return el('div', { class: 'view' }, [
      el('p', { class: 'muted small', text: `Chosen for you: ${ui.session.topic} — ${ui.why}. Opening at ${levelLabel(ui.session.startLevel)}.` }),
      questionPanel(),
      progressPanel(),
    ]);
  }

  const practisable = practisableTopics();
  const records = store.practiceRecords();
  const next = selectTopic({
    topics: practisable,
    dueTopicIds: plan.sessions.filter((s) => s.iso === toISODate(new Date())).map((s) => s.topicId),
    records,
  });

  return el('div', { class: 'view' }, [
    section(
      'Tailored practice',
      'It chooses the topic and the difficulty, and it goes up every time. Your level is remembered, so tomorrow starts above where today finished.',
      [
        next
          ? el('p', {}, [
              'Up next: ',
              el('strong', { text: next.topic.topic }),
              ` — opening at ${levelLabel(openingLevel(next.record))}.`,
            ])
          : el('p', { class: 'muted', text: 'Nothing with enough notes to test on yet.' }),
        el('div', { class: 'button-row' }, [
          el('button', {
            class: 'btn primary',
            text: 'Start practice',
            onClick: () => {
              reset();
              startSession(plan);
              store.refresh();
            },
          }),
        ]),
        el('ul', { class: 'bullets' }, [
          el('li', { text: 'Each set runs five questions, every one a rung harder than the last.' }),
          el('li', { text: 'A clean answer raises your level for good; a miss costs one rung and never more than that.' }),
          el('li', { text: 'Hints escalate as always, and the answer is never given.' }),
        ]),
      ],
    ),
    progressPanel(),
  ]);
}
