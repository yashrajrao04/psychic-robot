/** App shell: tabs, plan rebuild, render loop. */

import { el, clear, qs } from './dom.js';
import * as store from './store.js';
import { planSchedule } from '../core/scheduler.js';
import { fromISODate } from '../core/dates.js';
import { renderOverview } from './views/overview.js';
import { renderPlan } from './views/plan.js';
import { renderSubjects } from './views/subjects.js';
import { renderCram } from './views/cram.js';
import { renderBuddy } from './views/buddy.js';
import { renderTesting } from './views/testing.js';
import { renderExports } from './views/exports.js';
import { renderPomodoro, startPomodoroEngine } from './views/pomodoro.js';
import { renderFeynman } from './views/feynman.js';
import { renderLearn } from './views/learn.js';
import { renderPractice } from './views/practice.js';
import { startActivityEngine, activityStatus } from './activityEngine.js';
import { formatSpan } from '../core/activity.js';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'plan', label: 'Plan' },
  { key: 'subjects', label: 'Topics' },
  { key: 'learn', label: 'Learn' },
  { key: 'pomodoro', label: 'Pomodoro' },
  { key: 'cram', label: 'Cram' },
  { key: 'buddy', label: 'Study Buddy' },
  { key: 'feynman', label: 'Feynman' },
  { key: 'practice', label: 'Tailored Practice' },
  { key: 'testing', label: 'Testing' },
  { key: 'export', label: 'Export' },
];

function goToTab(tab) {
  store.setTab(tab);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Rebuild the plan from current state — cheap enough to redo every render. */
function buildPlan() {
  const { settings } = store.getState();
  return planSchedule({
    topics: store.topicsWithSubject(),
    startDate: settings.startDate ? fromISODate(settings.startDate) : new Date(),
    horizonDays: settings.horizonDays,
    availableWeekdays: settings.availableWeekdays,
  });
}

/**
 * A visible read-out of what the tracker is doing. Time measured silently is
 * surveillance; time measured in plain sight is a tool.
 */
function trackerChip() {
  const status = activityStatus();
  const subject = status.subjectId ? store.subjectById(status.subjectId) : null;
  const label = subject ? subject.name : 'general study';

  if (status.state === 'active') {
    return el('span', {
      class: 'tracker-chip is-active',
      title: `Counting time against ${label}. Pauses when you are idle or away.`,
      text: `● ${label} · ${formatSpan(status.ms)}`,
    });
  }
  if (status.state === 'paused') {
    return el('span', {
      class: 'tracker-chip is-paused',
      title: 'Paused — no activity, or the tab is in the background. Idle time is not counted.',
      text: '⏸ paused',
    });
  }
  return el('span', { class: 'tracker-chip', title: 'Tracking starts when you interact with the app.', text: '○ not tracking' });
}

function header(activeTab) {
  return el('header', { class: 'app-header' }, [
    el('div', { class: 'brand' }, [
      el('span', { class: 'logo', text: '◱' }),
      el('div', {}, [
        el('h1', { text: 'Study Buddy' }),
        el('p', { class: 'tagline', text: 'Spaced repetition on D1 · D2 · D4 · D7 · D14 · D30 · D60 · D120.' }),
      ]),
      trackerChip(),
    ]),
    el(
      'nav',
      { class: 'tabs', role: 'tablist' },
      TABS.map((tab) =>
        el('button', {
          class: `tab${activeTab === tab.key ? ' is-active' : ''}`,
          type: 'button',
          role: 'tab',
          'aria-selected': activeTab === tab.key,
          text: tab.label,
          onClick: () => goToTab(tab.key),
        }),
      ),
    ),
  ]);
}

function render() {
  const state = store.getState();
  const plan = buildPlan();
  const root = qs('#app');
  if (!root) return;

  let body;
  switch (state.tab) {
    case 'plan':
      body = renderPlan(plan);
      break;
    case 'subjects':
      body = renderSubjects();
      break;
    case 'cram':
      body = renderCram();
      break;
    case 'buddy':
      body = renderBuddy(plan, { goToTab });
      break;
    case 'testing':
      body = renderTesting(plan, { goToTab });
      break;
    case 'pomodoro':
      body = renderPomodoro(plan, { goToTab });
      break;
    case 'feynman':
      body = renderFeynman(plan, { goToTab });
      break;
    case 'learn':
      body = renderLearn(plan, { goToTab });
      break;
    case 'practice':
      body = renderPractice(plan, { goToTab });
      break;
    case 'export':
      body = renderExports(plan);
      break;
    default:
      body = renderOverview(plan, { goToTab });
  }

  clear(root);
  root.appendChild(header(state.tab));
  root.appendChild(el('main', { class: 'app-main' }, [body]));
  root.appendChild(
    el('footer', { class: 'app-footer' }, [
      el('p', {
        text:
          'Study Buddy guides you to answers — it never hands them over. Your data stays in this browser.',
      }),
    ]),
  );
}

store.load();
store.subscribe(render);
render();
// The clock runs for the life of the page, not the life of the Pomodoro view.
startPomodoroEngine();
// Presence tracking likewise: it must notice you leaving any tab, not just one.
startActivityEngine();
