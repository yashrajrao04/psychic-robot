/**
 * Tailored practice.
 *
 * The Testing tab is manual: you pick a topic and a difficulty. This is the
 * opposite — it chooses what to test and how hard, and it ratchets.
 *
 * "Harder every time" is held by a per-topic level that persists between
 * sessions, so returning tomorrow resumes above where you finished rather than
 * starting from easy again. The level climbs on clean answers and slips only
 * slightly on misses, and never below a floor set by your best run: a bad day
 * should cost you a rung, not everything you have built.
 */

import { DIFFICULTY_LEVELS } from './testing.js';

/** Eight rungs of question difficulty, mapped onto the three question banks. */
export const MAX_LEVEL = 7;

const LEVEL_BANDS = [
  { level: 0, band: 'easy', label: 'Recall' },
  { level: 1, band: 'easy', label: 'Recall +' },
  { level: 2, band: 'medium', label: 'Explain' },
  { level: 3, band: 'medium', label: 'Explain +' },
  { level: 4, band: 'medium', label: 'Apply' },
  { level: 5, band: 'hard', label: 'Transfer' },
  { level: 6, band: 'hard', label: 'Transfer +' },
  { level: 7, band: 'hard', label: 'Mastery' },
];

export function clampLevel(level) {
  return Math.max(0, Math.min(MAX_LEVEL, Math.round(Number(level) || 0)));
}

export function bandFor(level) {
  return LEVEL_BANDS[clampLevel(level)];
}

export function levelLabel(level) {
  return `L${clampLevel(level)} · ${bandFor(level).label}`;
}

/** A topic's practice record. */
export function createRecord() {
  return { level: 0, best: 0, attempts: 0, strong: 0, lastPractisedAt: null };
}

export function recordFor(records, topicId) {
  return records[topicId] || createRecord();
}

/**
 * Apply one graded answer.
 *
 * Up a rung on a strong answer, hold on a partial, down one on a miss — but
 * never below `best - 1`. Without that floor a single bad session would undo
 * weeks, and the point of the ratchet is that progress sticks.
 */
export function applyResult(record, quality, { now = Date.now() } = {}) {
  const next = { ...record, attempts: record.attempts + 1, lastPractisedAt: now };

  if (quality === 'strong') {
    next.level = clampLevel(record.level + 1);
    next.strong = record.strong + 1;
    next.best = Math.max(record.best, next.level);
  } else if (quality === 'off') {
    const floor = Math.max(0, record.best - 1);
    next.level = Math.max(floor, clampLevel(record.level - 1));
  }
  return next;
}

/**
 * Where a new session starts for a topic.
 *
 * Opens one rung below the current level — a warm-up that confirms the ground
 * is still solid — but never below the floor, and climbs from there.
 */
export function openingLevel(record) {
  return Math.max(Math.max(0, record.best - 1), clampLevel(record.level - 1));
}

/**
 * Choose what to practise next, without asking.
 *
 * Priority: topics due today, then the ones gone longest without practice,
 * then the weakest. Each topic also gets a cooldown so one session does not
 * hammer the same thing when others are waiting.
 */
export function selectTopic({ topics = [], dueTopicIds = [], records = {}, exclude = [], now = Date.now() } = {}) {
  const candidates = topics.filter((t) => !exclude.includes(t.id));
  if (!candidates.length) return null;

  const scored = candidates.map((topic) => {
    const record = recordFor(records, topic.id);
    const hoursSince = record.lastPractisedAt ? (now - record.lastPractisedAt) / 3600000 : 999;

    let score = 0;
    if (dueTopicIds.includes(topic.id)) score += 100; // scheduled today
    if (!record.attempts) score += 60; // never touched
    score += Math.min(50, hoursSince); // staleness
    score += (MAX_LEVEL - record.level) * 4; // weakest first
    if (topic.difficulty === 'hard') score += 8;

    return { topic, record, score };
  });

  scored.sort((a, b) => b.score - a.score || a.topic.topic.localeCompare(b.topic.topic));
  return scored[0];
}

/**
 * Build the shape of a session: which topic, and the rung for each question.
 *
 * Difficulty rises through the session regardless of answers — the adaptive
 * response to a wrong answer is a hint and a re-ask, not an easier set.
 */
export function planSession({ topic, record, questionCount = 5 }) {
  const start = openingLevel(record);
  const steps = [];
  for (let i = 0; i < questionCount; i += 1) {
    steps.push(clampLevel(start + i));
  }
  return {
    topicId: topic.id,
    topic: topic.topic,
    subject: topic.subject,
    startLevel: start,
    steps,
    bands: steps.map((level) => bandFor(level).band),
  };
}

/** Difficulty band for a session step, as `generateQuestions` wants it. */
export function bandAt(session, index) {
  const band = session.bands[Math.min(index, session.bands.length - 1)];
  return DIFFICULTY_LEVELS.includes(band) ? band : 'medium';
}

/** A short verdict on a finished session. */
export function summarise({ before, after, answered, strong }) {
  const moved = after.level - before.level;
  if (!answered) {
    return { headline: 'Nothing attempted', note: 'Come back and answer at least one — a guess tells you more than a skip.' };
  }
  if (moved > 0) {
    return {
      headline: `Level up — now ${levelLabel(after.level)}`,
      note: `${strong} of ${answered} answered cleanly. Next session opens harder than this one did.`,
    };
  }
  if (moved < 0) {
    return {
      headline: `Dropped to ${levelLabel(after.level)}`,
      note: 'That is the system working, not you failing. The next set rebuilds from the rung below, and your floor holds.',
    };
  }
  return {
    headline: `Holding at ${levelLabel(after.level)}`,
    note: `${strong} of ${answered} clean. One more clean answer moves you up.`,
  };
}

/** Overall progress, for the dashboard. */
export function overallProgress(records, topics = []) {
  const tracked = topics.filter((t) => records[t.id]);
  if (!tracked.length) return { practised: 0, averageLevel: 0, mastered: 0 };

  const total = tracked.reduce((sum, t) => sum + recordFor(records, t.id).level, 0);
  return {
    practised: tracked.length,
    averageLevel: Math.round((total / tracked.length) * 10) / 10,
    mastered: tracked.filter((t) => recordFor(records, t.id).level >= MAX_LEVEL).length,
  };
}
