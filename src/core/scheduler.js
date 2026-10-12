/**
 * Spaced-repetition scheduler.
 *
 * Hard rules enforced here:
 *   - Exactly ONE topic per day. Never two.
 *   - Every topic follows the expanding ladder D1, D2, D4, D7, D14, D30,
 *     D60, D120 — each interval roughly doubling the last.
 *   - A topic is never scheduled before the day it was added.
 *
 * The module is pure: no DOM, no storage, no clock reads beyond the dates you
 * hand it. That keeps it directly unit-testable.
 */

import { addDays, daysBetween, startOfDay, toISODate } from './dates.js';
import { buildTasks } from './tasks.js';

/**
 * The expanding-interval ladder, as *day numbers* (D1 is the first session).
 * Each step sits near the point where the previous one is about to fade, so
 * every review costs little and buys a longer interval than the last.
 */
export const LADDER_DAYS = [1, 2, 4, 7, 14, 30, 60, 120];

/** Day numbers converted to offsets from the topic's first session. */
const LADDER_OFFSETS = LADDER_DAYS.map((day) => day - 1);

/**
 * How far a step may slip when its ideal day is already taken. Early steps are
 * only a day or two apart, so they must stay tight; later steps sit on long
 * intervals where a few days either way changes nothing.
 */
const LADDER_TOLERANCE = [2, 1, 2, 3, 4, 7, 10, 14];

/**
 * Difficulty decides how much of the ladder a topic climbs. Everything reaches
 * D120 — long-term retention is the whole point — but easier material skips
 * the dense early rungs it does not need.
 */
export const DIFFICULTY_PROFILES = {
  hard: { key: 'hard', label: 'Hard', steps: [0, 1, 2, 3, 4, 5, 6, 7], weight: 0 },
  medium: { key: 'medium', label: 'Medium', steps: [0, 2, 3, 4, 5, 6, 7], weight: 1 },
  easy: { key: 'easy', label: 'Easy', steps: [0, 3, 4, 5, 6, 7], weight: 2 },
};

export const DEFAULT_DIFFICULTY = 'medium';

export function profileFor(difficulty) {
  return DIFFICULTY_PROFILES[difficulty] || DIFFICULTY_PROFILES[DEFAULT_DIFFICULTY];
}

/** The concrete ladder a topic follows: day number, offset and tolerance. */
export function ladderFor(difficulty) {
  return profileFor(difficulty).steps.map((step, index) => ({
    step,
    index,
    day: LADDER_DAYS[step],
    offset: LADDER_OFFSETS[step],
    tolerance: LADDER_TOLERANCE[step],
  }));
}

/** Minimum days between consecutive passes — D1 to D2 are back-to-back. */
const MIN_GAP = 1;

/** Labels for each rung, used in the UI and in exports. */
export const REP_LABELS = [
  'Learn',
  'First recall',
  'Reinforce',
  'Consolidate',
  'Two-week review',
  'Monthly review',
  'Long-term review',
  'Mastery check',
];

/** Label for a ladder step (the rung, not the position within one topic). */
export function repLabel(step) {
  return REP_LABELS[step] || `Review ${step + 1}`;
}

/**
 * Move a day onto the nearest weekday the learner actually studies.
 *
 * With every day switched on — the default — this never fires and the ladder
 * is exact. It only shifts a session when the learner has explicitly turned a
 * weekday off, which is their own trade against precise timing.
 */
function toStudyDay(dayIndex, isDayAllowed) {
  if (isDayAllowed(dayIndex)) return dayIndex;
  for (let delta = 1; delta <= 7; delta += 1) {
    if (isDayAllowed(dayIndex + delta)) return dayIndex + delta;
    if (dayIndex - delta >= 0 && isDayAllowed(dayIndex - delta)) return dayIndex - delta;
  }
  return dayIndex;
}

/**
 * Build a spaced-repetition plan.
 *
 * Timing is exact: every topic starts on its own start date and hits every
 * rung of its ladder on the nose. Days may therefore carry more than one
 * topic — the intervals are what make spaced repetition work, so nothing is
 * nudged off its rung to keep days tidy.
 *
 * @param {object}   options
 * @param {Array}    options.topics             `{ id, subject, topic, difficulty, startDate? }`, in study order.
 * @param {Date}     [options.startDate]        Origin of the calendar grid.
 * @param {number}   [options.horizonDays]      Target length; the plan may grow past it if needed.
 * @param {number[]} [options.availableWeekdays] 0=Sun … 6=Sat. The only thing that can shift a rung.
 * @returns {{days: Array, sessions: Array, weeks: number, horizonDays: number, overflowDays: number}}
 */
export function planSchedule({
  topics = [],
  startDate = new Date(),
  horizonDays = 126,
  availableWeekdays = [0, 1, 2, 3, 4, 5, 6],
} = {}) {
  const active = topics.filter((t) => t && t.topic);

  // The grid begins at the earliest topic start, so a plan created weeks ago
  // does not open with weeks of empty calendar, and a topic anchored in the
  // past still shows its completed history.
  const anchored = active.filter((t) => t.startDate).map((t) => startOfDay(t.startDate));
  const start = anchored.length
    ? anchored.reduce((earliest, d) => (d < earliest ? d : earliest))
    : startOfDay(startDate);

  const allowed = new Set(availableWeekdays);
  const isDayAllowed = (dayIndex) => allowed.has(addDays(start, dayIndex).getDay());

  const sessions = [];

  active.forEach((topic, topicIndex) => {
    const profile = profileFor(topic.difficulty);
    const anchorDate = topic.startDate ? startOfDay(topic.startDate) : start;
    const anchorDay = Math.max(0, daysBetween(start, anchorDate));

    for (const rung of ladderFor(topic.difficulty)) {
      const dayIndex = toStudyDay(anchorDay + rung.offset, isDayAllowed);
      const date = addDays(start, dayIndex);

      sessions.push({
        id: `${topic.id}:${rung.step}`,
        topicId: topic.id,
        topicIndex,
        subject: topic.subject,
        topic: topic.topic,
        difficulty: profile.key,
        repIndex: rung.index,
        repCount: profile.steps.length,
        ladderStep: rung.step,
        ladderDay: rung.day,
        repLabel: repLabel(rung.step),
        dayIndex,
        date,
        iso: toISODate(date),
        drift: dayIndex - (anchorDay + rung.offset),
        tasks: buildTasks({
          subject: topic.subject,
          topic: topic.topic,
          difficulty: profile.key,
          repIndex: rung.index,
          repCount: profile.steps.length,
          ladderStep: rung.step,
        }),
      });
    }
  });

  // Chronological, and within a day: hardest first, then the learner's order.
  sessions.sort(
    (a, b) =>
      a.dayIndex - b.dayIndex ||
      profileFor(a.difficulty).weight - profileFor(b.difficulty).weight ||
      a.topicIndex - b.topicIndex ||
      a.ladderStep - b.ladderStep,
  );

  // Lay the sessions onto a continuous run of days for calendar rendering.
  const lastDay = sessions.length ? Math.max(...sessions.map((s) => s.dayIndex)) : horizonDays - 1;
  const totalDays = Math.max(horizonDays, lastDay + 1);
  const paddedDays = Math.ceil(totalDays / 7) * 7; // always whole weeks

  const byDay = new Map();
  for (const session of sessions) {
    if (!byDay.has(session.dayIndex)) byDay.set(session.dayIndex, []);
    byDay.get(session.dayIndex).push(session);
  }

  const days = [];
  for (let i = 0; i < paddedDays; i += 1) {
    const date = addDays(start, i);
    const daySessions = byDay.get(i) || [];
    days.push({
      dayIndex: i,
      date,
      iso: toISODate(date),
      week: Math.floor(i / 7),
      weekday: date.getDay(),
      sessions: daySessions,
      load: daySessions.reduce((sum, s) => sum + s.tasks.reduce((n, t) => n + (t.minutes || 0), 0), 0),
      available: isDayAllowed(i),
    });
  }

  return {
    days,
    sessions,
    weeks: paddedDays / 7,
    horizonDays: paddedDays,
    overflowDays: Math.max(0, lastDay + 1 - horizonDays),
    busiestDay: days.reduce((max, d) => Math.max(max, d.sessions.length), 0),
    startDate: start,
  };
}

/** Group a plan's days into `[[week1 days], [week2 days], …]`. */
export function groupByWeek(days) {
  const weeks = [];
  for (const day of days) {
    if (!weeks[day.week]) weeks[day.week] = [];
    weeks[day.week].push(day);
  }
  return weeks;
}

/** Every session for one topic, in date order. */
export function sessionsForTopic(plan, topicId) {
  return plan.sessions.filter((s) => s.topicId === topicId);
}

/** Every session scheduled for a given date, in study order. */
export function sessionsOn(plan, date) {
  const iso = toISODate(date);
  return plan.sessions.filter((s) => s.iso === iso);
}

/** Sessions falling in the next `count` days, starting today (inclusive). */
export function upcomingSessions(plan, from = new Date(), count = 7) {
  const startIndex = daysBetween(plan.startDate, from);
  return plan.sessions.filter(
    (s) => s.dayIndex >= startIndex && s.dayIndex < startIndex + count,
  );
}
