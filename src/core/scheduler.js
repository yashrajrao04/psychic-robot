/**
 * Spaced-repetition scheduler.
 *
 * Hard rules enforced here (they come straight from the product brief):
 *   - Exactly ONE topic per day. Never two.
 *   - Every topic is repeated 2–3 times across the plan.
 *   - Hard topics land on day 1, day 3–4, and roughly two weeks later.
 *
 * The module is pure: no DOM, no storage, no clock reads beyond the `startDate`
 * you hand it. That keeps it directly unit-testable.
 */

import { addDays, daysBetween, startOfDay, toISODate } from './dates.js';
import { buildTasks } from './tasks.js';

/**
 * Repetition profiles, expressed as *day offsets* from the topic's first
 * session (offset 0 === "Day 1" in the brief's wording).
 *
 *   hard   -> Day 1, Day 3, Day 15   (the "day 3 or 4" slot has ±2 tolerance)
 *   medium -> Day 1, Day 5, Day 16
 *   easy   -> Day 1, Day 8
 */
export const DIFFICULTY_PROFILES = {
  hard: { key: 'hard', label: 'Hard', offsets: [0, 2, 14], tolerance: 2, minGap: 2, weight: 0 },
  medium: { key: 'medium', label: 'Medium', offsets: [0, 4, 15], tolerance: 3, minGap: 3, weight: 1 },
  easy: { key: 'easy', label: 'Easy', offsets: [0, 7], tolerance: 4, minGap: 4, weight: 2 },
};

export const DEFAULT_DIFFICULTY = 'medium';

export function profileFor(difficulty) {
  return DIFFICULTY_PROFILES[difficulty] || DIFFICULTY_PROFILES[DEFAULT_DIFFICULTY];
}

/** Labels for each pass over a topic, used in the UI and in exports. */
export const REP_LABELS = ['Learn', 'Recall', 'Consolidate'];

export function repLabel(repIndex) {
  return REP_LABELS[repIndex] || `Review ${repIndex + 1}`;
}

/**
 * Spread the first sessions of each topic across the front of the plan so that
 * later repetitions have empty days to land on. Packing every topic's first
 * pass into consecutive days would shove all the reviews to the very end.
 */
function seedStride(topicCount, horizonDays) {
  if (topicCount <= 1) return 1;
  const spread = Math.max(1, Math.round((horizonDays * 0.45) / (topicCount - 1)));
  return Math.min(3, spread);
}

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
 * @param {object}   options
 * @param {Array}    options.topics             `{ id, subject, topic, difficulty }`, in study order.
 * @param {Date}     [options.startDate]        First day of the plan.
 * @param {number}   [options.horizonDays]      Target length; the plan may grow past it if needed.
 * @param {number[]} [options.availableWeekdays] 0=Sun … 6=Sat. Days not listed stay empty.
 * @returns {{days: Array, sessions: Array, weeks: number, horizonDays: number, overflowDays: number}}
 */
export function planSchedule({
  topics = [],
  startDate = new Date(),
  horizonDays = 28,
  availableWeekdays = [0, 1, 2, 3, 4, 5, 6],
} = {}) {
  const start = startOfDay(startDate);
  const allowed = new Set(availableWeekdays);
  const isDayAllowed = (dayIndex) => allowed.has(addDays(start, dayIndex).getDay());

  const active = topics.filter((t) => t && t.topic);
  const stride = seedStride(active.length, horizonDays);

  // 1. Expand every topic into its desired sessions.
  const wanted = [];
  active.forEach((topic, topicIndex) => {
    const profile = profileFor(topic.difficulty);
    const seed = topicIndex * stride;
    profile.offsets.forEach((offset, repIndex) => {
      wanted.push({
        topic,
        topicIndex,
        profile,
        repIndex,
        repCount: profile.offsets.length,
        desiredDay: seed + offset,
      });
    });
  });

  // 2. Earlier sessions get first pick of the calendar. Ties break towards the
  //    earlier repetition, then harder topics, then the user's own ordering.
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
    const earliestDay = previous === undefined ? 0 : previous + want.profile.minGap;
    const desiredDay = Math.max(want.desiredDay, earliestDay);

    const dayIndex = findFreeDay(desiredDay, {
      occupied,
      earliestDay,
      isDayAllowed,
      maxDrift: want.profile.tolerance,
    });
    if (dayIndex === null) continue;

    occupied.add(dayIndex);
    lastDayByTopic.set(want.topic.id, dayIndex);

    const date = addDays(start, dayIndex);
    sessions.push({
      id: `${want.topic.id}:${want.repIndex}`,
      topicId: want.topic.id,
      subject: want.topic.subject,
      topic: want.topic.topic,
      difficulty: want.profile.key,
      repIndex: want.repIndex,
      repCount: want.repCount,
      repLabel: repLabel(want.repIndex),
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
