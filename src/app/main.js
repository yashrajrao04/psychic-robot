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

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'plan', label: 'Plan' },
  { key: 'subjects', label: 'Subjects & topics' },
  { key: 'cram', label: 'Cram mode' },
  { key: 'buddy', label: 'Study Buddy' },
  { key: 'testing', label: 'Testing' },
  { key: 'export', label: 'Sync & export' },
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

function header(activeTab) {
  return el('header', { class: 'app-header' }, [
    el('div', { class: 'brand' }, [
      el('span', { class: 'logo', text: '◱' }),
      el('div', {}, [
        el('h1', { text: 'Study Buddy' }),
        el('p', { class: 'tagline', text: 'Spaced repetition, one topic a day.' }),
      ]),
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
