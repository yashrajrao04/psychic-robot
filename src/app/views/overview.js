/** Daily overview / dashboard: today's topic, today's checklist, what's coming. */

import { el, section, empty } from '../dom.js';
import * as store from '../store.js';
import { sessionCard, progressBar } from './plan.js';
import { sessionOn, upcomingSessions } from '../../core/scheduler.js';
import { formatLong, formatShort, daysBetween } from '../../core/dates.js';

const REFLECTION_PROMPTS = [
  'What did you find hardest today, and what made it hard?',
  'What could you explain today that you could not yesterday?',
  'Which part of today would you fail to recall in a week? Book it in.',
  'Did you check your answers, or just feel like you knew them?',
  'What is the one idea from today worth writing on a cheat sheet?',
];

function stat(label, value, hint) {
  return el('div', { class: 'stat' }, [
    el('p', { class: 'stat-value', text: String(value) }),
    el('p', { class: 'stat-label', text: label }),
    hint ? el('p', { class: 'muted small', text: hint }) : null,
  ]);
}

/** Overall completion across every session that has come due so far. */
function computeStats(plan) {
  const today = new Date();
  const todayIndex = daysBetween(plan.startDate, today);

  const due = plan.sessions.filter((s) => s.dayIndex <= todayIndex);
  const dueTasks = due.reduce((sum, s) => sum + s.tasks.length, 0);
  const doneTasks = due.reduce((sum, s) => sum + s.tasks.filter((t) => store.isTaskDone(s.id, t.id)).length, 0);

  // A streak of consecutive completed study days ending today.
  let streak = 0;
  for (let i = todayIndex; i >= 0; i -= 1) {
    const session = plan.sessions.find((s) => s.dayIndex === i);
    if (!session) continue;
    if (store.sessionProgress(session) === 100) streak += 1;
    else break;
  }

  return {
    todayIndex,
    completion: dueTasks ? Math.round((doneTasks / dueTasks) * 100) : 0,
    dueTasks,
    doneTasks,
    streak,
    remaining: plan.sessions.filter((s) => s.dayIndex > todayIndex).length,
  };
}

export function renderOverview(plan, { goToTab } = {}) {
  const today = new Date();
  const todaySession = sessionOn(plan, today);
  const stats = computeStats(plan);
  const upcoming = upcomingSessions(plan, today, 8).filter((s) => s.dayIndex !== stats.todayIndex);

  if (!plan.sessions.length) {
    return el('div', { class: 'view' }, [
      section('Today', formatLong(today), [
        empty(
          'Nothing planned yet. Add your subjects and topics and the spaced-repetition calendar builds itself — ' +
            'one topic per day, each topic revisited two or three times.',
          'Add subjects & topics',
          () => goToTab?.('subjects'),
        ),
        el('p', { class: 'muted small centered' }, [
          'Or ',
          el('button', { class: 'link-btn', text: 'load an example plan', onClick: () => store.loadSample() }),
          ' to see how it works.',
        ]),
      ]),
    ]);
  }

  const promptIndex = stats.todayIndex % REFLECTION_PROMPTS.length;

  return el('div', { class: 'view' }, [
    el('div', { class: 'panel' }, [
      el('header', { class: 'panel-head' }, [
        el('h2', { text: 'Today' }),
        el('p', { class: 'muted', text: formatLong(today) }),
      ]),
      el('div', { class: 'panel-body' }, [
        el('div', { class: 'stat-row' }, [
          stat('Overall completion', `${stats.completion}%`, `${stats.doneTasks} of ${stats.dueTasks} tasks due so far`),
          stat('Day streak', stats.streak, stats.streak ? 'Consecutive fully-finished study days' : 'Finish today to start one'),
          stat('Sessions left', stats.remaining, 'Still ahead in this plan'),
        ]),

        todaySession
          ? el('div', { class: 'today-block' }, [sessionCard(todaySession, { showDate: false, open: true })])
          : el('div', { class: 'rest-day' }, [
              el('h3', { text: 'No topic scheduled today' }),
              el('p', {
                class: 'muted',
                text:
                  'This is deliberate — spacing needs gaps. If you have energy spare, do a short recall pass on the ' +
                  'topic you found hardest this week rather than starting something new.',
              }),
            ]),

        el('div', { class: 'reflect' }, [
          el('h4', { text: 'Reflection prompt' }),
          el('p', { text: REFLECTION_PROMPTS[promptIndex] }),
        ]),
      ]),
    ]),

    section('Coming up this week', 'Your next spaced-repetition sessions.', [
      upcoming.length
        ? el(
            'ul',
            { class: 'upcoming' },
            upcoming.map((s) =>
              el('li', { class: `upcoming-item diff-${s.difficulty}` }, [
                el('span', { class: 'upcoming-date', text: formatShort(s.date) }),
                el('span', { class: 'upcoming-topic' }, [
                  el('strong', { text: s.subject }),
                  ` — ${s.topic}`,
                ]),
                el('span', { class: `pill pill-${s.difficulty}`, text: s.repLabel }),
                el('span', { class: 'upcoming-progress' }, [progressBar(store.sessionProgress(s))]),
              ]),
            ),
          )
        : el('p', { class: 'muted', text: 'Nothing in the next week. Add topics or extend the plan length.' }),
    ]),

    section('Suggested extras', 'For when you have time left over.', [
      el('ul', { class: 'bullets' }, [
        el('li', {
          text: todaySession
            ? `Short review: five minutes of blank-page recall on ${todaySession.topic} before bed locks in far more than another hour now.`
            : 'Short review: pick the topic with the lowest completion and do five minutes of recall on it.',
        }),
        el('li', {}, [
          'Weak on something? ',
          el('button', { class: 'link-btn', text: 'Open Study Buddy', onClick: () => goToTab?.('buddy') }),
          ' to compare your notes against a full structure and schedule a Learn Mode pass.',
        ]),
        el('li', {}, [
          'Want to be tested? ',
          el('button', { class: 'link-btn', text: 'Start Testing Mode', onClick: () => goToTab?.('testing') }),
          ' — questions come from your own notes, and difficulty adapts as you go.',
        ]),
      ]),
    ]),
  ]);
}
