/**
 * The plan, in four shapes: a week-by-week revision timetable, a day calendar,
 * a chronological list, and a spacing timeline.
 */

import { el, section, empty, details } from '../dom.js';
import * as store from '../store.js';
import { groupByWeek } from '../../core/scheduler.js';
import { WEEKDAY_NAMES, formatShort, toISODate } from '../../core/dates.js';
import { googleCalendarLink } from '../../core/exporters.js';

const VIEWS = [
  { key: 'timetable', label: 'Timetable' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'list', label: 'List' },
  { key: 'timeline', label: 'Timeline' },
];

/** A checklist bound to the store, so ticks persist across reloads. */
export function checklist(session) {
  return el(
    'ul',
    { class: 'checklist' },
    (session.tasks || []).map((task) => {
      const done = store.isTaskDone(session.id, task.id);
      const id = `${session.id}-${task.id}`;
      return el('li', { class: `check-item${done ? ' is-done' : ''}` }, [
        el('input', {
          type: 'checkbox',
          id,
          checked: done,
          onChange: () => store.toggleTask(session.id, task.id),
        }),
        el('label', { for: id }, [
          el('span', { text: task.text }),
          task.minutes ? el('span', { class: 'mins', text: `${task.minutes}m` }) : null,
        ]),
      ]);
    }),
  );
}

export function progressBar(percent) {
  return el('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': percent }, [
    el('div', { class: 'progress-fill', style: { width: `${percent}%` } }),
  ]);
}

/** One day's card: the single topic, its pass label and its checklist. */
export function sessionCard(session, { showDate = true, open = false } = {}) {
  const percent = store.sessionProgress(session);
  const total = (session.tasks || []).reduce((sum, t) => sum + (t.minutes || 0), 0);

  return el('article', { class: `session-card diff-${session.difficulty}` }, [
    el('header', { class: 'session-head' }, [
      el('div', {}, [
        showDate ? el('p', { class: 'session-date', text: formatShort(session.date) }) : null,
        el('h3', { class: 'session-title' }, [
          el('span', { class: 'subject-tag', text: session.subject }),
          el('span', { text: session.topic }),
        ]),
      ]),
      el('span', { class: `pill pill-${session.difficulty}`, text: session.repLabel }),
    ]),
    progressBar(percent),
    el('p', { class: 'muted small', text: `Pass ${session.repIndex + 1} of ${session.repCount} · ~${total} min · ${percent}% done` }),
    details(
      `card:${session.id}`,
      'Checklist',
      [
        checklist(session),
        el('a', {
          class: 'link small',
          href: googleCalendarLink(session, { startTime: store.getState().settings.startTime }),
          target: '_blank',
          rel: 'noopener',
          text: 'Add this session to Google Calendar →',
        }),
      ],
      open,
    ),
  ]);
}

/* ------------------------------------------------------------- timetable -- */

/**
 * The exam-revision-timetable matrix: subjects and topics down the side, weeks
 * across the top — exactly the layout the brief asks for.
 */
function timetableView(plan) {
  const topics = store.topicsWithSubject();
  if (!topics.length) return empty('Add subjects and topics to build a timetable.');

  const weekCount = plan.weeks;
  const header = el('tr', {}, [
    el('th', { class: 'sticky-col', text: 'Subject / topic' }),
    ...Array.from({ length: weekCount }, (_, i) => el('th', { text: `Week ${i + 1}` })),
  ]);

  const rows = [];
  let lastSubject = null;

  for (const topic of topics) {
    if (topic.subject !== lastSubject) {
      lastSubject = topic.subject;
      rows.push(
        el('tr', { class: 'subject-divider' }, [
          el('th', { class: 'sticky-col', colspan: weekCount + 1 }, [
            el('span', { class: 'dot', style: { background: topic.color } }),
            topic.subject,
          ]),
        ]),
      );
    }

    const sessions = plan.sessions.filter((s) => s.topicId === topic.id);
    const cells = Array.from({ length: weekCount }, (_, week) => {
      const inWeek = sessions.filter((s) => Math.floor(s.dayIndex / 7) === week);
      return el(
        'td',
        { class: inWeek.length ? 'has-session' : '' },
        inWeek.map((s) =>
          el('span', { class: `slot slot-${s.difficulty}`, title: s.tasks.map((t) => `• ${t.text}`).join('\n') }, [
            el('strong', { text: WEEKDAY_NAMES[s.date.getDay()] }),
            ` ${s.date.getDate()}`,
            el('span', { class: 'slot-pass', text: s.repLabel }),
          ]),
        ),
      );
    });

    rows.push(
      el('tr', {}, [
        el('th', { class: 'sticky-col topic-cell' }, [
          el('span', { class: `dot dot-${topic.difficulty}` }),
          topic.topic,
        ]),
        ...cells,
      ]),
    );
  }

  return el('div', { class: 'table-scroll' }, [
    el('table', { class: 'timetable' }, [el('thead', {}, header), el('tbody', {}, rows)]),
  ]);
}

/* -------------------------------------------------------------- calendar -- */

function calendarView(plan) {
  const weeks = groupByWeek(plan.days);
  const todayISO = toISODate(new Date());

  return el('div', { class: 'calendar' }, [
    el(
      'div',
      { class: 'calendar-head' },
      WEEKDAY_NAMES.map((name) => el('div', { class: 'calendar-head-cell', text: name })),
    ),
    ...weeks.map((days, weekIndex) =>
      el('div', { class: 'calendar-week' }, [
        el('div', { class: 'week-label', text: `Week ${weekIndex + 1}` }),
        el(
          'div',
          { class: 'calendar-row' },
          days.map((day) => {
            const isToday = day.iso === todayISO;
            const session = day.session;
            const percent = session ? store.sessionProgress(session) : 0;

            return el(
              'div',
              {
                class:
                  `calendar-cell${isToday ? ' is-today' : ''}` +
                  `${!day.available ? ' is-off' : ''}${session ? ` diff-${session.difficulty}` : ' is-empty'}` +
                  `${percent === 100 ? ' is-complete' : ''}`,
              },
              [
                el('div', { class: 'cell-date' }, [
                  el('span', { text: String(day.date.getDate()) }),
                  isToday ? el('span', { class: 'today-badge', text: 'Today' }) : null,
                ]),
                session
                  ? el('div', { class: 'cell-body' }, [
                      el('p', { class: 'cell-subject', text: session.subject }),
                      el('p', { class: 'cell-topic', text: session.topic }),
                      el('p', { class: 'cell-pass', text: session.repLabel }),
                      progressBar(percent),
                      details(`cell:${session.id}`, `${session.tasks.length} tasks`, checklist(session)),
                    ])
                  : el('p', { class: 'cell-rest', text: day.available ? 'Rest / buffer' : 'Off' }),
              ],
            );
          }),
        ),
      ]),
    ),
  ]);
}

/* ------------------------------------------------------------------ list -- */

function listView(plan) {
  if (!plan.sessions.length) return empty('Nothing scheduled yet.');
  const weeks = new Map();
  for (const session of plan.sessions) {
    const week = Math.floor(session.dayIndex / 7);
    if (!weeks.has(week)) weeks.set(week, []);
    weeks.get(week).push(session);
  }

  return el(
    'div',
    { class: 'list-view' },
    [...weeks.entries()].map(([week, sessions]) =>
      el('div', { class: 'list-week' }, [
        el('h3', { class: 'week-heading', text: `Week ${week + 1}` }),
        el('div', { class: 'card-grid' }, sessions.map((s) => sessionCard(s))),
      ]),
    ),
  );
}

/* -------------------------------------------------------------- timeline -- */

/**
 * Shows the spacing itself — each topic as a track, its passes as markers.
 * Makes it obvious at a glance that hard topics come back three times.
 */
function timelineView(plan) {
  const topics = store.topicsWithSubject();
  if (!topics.length) return empty('Add topics to see the spacing timeline.');
  const span = plan.horizonDays;

  return el('div', { class: 'timeline' }, [
    el(
      'div',
      { class: 'timeline-ruler' },
      Array.from({ length: plan.weeks }, (_, i) =>
        el('span', { class: 'ruler-mark', style: { width: `${(7 / span) * 100}%` }, text: `W${i + 1}` }),
      ),
    ),
    ...topics.map((topic) => {
      const sessions = plan.sessions.filter((s) => s.topicId === topic.id);
      return el('div', { class: 'timeline-row' }, [
        el('div', { class: 'timeline-label' }, [
          el('span', { class: `dot dot-${topic.difficulty}` }),
          el('span', { class: 'timeline-topic', text: topic.topic }),
          el('span', { class: 'muted small', text: topic.subject }),
        ]),
        el(
          'div',
          { class: 'timeline-track' },
          sessions.map((s, i) => [
            i > 0
              ? el('span', {
                  class: 'timeline-gap',
                  style: {
                    left: `${(sessions[i - 1].dayIndex / span) * 100}%`,
                    width: `${((s.dayIndex - sessions[i - 1].dayIndex) / span) * 100}%`,
                  },
                  title: `${s.dayIndex - sessions[i - 1].dayIndex} day gap`,
                })
              : null,
            el('span', {
              class: `timeline-dot diff-${s.difficulty}`,
              style: { left: `${(s.dayIndex / span) * 100}%` },
              title: `${formatShort(s.date)} — ${s.repLabel}`,
              text: String(i + 1),
            }),
          ]),
        ),
      ]);
    }),
  ]);
}

/* ------------------------------------------------------------------ view -- */

export function renderPlan(plan) {
  const state = store.getState();

  if (!plan.sessions.length) {
    return el('div', { class: 'view' }, [
      section('Your revision plan', null, [
        empty(
          'No plan yet — add subjects and topics first, and the calendar builds itself.',
          'Load example plan',
          () => store.loadSample(),
        ),
      ]),
    ]);
  }

  const switcher = el(
    'div',
    { class: 'view-switch', role: 'tablist' },
    VIEWS.map((view) =>
      el('button', {
        class: `switch-btn${state.planView === view.key ? ' is-active' : ''}`,
        type: 'button',
        role: 'tab',
        'aria-selected': state.planView === view.key,
        text: view.label,
        onClick: () => store.setPlanView(view.key),
      }),
    ),
  );

  const body =
    state.planView === 'timetable'
      ? timetableView(plan)
      : state.planView === 'list'
        ? listView(plan)
        : state.planView === 'timeline'
          ? timelineView(plan)
          : calendarView(plan);

  const totalTasks = plan.sessions.reduce((sum, s) => sum + s.tasks.length, 0);
  const doneTasks = plan.sessions.reduce(
    (sum, s) => sum + s.tasks.filter((t) => store.isTaskDone(s.id, t.id)).length,
    0,
  );

  return el('div', { class: 'view' }, [
    el('div', { class: 'panel' }, [
      el('header', { class: 'panel-head row' }, [
        el('div', {}, [
          el('h2', { text: 'Your revision plan' }),
          el('p', {
            class: 'muted',
            text:
              `${plan.sessions.length} sessions across ${plan.weeks} weeks · one topic per day · ` +
              `${doneTasks}/${totalTasks} tasks done`,
          }),
        ]),
        switcher,
      ]),
      el('div', { class: 'panel-body' }, [
        plan.overflowDays > 0
          ? el('p', {
              class: 'notice',
              text:
                `Your topics need ${plan.overflowDays} day(s) beyond the ${state.settings.horizonDays / 7}-week window, ` +
                'so the plan was extended rather than doubling topics onto shared days.',
            })
          : null,
        body,
      ]),
    ]),
  ]);
}
