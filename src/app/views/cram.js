/** Test / Quiz Cram Mode — a compressed plan from now until the test. */

import { el, section, empty, details, download, copyText, flash } from '../dom.js';
import * as store from '../store.js';
import { planCram } from '../../core/cram.js';
import { checklist, progressBar } from './plan.js';
import { fromISODateTime, formatShort, formatLong } from '../../core/dates.js';
import { toICS, toCSV, toNotionMarkdown } from '../../core/exporters.js';

function timeToTest(testDate, now = new Date()) {
  const ms = testDate - now;
  const hours = Math.floor(ms / 3600000);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} away`;
  return `${Math.floor(hours / 24)} days away`;
}

function cramDay(day) {
  const session = day.session;
  const percent = session ? store.sessionProgress(session) : 0;

  return el('div', { class: `cram-day${day.isTestDay ? ' is-test-day' : ''}${session ? ` diff-${session.difficulty}` : ' is-empty'}` }, [
    el('p', { class: 'cram-date', text: formatShort(day.date) }),
    session
      ? el('div', {}, [
          el('p', { class: 'cell-subject', text: session.subject }),
          el('p', { class: 'cell-topic', text: session.topic }),
          el('p', { class: 'cell-pass', text: session.repLabel }),
          progressBar(percent),
          details(`cram:${session.id}`, `${session.tasks.length} tasks`, checklist(session), day.dayIndex === 0),
        ])
      : el('p', { class: 'cell-rest', text: 'Buffer' }),
    day.isTestDay ? el('p', { class: 'test-flag', text: 'TEST DAY' }) : null,
  ]);
}

function blockTimeline(result) {
  const fmt = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  if (!result.blocks.length) {
    return el('p', { class: 'notice', text: result.message });
  }

  return el('div', {}, [
    el('p', { class: 'notice', text: result.message }),
    el(
      'ol',
      { class: 'block-timeline' },
      result.blocks.map((block) =>
        el('li', { class: `block diff-${block.difficulty}` }, [
          el('span', { class: 'block-time', text: `${fmt(block.start)}–${fmt(block.end)}` }),
          el('div', { class: 'block-body' }, [
            el('p', { class: 'cell-subject', text: block.subject }),
            el('p', { class: 'cell-topic', text: block.topic }),
            checklist(block),
          ]),
        ]),
      ),
    ),
  ]);
}

export function renderCram() {
  const state = store.getState();
  const topics = store.topicsWithSubject();
  const { cram } = state;

  if (!topics.length) {
    return el('div', { class: 'view' }, [
      section('Test / Quiz Cram Mode', null, [
        empty('Add some topics first — cram mode compresses your existing topics into the time you have left.'),
      ]),
    ]);
  }

  const picker = section(
    'Test / Quiz Cram Mode',
    'Two questions: what are you cramming, and when is the test?',
    [
      el('div', { class: 'field' }, [
        el('span', { text: '1. Which topics?' }),
        el(
          'div',
          { class: 'topic-picker' },
          topics.map((topic) =>
            el('button', {
              type: 'button',
              class: `chip chip-${topic.difficulty}${cram.topicIds.includes(topic.id) ? ' is-active' : ''}`,
              title: `${topic.subject} · ${topic.difficulty}`,
              text: topic.topic,
              onClick: () => store.toggleCramTopic(topic.id),
            }),
          ),
        ),
        el('p', {
          class: 'muted small',
          text: 'Add as many as you like — but the one-topic-per-day rule still holds, so more topics means fewer passes each.',
        }),
      ]),

      el('div', { class: 'settings-grid' }, [
        el('label', { class: 'field' }, [
          el('span', { text: '2. Test date' }),
          el('input', {
            type: 'date',
            class: 'input',
            value: cram.testDate,
            onChange: (e) => store.updateCram({ testDate: e.target.value }),
          }),
        ]),
        el('label', { class: 'field' }, [
          el('span', { text: 'Test time' }),
          el('input', {
            type: 'time',
            class: 'input',
            value: cram.testTime,
            onChange: (e) => store.updateCram({ testTime: e.target.value }),
          }),
        ]),
      ]),
    ],
  );

  const selected = topics.filter((t) => cram.topicIds.includes(t.id));

  if (!selected.length || !cram.testDate) {
    return el('div', { class: 'view' }, [
      picker,
      section('Your cram schedule', null, [
        empty('Pick at least one topic and set the test date to generate the schedule.'),
      ]),
    ]);
  }

  const testDate = fromISODateTime(cram.testDate, cram.testTime || '09:00');
  const result = planCram({ topics: selected, testDate });

  if (!result.ok) {
    return el('div', { class: 'view' }, [picker, section('Your cram schedule', null, [el('p', { class: 'notice error', text: result.error })])]);
  }

  const exportBar = (sessions) =>
    el('div', { class: 'button-row' }, [
      el('button', {
        class: 'btn',
        text: 'Download .ics',
        onClick: (e) => {
          download('cram-plan.ics', toICS(sessions, { startTime: state.settings.startTime, calendarName: 'Cram Plan' }), 'text/calendar');
          flash(e.target, 'Downloaded');
        },
      }),
      el('button', {
        class: 'btn',
        text: 'Download CSV',
        onClick: (e) => {
          download('cram-plan.csv', toCSV(sessions, { startTime: state.settings.startTime }), 'text/csv');
          flash(e.target, 'Downloaded');
        },
      }),
      el('button', {
        class: 'btn',
        text: 'Copy for Notion',
        onClick: async (e) => {
          const ok = await copyText(toNotionMarkdown(sessions, { title: 'Cram Plan' }));
          flash(e.target, ok ? 'Copied' : 'Copy failed');
        },
      }),
    ]);

  if (result.mode === 'blocks') {
    return el('div', { class: 'view' }, [
      picker,
      section(`Final run-up — test ${formatLong(testDate)}`, timeToTest(testDate), [blockTimeline(result)]),
    ]);
  }

  const warnings = [];
  if (result.uncovered.length) {
    warnings.push(
      `There is not enough time to cover: ${result.uncovered.map((t) => t.topic).join(', ')}. ` +
        'With one topic per day, that is a hard limit — drop the lowest-value topics rather than splitting days.',
    );
  }
  if (result.droppedPasses > 0) {
    warnings.push(
      `${result.droppedPasses} repeat pass(es) did not fit. Every topic still gets at least one session, ` +
        'but the spacing is thinner than ideal.',
    );
  }

  return el('div', { class: 'view' }, [
    picker,
    section(`Cram schedule — test ${formatLong(testDate)}`, `${timeToTest(testDate)} · ${result.daysAvailable} study day(s) · ${result.sessions.length} sessions`, [
      ...warnings.map((text) => el('p', { class: 'notice', text })),
      el('p', {
        class: 'muted small',
        text: 'Hard topics come first, while you have most time to recover, and the final days are review passes closest to the test.',
      }),
      el('div', { class: 'cram-grid' }, result.days.map(cramDay)),
      exportBar(result.sessions),
    ]),
  ]);
}
