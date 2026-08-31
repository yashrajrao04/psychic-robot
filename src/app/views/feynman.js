/**
 * Feynman view: explain the topic out loud, in your own words, and find out
 * where the explanation breaks.
 *
 * The feedback is analysis of *your* explanation against *your* notes — it
 * never supplies subject content, and it answers nothing. What it returns is
 * the set of questions a curious listener would ask next, which is the actual
 * next step of the technique.
 */

import { el, section, empty, inlineMarkdown } from '../dom.js';
import * as store from '../store.js';
import { analyseExplanation } from '../../core/feynman.js';
import { isDirectAnswerRequest, buildGuidedRedirect } from '../../core/policy.js';
import { sessionsForTopic } from '../../core/scheduler.js';
import { formatShort } from '../../core/dates.js';

const ui = { analysis: null, redirect: null, showNotes: false };

function scoreRing(score) {
  const tone = score >= 80 ? 'easy' : score >= 55 ? 'medium' : 'hard';
  return el('div', { class: `score-ring tone-${tone}`, style: { '--pct': `${score}` } }, [
    el('span', { class: 'score-value', text: String(score) }),
    el('span', { class: 'score-label', text: 'Feynman score' }),
  ]);
}

function metric(label, value, hint) {
  return el('div', { class: 'metric' }, [
    el('p', { class: 'metric-value', text: value }),
    el('p', { class: 'metric-label', text: label }),
    hint ? el('p', { class: 'muted small', text: hint }) : null,
  ]);
}

function analysisPanels(analysis, topic, plan) {
  const scheduled = sessionsForTopic(plan, topic.id);

  return [
    section(
      `"${analysis.verdict}"`,
      `${analysis.wordCount} words · ${analysis.sentenceCount} sentences`,
      [
      !analysis.verified
        ? el('p', {
            class: 'notice',
            text:
              'Scored without notes, so the two strongest checks — whether you recited and whether you skipped ' +
              'anything — could not run. The score is capped at 85 until there is something to compare against.',
          })
        : null,
      el('div', { class: 'score-row' }, [
        scoreRing(analysis.score),
        el('div', { class: 'metric-grid' }, [
          metric(
            'Your own words',
            `${100 - analysis.overlapRatio}%`,
            analysis.hasNotes
              ? `${analysis.overlapRatio}% matched your notes verbatim`
              : 'Add notes to check this properly',
          ),
          metric('Reading level', `Grade ${analysis.grade}`, 'Aim for 9 or below'),
          metric('Sentences that say *why*', `${analysis.reasoningDensity}%`, 'Explaining, not listing'),
          metric('Unexplained jargon', String(analysis.jargon.length), 'Terms you used but never unpacked'),
        ]),
      ]),
    ]),

    section('What a listener would ask you next', 'Answer these out loud, then explain it again.', [
      el('ol', { class: 'question-list' }, analysis.questions.map((q) => el('li', { text: q }))),
      el('p', {
        class: 'muted small',
        text:
          'These are questions, not answers — working them out is the pass that actually moves you. ' +
          'When you can field all of them without reaching for your notes, you know the topic.',
      }),
    ]),

    section('The breakdown', null, [
      el('div', { class: 'analysis-grid' }, [
        el('div', { class: 'analysis-col ok' }, [
          el('h4', { text: 'What worked' }),
          el('ul', { class: 'bullets' }, analysis.strengths.map((s) => el('li', { html: inlineMarkdown(s) }))),
        ]),
        el('div', { class: 'analysis-col gap' }, [
          el('h4', { text: 'Where it broke down' }),
          analysis.improvements.length
            ? el('ul', { class: 'bullets' }, analysis.improvements.map((item) =>
                el('li', {}, [
                  el('strong', { text: `${item.title}. ` }),
                  item.detail,
                  item.items?.length
                    ? el('ul', { class: 'sub-bullets' }, item.items.slice(0, 4).map((x) =>
                        el('li', { text: typeof x === 'string' ? x : String(x) }),
                      ))
                    : null,
                ]),
              ))
            : el('p', { class: 'muted', text: 'Nothing structural to fix. Try explaining it to an actual person next.' }),
        ]),
      ]),
    ]),

    section('Connected to your calendar', null, [
      scheduled.length
        ? el('p', {}, [
            `${topic.topic} is scheduled on `,
            el('strong', { text: scheduled.slice(0, 4).map((s) => `${formatShort(s.date)} (D${s.ladderDay})`).join(' · ') }),
          ])
        : el('p', { class: 'muted', text: 'This topic is not on the calendar yet.' }),
      analysis.score < 55
        ? el('div', {}, [
            el('p', {
              class: 'notice',
              text:
                `A score of ${analysis.score} means the explanation is still half-borrowed. That is a spacing problem, ` +
                'not an effort problem — marking this hard puts it on all eight rungs, starting again at D1.',
            }),
            topic.difficulty !== 'hard'
              ? el('button', {
                  class: 'btn primary',
                  text: 'Mark as hard & restart the ladder',
                  onClick: () => store.setTopicDifficulty(topic.id, 'hard'),
                })
              : el('p', { class: 'muted small', text: 'Already marked hard — all eight rungs are scheduled.' }),
          ])
        : el('p', {
            class: 'muted small',
            text: 'Re-run this at D14 and again at D60. A score that holds up cold, months later, is the real test.',
          }),
    ]),
  ];
}

export function renderFeynman(plan, { goToTab } = {}) {
  const topics = store.topicsWithSubject();

  if (!topics.length) {
    return el('div', { class: 'view' }, [
      section('Feynman mode', null, [
        empty('Add a topic first — this works on one idea at a time.', 'Add topics', () => goToTab?.('subjects')),
      ]),
    ]);
  }

  const state = store.getState();
  let topicId = state.feynman.topicId;
  if (!topicId || !topics.some((t) => t.id === topicId)) {
    topicId = topics[0].id;
  }
  const topic = topics.find((t) => t.id === topicId);
  const notes = store.getNotes(topic.id);
  const draft = store.getExplanation(topic.id);

  const box = el('textarea', {
    class: 'input textarea explain-box',
    rows: 10,
    placeholder:
      `Explain ${topic.topic} as if the person listening has never heard of it.\n\n` +
      'No notes open. No jargon you cannot unpack. If you find yourself stuck mid-sentence, write that down too — ' +
      'that is the finding.',
    'aria-label': 'Your explanation',
  });
  box.value = draft;

  const input = section('Feynman mode', `Explain ${topic.topic} in plain words, then see where it breaks.`, [
    el('label', { class: 'field' }, [
      el('span', { text: 'Topic' }),
      el(
        'select',
        {
          class: 'input select',
          onChange: (e) => {
            store.setFeynmanTopic(e.target.value);
            ui.analysis = null;
            ui.redirect = null;
          },
        },
        topics.map((t) => el('option', { value: t.id, text: `${t.subject} — ${t.topic}`, selected: t.id === topicId })),
      ),
    ]),

    el('ol', { class: 'steps' }, [
      el('li', { text: 'Close your notes. Genuinely — the check below can tell when you did not.' }),
      el('li', { text: 'Explain it as if to a smart twelve-year-old, in full sentences.' }),
      el('li', { text: 'Get the analysis, then answer the questions it asks back.' }),
      el('li', { text: 'Explain it again. The second attempt is where the learning happens.' }),
    ]),

    box,

    el('div', { class: 'button-row' }, [
      el('button', {
        class: 'btn primary',
        text: 'Check my explanation',
        onClick: () => {
          const text = box.value;
          store.saveExplanation(topic.id, text);
          if (isDirectAnswerRequest(text)) {
            ui.redirect = buildGuidedRedirect(text);
            ui.analysis = null;
          } else {
            ui.redirect = null;
            ui.analysis = analyseExplanation(text, { notes, topic: topic.topic });
          }
          store.refresh();
        },
      }),
      el('button', {
        class: 'btn',
        text: ui.showNotes ? 'Hide my notes' : 'Show my notes',
        title: 'Only after you have written the explanation',
        onClick: () => {
          ui.showNotes = !ui.showNotes;
          store.refresh();
        },
      }),
      el('button', {
        class: 'btn',
        text: 'Clear',
        onClick: () => {
          store.saveExplanation(topic.id, '');
          ui.analysis = null;
          ui.redirect = null;
          store.refresh();
        },
      }),
    ]),

    !notes.trim()
      ? el('p', { class: 'notice' }, [
          'No notes saved for this topic, so the "are you reciting?" and coverage checks are off. ',
          el('button', { class: 'link-btn', text: 'Add notes in Study Buddy', onClick: () => goToTab?.('buddy') }),
          ' to switch them on.',
        ])
      : null,

    ui.showNotes && notes.trim()
      ? el('div', { class: 'notes-peek' }, [
          el('h4', { text: 'Your notes' }),
          el('pre', { class: 'notes-raw', text: notes }),
        ])
      : null,
  ]);

  if (ui.redirect) {
    return el('div', { class: 'view' }, [
      input,
      section('That is not an explanation', null, [
        el('div', { class: 'guard' }, [
          el('h3', { text: ui.redirect.headline }),
          el('p', { class: 'muted', text: ui.redirect.reason }),
          el('ol', { class: 'guard-steps' }, ui.redirect.steps.map((s) =>
            el('li', {}, [el('strong', { text: s.title }), el('p', { text: s.detail })]),
          )),
        ]),
      ]),
    ]);
  }

  if (!ui.analysis) {
    return el('div', { class: 'view' }, [
      input,
      section('Why this works', null, [
        el('ul', { class: 'bullets' }, [
          el('li', { text: 'Reciting and understanding feel identical from the inside. Explaining out loud is the cheapest way to tell them apart.' }),
          el('li', { text: 'The check compares your wording against your notes, so lifted phrasing shows up as a number rather than a feeling.' }),
          el('li', { text: 'Every technical term you use gets checked: did you explain it, or lean on it?' }),
          el('li', { text: 'You get questions back, never answers. Answering them is the second pass.' }),
        ]),
      ]),
    ]);
  }

  if (ui.analysis.tooShort) {
    return el('div', { class: 'view' }, [
      input,
      section('Not enough to analyse', null, [el('p', { class: 'notice', text: ui.analysis.message })]),
    ]);
  }

  return el('div', { class: 'view' }, [input, ...analysisPanels(ui.analysis, topic, plan)]);
}
