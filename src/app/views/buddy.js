/**
 * Study Buddy mode: bring your notes, see them against the structure complete
 * notes have, then walk the concept step by step in Learn Mode.
 */

import { el, section, empty, inlineMarkdown } from '../dom.js';
import * as store from '../store.js';
import { compareNotes, buildLearnMode } from '../../core/notes.js';
import { COACH, USER, createConversation, opener, respond, say } from '../../core/coach.js';
import { isDirectAnswerRequest, buildGuidedRedirect } from '../../core/policy.js';
import { sessionsForTopic } from '../../core/scheduler.js';
import { formatShort } from '../../core/dates.js';

/** Kept outside the store: transient UI state, not worth persisting. */
const ui = { topicId: null, showLearn: false, notice: null, mode: 'chat', conversation: null, draft: '' };

/** The chat transcript, kept per topic so switching away does not lose it. */
const conversations = new Map();

function conversationFor(topic, notes) {
  const hasNotes = Boolean(notes.trim());
  const existing = conversations.get(topic.id);

  // The opener says whether it has notes to check against. If notes arrive
  // before the first reply, that line is already wrong — so regenerate it
  // while the conversation is still just the greeting.
  const staleOpener = existing && existing.turns.length === 1 && existing.hadNotes !== hasNotes;

  if (!existing || staleOpener) {
    const fresh = say(createConversation(topic.topic), COACH, opener(topic.topic, notes));
    fresh.hadNotes = hasNotes;
    conversations.set(topic.id, fresh);
  }
  return conversations.get(topic.id);
}

function chatPanel(topic, notes) {
  const conversation = conversationFor(topic, notes);

  const input = el('textarea', {
    class: 'input textarea chat-input',
    rows: 3,
    placeholder: `Talk to me about ${topic.topic}. Explain it, argue with me, or say you are stuck.`,
    'aria-label': 'Message',
    onInput: (e) => {
      ui.draft = e.target.value;
    },
    onKeyDown: (e) => {
      // Enter sends, shift+enter makes a new line — chat convention.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
  });
  input.value = ui.draft;

  function send() {
    const message = ui.draft.trim();
    if (!message) return;
    const current = conversationFor(topic, notes);
    const reply = respond({ message, conversation: current, notes, topic: topic.topic });

    let next = say(current, USER, message);
    next = say(next, COACH, reply.text, { kind: reply.kind, score: reply.analysis?.score });
    if (reply.state) Object.assign(next, reply.state);

    conversations.set(topic.id, next);
    ui.draft = '';
    store.refresh();
  }

  const transcript = el(
    'div',
    {
      class: 'chat-log',
      // The newest turn is the one worth reading; without this the view stays
      // pinned to the greeting and the reply you just earned is below the fold.
    },
    conversation.turns.map((turn) =>
      el('div', { class: `chat-turn is-${turn.role}` }, [
        el('span', { class: 'chat-who', text: turn.role === USER ? 'You' : 'Buddy' }),
        el('div', { class: 'chat-bubble' }, [
          el('p', { text: turn.text }),
          turn.score !== undefined && turn.score !== null
            ? el('span', { class: 'chat-score', title: 'How well that attempt held up', text: `${turn.score}/100` })
            : null,
        ]),
      ]),
    ),
  );

  // Pin to the newest message once the node is in the document.
  requestAnimationFrame(() => {
    if (transcript.isConnected) transcript.scrollTop = transcript.scrollHeight;
  });

  return section(
    'Talk it through',
    'It asks; you answer. It will not define a term, finish a sentence, or hand you a result — it only has your notes and your words to work with.',
    [
      transcript,
      input,
      el('div', { class: 'button-row' }, [
        el('button', { class: 'btn primary', text: 'Send', onClick: () => send() }),
        el('button', {
          class: 'btn',
          text: 'Start over',
          onClick: () => {
            conversations.delete(topic.id);
            ui.draft = '';
            store.refresh();
          },
        }),
      ]),
      !notes.trim()
        ? el('p', {
            class: 'notice small',
            text:
              'No notes saved for this topic yet, so it cannot tell whether you are thinking or reciting. Add some below and the questions get much sharper.',
          })
        : null,
    ],
  );
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function guidedRedirectCard(redirect) {
  return el('div', { class: 'guard' }, [
    el('h3', { text: redirect.headline }),
    el('p', { class: 'muted', text: redirect.reason }),
    el(
      'ol',
      { class: 'guard-steps' },
      redirect.steps.map((step) => el('li', {}, [el('strong', { text: step.title }), el('p', { text: step.detail })])),
    ),
    el('h4', { text: 'Questions to get you moving' }),
    el('ul', { class: 'bullets' }, redirect.prompts.map((p) => el('li', { text: p }))),
  ]);
}

function comparisonColumns(comparison, notesText) {
  const parsed = comparison.parsed;

  const columnA = el('div', { class: 'compare-col' }, [
    el('h3', { text: 'A · Your notes' }),
    parsed.sections.length
      ? el(
          'div',
          { class: 'notes-render' },
          parsed.sections.map((sec) =>
            el('div', { class: 'note-section' }, [
              sec.heading ? el('h4', { text: sec.heading }) : null,
              el('ul', {}, sec.lines.map((line) => el('li', { text: line.replace(/^([-*•]|\d+[.)])\s+/, '') }))),
            ]),
          ),
        )
      : el('pre', { class: 'notes-raw', text: notesText }),
    el('p', { class: 'muted small', text: `${parsed.wordCount} words · ${parsed.headings.length} headings · ${parsed.bullets.length} bullets` }),
  ]);

  const columnB = el('div', { class: 'compare-col' }, [
    el('h3', { text: 'B · Study Buddy structure' }),
    el('p', {
      class: 'muted small',
      text:
        'Your material, refiled into the shape complete notes take. Empty slots show what is missing — ' +
        'they are prompts for you to fill, not facts invented on your behalf.',
    }),
    el(
      'div',
      { class: 'structure' },
      comparison.structured.map((sec) =>
        el('div', { class: `struct-section is-${sec.covered ? 'covered' : 'missing'}` }, [
          el('h4', {}, [
            el('span', { class: `tick ${sec.covered ? 'ok' : 'gap'}`, text: sec.covered ? '✓' : '○' }),
            sec.title,
          ]),
          sec.covered
            ? el('ul', {}, sec.content.map((line) => el('li', { text: line.replace(/^([-*•]|\d+[.)])\s+/, '') })))
            : el('p', { class: 'struct-prompt', text: sec.prompt }),
        ]),
      ),
    ),
  ]);

  return el('div', { class: 'compare' }, [columnA, columnB]);
}

function learnModePanel(comparison, topic) {
  const learn = buildLearnMode(comparison);
  return section('Learn Mode', `Step-by-step through ${topic.topic}. Each step ends with something for you to do.`, [
    el(
      'ol',
      { class: 'learn-steps' },
      learn.steps.map((step) =>
        el('li', { class: 'learn-step' }, [
          el('h4', { text: step.title }),
          el('p', { text: step.body }),
          el('p', { class: 'analogy' }, [el('strong', { text: 'Think of it like this: ' }), step.analogy]),
          el('p', { class: 'check' }, [el('strong', { text: 'Your turn: ' }), step.check]),
        ]),
      ),
    ),
    el('div', { class: 'reflect' }, [
      el('h4', { text: 'Before you close this' }),
      el('ul', { class: 'bullets' }, learn.reflection.map((r) => el('li', { text: r }))),
    ]),
  ]);
}

export function renderBuddy(plan, { goToTab } = {}) {
  const topics = store.topicsWithSubject();

  if (!topics.length) {
    return el('div', { class: 'view' }, [
      section('Study Buddy', null, [
        empty('Add a subject and topic first — Study Buddy works on one topic at a time.', 'Add topics', () => goToTab?.('subjects')),
      ]),
    ]);
  }

  if (!ui.topicId || !topics.some((t) => t.id === ui.topicId)) ui.topicId = topics[0].id;
  const topic = topics.find((t) => t.id === ui.topicId);
  const notesText = store.getNotes(topic.id);

  const textarea = el('textarea', {
    class: 'input textarea',
    rows: 12,
    placeholder:
      'Paste or type your notes on this topic…\n\nHeadings, bullets and "term: definition" lines all get recognised.',
    'aria-label': 'Your notes',
  });
  textarea.value = notesText;

  // Held as a factory in module state, not as a live DOM node. Background work
  // — the activity tracker banking a session, the Pomodoro changing phase —
  // re-renders the whole app at arbitrary moments, and anything kept only in
  // the DOM is wiped when that happens.
  const showNotice = (factory) => {
    ui.notice = factory;
    store.refresh();
  };
  const noticeSlot = el('div', {}, ui.notice ? ui.notice() : null);

  const topicSelect = el(
    'select',
    {
      class: 'input select',
      'aria-label': 'Topic',
      onChange: (e) => {
        ui.topicId = e.target.value;
        ui.showLearn = false;
        ui.notice = null;
        store.refresh();
      },
    },
    topics.map((t) =>
      el('option', { value: t.id, text: `${t.subject} — ${t.topic}`, selected: t.id === ui.topicId }),
    ),
  );

  const fileInput = el('input', {
    type: 'file',
    class: 'input',
    accept: '.txt,.md,.markdown,.csv,.json,text/*',
    'aria-label': 'Upload notes file',
    onChange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Binary formats cannot be read here without shipping a parser, and a
      // half-decoded PDF would produce nonsense analysis. Say so plainly.
      if (/\.(pdf|docx?|pptx?|pages)$/i.test(file.name)) {
        showNotice(() =>
          el('p', {
            class: 'notice',
            text:
              `${file.name} is a binary format this app cannot read directly. Open it, copy the text, and paste it ` +
              'into the box above — the analysis works on text.',
          }),
        );
        return;
      }
      try {
        const text = await readTextFile(file);
        textarea.value = textarea.value ? `${textarea.value}\n\n${text}` : text;
        showNotice(() => el('p', { class: 'notice ok', text: `Loaded ${file.name} (${text.split(/\s+/).length} words).` }));
      } catch {
        showNotice(() => el('p', { class: 'notice error', text: 'Could not read that file.' }));
      }
    },
  });

  const modeSwitch = el('div', { class: 'view-switch', role: 'tablist' }, [
    ['chat', 'Talk'],
    ['notes', 'Compare notes'],
  ].map(([key, label]) =>
    el('button', {
      class: `switch-btn${ui.mode === key ? ' is-active' : ''}`,
      type: 'button',
      text: label,
      onClick: () => {
        ui.mode = key;
        store.refresh();
      },
    }),
  ));

  const inputPanel = section('Study Buddy', 'Give me your notes on a topic and I will show you what a complete set looks like beside them.', [
    el('div', { class: 'settings-grid' }, [
      el('label', { class: 'field' }, [el('span', { text: 'Upload a text file' }), fileInput]),
    ]),
    textarea,
    noticeSlot,
    el('div', { class: 'button-row' }, [
      el('button', {
        class: 'btn primary',
        text: 'Compare my notes',
        onClick: () => {
          const text = textarea.value;
          // The policy guard applies here too: notes are a legitimate use, but
          // "just write the answer for me" pasted into the box is not.
          if (isDirectAnswerRequest(text)) {
            const redirect = buildGuidedRedirect(text);
            showNotice(() => guidedRedirectCard(redirect));
            return;
          }
          ui.showLearn = false;
          ui.notice = null;
          store.saveNotes(topic.id, text);
        },
      }),
      el('button', {
        class: 'btn',
        text: ui.showLearn ? 'Hide Learn Mode' : 'Start Learn Mode',
        onClick: () => {
          store.saveNotes(topic.id, textarea.value);
          ui.showLearn = !ui.showLearn;
          store.refresh();
        },
      }),
    ]),
  ]);

  const topicBar = el('div', { class: 'panel' }, [
    el('header', { class: 'panel-head row' }, [
      el('div', {}, [
        el('h2', { text: 'Study Buddy' }),
        el('p', { class: 'muted', text: `${topic.subject} — ${topic.topic}` }),
      ]),
      modeSwitch,
    ]),
    el('div', { class: 'panel-body' }, [
      el('label', { class: 'field' }, [el('span', { text: 'Topic' }), topicSelect]),
    ]),
  ]);

  if (ui.mode === 'chat') {
    return el('div', { class: 'view' }, [topicBar, chatPanel(topic, notesText)]);
  }

  if (!notesText.trim()) {
    return el('div', { class: 'view' }, [
      topicBar,
      inputPanel,
      section('Comparison', null, [
        empty('Paste your notes and hit Compare. Even rough notes are enough to find the gaps.'),
      ]),
    ]);
  }

  const comparison = compareNotes(notesText, { subject: topic.subject, topic: topic.topic });
  const scheduled = sessionsForTopic(plan, topic.id);
  const isWeak = comparison.coverageScore < 50;

  const analysis = section('What this tells us', `Structural coverage: ${comparison.coverageScore}%`, [
    el('div', { class: 'analysis-grid' }, [
      el('div', { class: 'analysis-col ok' }, [
        el('h4', { text: 'Where your notes are strong' }),
        el('ul', { class: 'bullets' }, comparison.strengths.map((s) => el('li', { text: s }))),
      ]),
      el('div', { class: 'analysis-col gap' }, [
        el('h4', { text: 'What you might be missing' }),
        comparison.gaps.length
          ? el(
              'ul',
              { class: 'bullets' },
              comparison.gaps.map((g) => el('li', {}, [el('strong', { text: `${g.title}: ` }), g.why])),
            )
          : el('p', { class: 'muted', text: 'Every structural slot is covered. Now the work is depth, not breadth — test yourself on it.' }),
      ]),
      el('div', { class: 'analysis-col tip' }, [
        el('h4', { text: 'Suggested improvements' }),
        el('ul', { class: 'bullets' }, comparison.suggestions.map((s) => el('li', { html: inlineMarkdown(s) }))),
      ]),
    ]),

    el('div', { class: 'schedule-link' }, [
      el('h4', { text: 'Connected to your calendar' }),
      scheduled.length
        ? el('p', {}, [
            `${topic.topic} is scheduled ${scheduled.length} time(s): `,
            el('strong', { text: scheduled.map((s) => formatShort(s.date)).join(' · ') }),
          ])
        : el('p', { class: 'muted', text: 'This topic is not on the calendar yet.' }),
      isWeak
        ? el('div', {}, [
            el('p', {
              class: 'notice',
              text:
                `Coverage is ${comparison.coverageScore}% — thin enough that this topic needs more passes, not more reading. ` +
                'Marking it hard puts it on every rung of the ladder: D1, D2, D4, D7, D14, D30, D60 and D120.',
            }),
            topic.difficulty !== 'hard'
              ? el('button', {
                  class: 'btn primary',
                  text: 'Mark as hard & reschedule',
                  onClick: () => store.setTopicDifficulty(topic.id, 'hard'),
                })
              : el('p', { class: 'muted small', text: 'Already marked hard — three passes are scheduled.' }),
          ])
        : null,
    ]),
  ]);

  return el('div', { class: 'view' }, [
    topicBar,
    inputPanel,
    section('Side by side', 'Column A is what you wrote. Column B is the same material, structured.', [
      comparisonColumns(comparison, notesText),
    ]),
    analysis,
    ui.showLearn ? learnModePanel(comparison, topic) : null,
  ]);
}
