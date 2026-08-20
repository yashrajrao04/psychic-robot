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
 * Stagger each topic's start so the dense early rungs of one topic do not
 * collide with another's. The first four rungs sit on offsets 0, 1, 3 and 6,
 * so a stride of 4 interleaves consecutive topics cleanly.
 */
const SEED_STRIDE = 4;

/**
 * Find the closest usable day to `desiredDay`.
 *
 * Search order is 0, +1, -1, +2, -2 … so a session lands as near its ideal
 * spacing as possible, preferring to slip *later* rather than earlier on ties
 * (studying a little late beats studying too soon — the interval is the point).
 */
function findFreeDay(desiredDay, { occupied, earliestDay, isDayAllowed, maxDrift }) {
  const candidates = [0];
  for (let step = 1; step <= maxDrift; step += 1) candidates.push(step, -step);

  for (const delta of candidates) {
    const day = desiredDay + delta;
    if (day < earliestDay) continue;
    if (occupied.has(day)) continue;
    if (!isDayAllowed(day)) continue;
    return day;
  }

  // Nothing within the drift window: walk forward until something opens up.
  // The plan grows rather than doubling a topic up on someone else's day.
  let day = Math.max(desiredDay + maxDrift + 1, earliestDay);
  const ceiling = day + 400; // guards against an impossible weekday filter
  while (day < ceiling) {
    if (!occupied.has(day) && isDayAllowed(day)) return day;
    day += 1;
  }
  return null;
}

/**
 * Build a spaced-repetition plan.
 *
 * Each topic climbs the ladder from *its own* start date, so a topic added
 * today begins today rather than being back-dated to when the plan was first
 * created. Topics sharing a start date are staggered so their dense early
 * rungs interleave instead of fighting over the same days.
 *
 * @param {object}   options
 * @param {Array}    options.topics             `{ id, subject, topic, difficulty, startDate? }`, in study order.
 * @param {Date}     [options.startDate]        Origin of the calendar grid.
 * @param {number}   [options.horizonDays]      Target length; the plan may grow past it if needed.
 * @param {number[]} [options.availableWeekdays] 0=Sun … 6=Sat. Days not listed stay empty.
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

  const anchors = active.map((t) => (t.startDate ? startOfDay(t.startDate) : start));

  const allowed = new Set(availableWeekdays);
  const isDayAllowed = (dayIndex) => allowed.has(addDays(start, dayIndex).getDay());

  // 1. Expand every topic into its desired sessions, seeded from its own start.
  //    Topics that begin on the same day are staggered against each other.
  const strideCounter = new Map();
  const wanted = [];

  active.forEach((topic, topicIndex) => {
    const profile = profileFor(topic.difficulty);
    const anchorDay = Math.max(0, daysBetween(start, anchors[topicIndex]));

    const groupKey = anchorDay;
    const position = strideCounter.get(groupKey) || 0;
    strideCounter.set(groupKey, position + 1);
    const seed = anchorDay + position * SEED_STRIDE;

    const ladder = ladderFor(topic.difficulty);
    ladder.forEach((rung) => {
      wanted.push({
        topic,
        topicIndex,
        profile,
        rung,
        repIndex: rung.index,
        repCount: ladder.length,
        earliestPossible: anchorDay,
        desiredDay: seed + rung.offset,
      });
    });
  });

  // 2. Earlier sessions get first pick of the calendar. Ties break towards the
  //    earlier rung, then harder topics, then the user's own ordering.
  wanted.sort(
    (a, b) =>
      a.desiredDay - b.desiredDay ||
      a.repIndex - b.repIndex ||
      a.profile.weight - b.profile.weight ||
      a.topicIndex - b.topicIndex,
  );

  // 3. Place them one at a time, never doubling up on a day.
  const occupied = new Set();
  const lastDayByTopic = new Map();
  const sessions = [];

  for (const want of wanted) {
    const previous = lastDayByTopic.get(want.topic.id);
    const earliestDay =
      previous === undefined ? want.earliestPossible : Math.max(previous + MIN_GAP, want.earliestPossible);
    const desiredDay = Math.max(want.desiredDay, earliestDay);

    const dayIndex = findFreeDay(desiredDay, {
      occupied,
      earliestDay,
      isDayAllowed,
      maxDrift: want.rung.tolerance,
    });
    if (dayIndex === null) continue;

    occupied.add(dayIndex);
    lastDayByTopic.set(want.topic.id, dayIndex);

    const date = addDays(start, dayIndex);
    sessions.push({
      id: `${want.topic.id}:${want.rung.step}`,
      topicId: want.topic.id,
      subject: want.topic.subject,
      topic: want.topic.topic,
      difficulty: want.profile.key,
      repIndex: want.repIndex,
      repCount: want.repCount,
      ladderStep: want.rung.step,
      ladderDay: want.rung.day,
      repLabel: repLabel(want.rung.step),
      dayIndex,
      date,
      iso: toISODate(date),
      drift: dayIndex - want.desiredDay,
      tasks: buildTasks({
        subject: want.topic.subject,
        topic: want.topic.topic,
        difficulty: want.profile.key,
        repIndex: want.repIndex,
        repCount: want.repCount,
        ladderStep: want.rung.step,
      }),
    });
  }

  sessions.sort((a, b) => a.dayIndex - b.dayIndex);

  // 4. Lay the sessions onto a continuous run of days for calendar rendering.
  const lastDay = sessions.length ? sessions[sessions.length - 1].dayIndex : horizonDays - 1;
  const totalDays = Math.max(horizonDays, lastDay + 1);
  const paddedDays = Math.ceil(totalDays / 7) * 7; // always whole weeks

  const byDay = new Map(sessions.map((s) => [s.dayIndex, s]));
  const days = [];
  for (let i = 0; i < paddedDays; i += 1) {
    const date = addDays(start, i);
    days.push({
      dayIndex: i,
      date,
      iso: toISODate(date),
      week: Math.floor(i / 7),
      weekday: date.getDay(),
      session: byDay.get(i) || null,
      available: isDayAllowed(i),
    });
  }

  return {
    days,
    sessions,
    weeks: paddedDays / 7,
    horizonDays: paddedDays,
    overflowDays: Math.max(0, lastDay + 1 - horizonDays),
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

/** The session scheduled for a given date, or null. */
export function sessionOn(plan, date) {
  const iso = toISODate(date);
  return plan.sessions.find((s) => s.iso === iso) || null;
}

/** Sessions falling in the next `count` days, starting today (inclusive). */
export function upcomingSessions(plan, from = new Date(), count = 7) {
  const startIndex = daysBetween(plan.startDate, from);
  return plan.sessions.filter(
    (s) => s.dayIndex >= startIndex && s.dayIndex < startIndex + count,
  );
}
