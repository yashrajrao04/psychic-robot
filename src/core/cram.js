/**
 * Test / Quiz Cram Mode.
 *
 * Compresses spaced repetition into whatever time is left before a test.
 * Hard topics are seen earliest and revisited closest to the test. A day may
 * carry several topics — with a fixed deadline, covering the material matters
 * more than a tidy calendar — but a single topic never repeats twice in one
 * day, because re-reading something an hour later is not spacing.
 *
 * When there is less than a day left the planner falls back to a timeline of
 * study blocks running up to the test time.
 */

import { addDays, daysBetween, startOfDay, toISODate } from './dates.js';
import { buildCramTasks } from './tasks.js';
import { profileFor } from './scheduler.js';

/** How many passes each difficulty deserves when time allows. */
const TARGET_REPS = { hard: 3, medium: 2, easy: 1 };

/** Hard first — those need the most exposure and the earliest start. */
function byDifficulty(a, b) {
  return profileFor(a.difficulty).weight - profileFor(b.difficulty).weight;
}

/**
 * Order every wanted session by priority: first passes before any review, and
 * within a wave, harder topics first.
 */
function buildWaves(topics) {
  const ordered = topics.map((t, i) => ({ ...t, _order: i }));
  const sorted = [...ordered].sort((a, b) => byDifficulty(a, b) || a._order - b._order);

  const maxReps = Math.max(...sorted.map((t) => TARGET_REPS[t.difficulty] ?? 2), 1);
  const waves = [];
  for (let rep = 0; rep < maxReps; rep += 1) {
    for (const topic of sorted) {
      const target = TARGET_REPS[topic.difficulty] ?? 2;
      if (rep < target) waves.push({ topic, repIndex: rep });
    }
  }
  return waves;
}

/**
 * Plan a cram schedule.
 *
 * @param {object} options
 * @param {Array}  options.topics    `{ id, subject, topic, difficulty }`
 * @param {Date}   options.testDate  Exact date+time of the test.
 * @param {Date}   [options.now]     Treated as "right now".
 */
export function planCram({ topics = [], testDate, now = new Date() } = {}) {
  const active = topics.filter((t) => t && t.topic);
  if (!testDate) {
    return { ok: false, error: 'Set the date and time of your test first.' };
  }

  const today = startOfDay(now);
  const testDay = startOfDay(testDate);
  const daysToTest = daysBetween(today, testDay);

  if (daysToTest < 0 || testDate <= now) {
    return { ok: false, error: 'That test time is already in the past.' };
  }
  if (!active.length) {
    return { ok: false, error: 'Add at least one topic to cram.' };
  }

  // With the test today, day-granularity planning is meaningless — what is
  // left is hours, so lay out blocks instead.
  if (daysToTest === 0) {
    return planCramBlocks({ topics: active, testDate, now });
  }

  // Usable study days: today through the test day. The test day itself only
  // counts if the test starts late enough to leave a morning session.
  const testStartsAfterMorning = testDate.getHours() >= 10;
  const lastDayIndex = testStartsAfterMorning ? daysToTest : daysToTest - 1;
  const slots = [];
  for (let i = 0; i <= lastDayIndex; i += 1) slots.push(i);

  if (slots.length === 0) {
    return planCramBlocks({ topics: active, testDate, now });
  }

  const waves = buildWaves(active);
  const capacity = slots.length;

  // Days may now carry several topics, so no pass is ever dropped for lack of
  // room. Passes are spread across the runway: first passes at the front,
  // final reviews landing on the last day before the test.
  const lastDayByTopic = new Map();
  const sessions = [];

  waves.forEach((want, i) => {
    const span = waves.length > 1 ? Math.round((i * (capacity - 1)) / (waves.length - 1)) : 0;
    const desired = slots[Math.min(capacity - 1, span)];

    // A topic still never repeats twice in one day — re-reading something an
    // hour after you read it is not spacing, it is re-reading.
    const previous = lastDayByTopic.get(want.topic.id);
    const day = previous === undefined ? desired : Math.min(lastDayIndex, Math.max(desired, previous + 1));

    lastDayByTopic.set(want.topic.id, day);

    const date = addDays(today, day);
    const totalForTopic = waves.filter((w) => w.topic.id === want.topic.id).length;
    sessions.push({
      id: `${want.topic.id}:cram${want.repIndex}`,
      topicId: want.topic.id,
      subject: want.topic.subject,
      topic: want.topic.topic,
      difficulty: want.topic.difficulty,
      repIndex: want.repIndex,
      repCount: totalForTopic,
      repLabel: `Cram pass ${want.repIndex + 1}`,
      dayIndex: day,
      date,
      iso: toISODate(date),
      isTestDay: day === daysToTest,
      tasks: buildCramTasks({
        topic: want.topic.topic,
        repIndex: want.repIndex,
        isFinalPass: day === lastDayIndex,
      }),
    });
  });

  // Drop any pass that could not keep a day's separation from its predecessor
  // (only possible when the runway is shorter than the number of passes).
  const deduped = [];
  const seen = new Set();
  for (const session of sessions) {
    const key = `${session.topicId}:${session.dayIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(session);
  }
  const dropped = sessions.length - deduped.length;
  sessions.length = 0;
  sessions.push(...deduped);

  sessions.sort(
    (a, b) => a.dayIndex - b.dayIndex || byDifficulty(a, b),
  );

  const byDay = new Map();
  for (const session of sessions) {
    if (!byDay.has(session.dayIndex)) byDay.set(session.dayIndex, []);
    byDay.get(session.dayIndex).push(session);
  }

  const days = slots.map((i) => {
    const date = addDays(today, i);
    const daySessions = byDay.get(i) || [];
    return {
      dayIndex: i,
      date,
      iso: toISODate(date),
      week: Math.floor(i / 7),
      weekday: date.getDay(),
      sessions: daySessions,
      load: daySessions.reduce((sum, s) => sum + s.tasks.reduce((n, t) => n + (t.minutes || 0), 0), 0),
      available: true,
      isTestDay: i === daysToTest,
    };
  });

  const coveredIds = new Set(sessions.map((s) => s.topicId));
  const uncovered = active.filter((t) => !coveredIds.has(t.id));

  return {
    ok: true,
    mode: 'days',
    startDate: today,
    testDate,
    daysAvailable: slots.length,
    sessions,
    days,
    weeks: Math.max(1, Math.ceil(slots.length / 7)),
    droppedPasses: dropped,
    busiestDay: days.reduce((max, d) => Math.max(max, d.sessions.length), 0),
    uncovered,
  };
}

/**
 * Less than a day left: lay out study blocks between now and the test.
 * Still one topic per block, hard topics first, with a buffer before the test.
 */
function planCramBlocks({ topics, testDate, now }) {
  const BLOCK_MINUTES = 40;
  const BREAK_MINUTES = 5;
  const BUFFER_MINUTES = 30; // stop studying before you have to travel/settle

  const stopAt = new Date(testDate.getTime() - BUFFER_MINUTES * 60 * 1000);
  const minutesLeft = Math.floor((stopAt - now) / 60000);

  if (minutesLeft < 15) {
    return {
      ok: true,
      mode: 'blocks',
      testDate,
      blocks: [],
      message:
        'There is no useful study time left before this test. Skim your own summary sheet, ' +
        'breathe, and go in. Cramming in the last minutes costs more in nerves than it returns in marks.',
    };
  }

  const sorted = [...topics].sort(byDifficulty);
  const slotCount = Math.max(1, Math.floor(minutesLeft / (BLOCK_MINUTES + BREAK_MINUTES)));

  const blocks = [];
  let cursor = new Date(now.getTime());
  for (let i = 0; i < slotCount; i += 1) {
    const topic = sorted[i % sorted.length];
    const start = new Date(cursor.getTime());
    const end = new Date(start.getTime() + BLOCK_MINUTES * 60 * 1000);
    if (end > stopAt) break;
    blocks.push({
      id: `${topic.id}:block${i}`,
      topicId: topic.id,
      subject: topic.subject,
      topic: topic.topic,
      difficulty: topic.difficulty,
      start,
      end,
      repIndex: Math.floor(i / sorted.length),
      tasks: buildCramTasks({
        topic: topic.topic,
        repIndex: Math.floor(i / sorted.length),
        isFinalPass: i === slotCount - 1,
      }),
    });
    cursor = new Date(end.getTime() + BREAK_MINUTES * 60 * 1000);
  }

  const covered = new Set(blocks.map((b) => b.topicId));
  return {
    ok: true,
    mode: 'blocks',
    testDate,
    blocks,
    minutesLeft,
    uncovered: topics.filter((t) => !covered.has(t.id)),
    message:
      `Under a day to go — here is a ${BLOCK_MINUTES}-minute block timeline. ` +
      'Hardest topics are first, while you are freshest.',
  };
}
