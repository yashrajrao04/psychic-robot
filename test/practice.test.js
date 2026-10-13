import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_LEVEL,
  applyResult,
  bandAt,
  bandFor,
  clampLevel,
  createRecord,
  levelLabel,
  openingLevel,
  overallProgress,
  planSession,
  recordFor,
  selectTopic,
  summarise,
} from '../src/core/practice.js';

const topic = { id: 't1', topic: 'Photosynthesis', subject: 'Biology', difficulty: 'hard' };

test('a clean answer moves you up, a miss costs exactly one rung', () => {
  let r = createRecord();
  assert.equal(r.level, 0);

  r = applyResult(r, 'strong');
  assert.equal(r.level, 1);
  r = applyResult(r, 'strong');
  assert.equal(r.level, 2);

  r = applyResult(r, 'partial');
  assert.equal(r.level, 2, 'a partial answer holds the level');

  r = applyResult(r, 'off');
  assert.equal(r.level, 1, 'a miss costs one rung, not the run');
});

test('progress has a floor, so one bad session cannot undo weeks', () => {
  let r = createRecord();
  for (let i = 0; i < 5; i += 1) r = applyResult(r, 'strong');
  assert.equal(r.level, 5);
  assert.equal(r.best, 5);

  // A thoroughly bad day.
  for (let i = 0; i < 10; i += 1) r = applyResult(r, 'off');
  assert.equal(r.level, 4, 'never falls below best - 1');
  assert.equal(r.best, 5, 'and the high-water mark is remembered');
});

test('levels are clamped to the ladder', () => {
  let r = createRecord();
  for (let i = 0; i < 50; i += 1) r = applyResult(r, 'strong');
  assert.equal(r.level, MAX_LEVEL);
  assert.equal(clampLevel(99), MAX_LEVEL);
  assert.equal(clampLevel(-5), 0);
  assert.equal(clampLevel('nonsense'), 0);
});

test('every rung maps to a real question bank', () => {
  for (let level = 0; level <= MAX_LEVEL; level += 1) {
    const band = bandFor(level);
    assert.ok(['easy', 'medium', 'hard'].includes(band.band), `level ${level} has no band`);
    assert.ok(band.label.length > 2);
    assert.match(levelLabel(level), /^L\d · /);
  }
});

test('a session opens below your level as a warm-up, then climbs', () => {
  let r = createRecord();
  for (let i = 0; i < 4; i += 1) r = applyResult(r, 'strong'); // level 4

  assert.equal(openingLevel(r), 3, 'one rung below, to check the ground is solid');

  const session = planSession({ topic, record: r, questionCount: 5 });
  assert.deepEqual(session.steps, [3, 4, 5, 6, 7], 'and every question after is harder');
  assert.equal(session.steps.length, new Set(session.steps).size, 'no rung repeats');
});

test('difficulty genuinely rises across a session', () => {
  const session = planSession({ topic, record: createRecord(), questionCount: 5 });
  const order = { easy: 0, medium: 1, hard: 2 };
  for (let i = 1; i < session.steps.length; i += 1) {
    assert.ok(session.steps[i] > session.steps[i - 1], 'levels strictly increase');
    assert.ok(order[bandAt(session, i)] >= order[bandAt(session, i - 1)], 'bands never go backwards');
  }
  assert.equal(bandAt(session, 0), 'easy', 'a beginner opens on recall');
  assert.equal(
    bandAt(session, 99),
    session.bands[session.bands.length - 1],
    'past the end clamps to the last rung rather than running off it',
  );

  // A learner already near the top gets a set that ends on the hardest bank.
  let advanced = createRecord();
  for (let i = 0; i < 7; i += 1) advanced = applyResult(advanced, 'strong');
  assert.equal(bandAt(planSession({ topic, record: advanced, questionCount: 5 }), 4), 'hard');
});

test('a later session starts harder than the one before it', () => {
  let r = createRecord();
  const first = planSession({ topic, record: r, questionCount: 5 });

  // Work through it successfully.
  for (let i = 0; i < 5; i += 1) r = applyResult(r, 'strong');
  const second = planSession({ topic, record: r, questionCount: 5 });

  assert.ok(second.startLevel > first.startLevel, `${second.startLevel} should beat ${first.startLevel}`);
});

/* -------------------------------------------------------------- choosing -- */

const topics = [
  { id: 'a', topic: 'Alpha', subject: 'S', difficulty: 'medium' },
  { id: 'b', topic: 'Beta', subject: 'S', difficulty: 'medium' },
  { id: 'c', topic: 'Gamma', subject: 'S', difficulty: 'hard' },
];

test('what is scheduled today is chosen first', () => {
  const now = Date.now();
  const records = {
    a: { ...createRecord(), attempts: 5, lastPractisedAt: now },
    b: { ...createRecord(), attempts: 5, lastPractisedAt: now },
    c: { ...createRecord(), attempts: 5, lastPractisedAt: now },
  };
  const pick = selectTopic({ topics, dueTopicIds: ['b'], records, now });
  assert.equal(pick.topic.id, 'b');
});

test('a topic never practised outranks one just done', () => {
  const now = Date.now();
  const records = { a: { ...createRecord(), attempts: 9, level: 3, lastPractisedAt: now } };
  const pick = selectTopic({ topics: topics.slice(0, 2), dueTopicIds: [], records, now });
  assert.equal(pick.topic.id, 'b', 'the untouched one comes first');
});

test('exclusions are respected and an empty list returns nothing', () => {
  const pick = selectTopic({ topics, dueTopicIds: [], records: {}, exclude: ['a', 'b'] });
  assert.equal(pick.topic.id, 'c');
  assert.equal(selectTopic({ topics: [], dueTopicIds: [], records: {} }), null);
  assert.equal(selectTopic({ topics, exclude: ['a', 'b', 'c'] }), null);
});

test('selection is deterministic for the same inputs', () => {
  const now = Date.now();
  const a = selectTopic({ topics, dueTopicIds: [], records: {}, now });
  const b = selectTopic({ topics, dueTopicIds: [], records: {}, now });
  assert.equal(a.topic.id, b.topic.id);
});

/* --------------------------------------------------------------- summary -- */

test('the summary reports the direction of travel', () => {
  const before = { ...createRecord(), level: 2 };
  assert.match(summarise({ before, after: { level: 3 }, answered: 5, strong: 4 }).headline, /Level up/);
  assert.match(summarise({ before, after: { level: 1 }, answered: 5, strong: 0 }).headline, /Dropped/);
  assert.match(summarise({ before, after: { level: 2 }, answered: 5, strong: 2 }).headline, /Holding/);
  assert.match(summarise({ before, after: { level: 2 }, answered: 0, strong: 0 }).headline, /Nothing attempted/);
});

test('a drop is framed as the system working, not as failure', () => {
  const note = summarise({ before: { level: 3 }, after: { level: 2 }, answered: 5, strong: 1 }).note;
  assert.match(note, /system working/i);
  assert.ok(!/fail(ed|ure)\b(?! )/i.test(note.replace('not you failing', '')), 'no bare blame');
});

test('overall progress ignores topics never practised', () => {
  const records = { a: { ...createRecord(), level: 4 }, c: { ...createRecord(), level: MAX_LEVEL } };
  const progress = overallProgress(records, topics);

  assert.equal(progress.practised, 2, 'Beta has no record and is not counted');
  assert.equal(progress.averageLevel, 5.5);
  assert.equal(progress.mastered, 1);
  assert.deepEqual(overallProgress({}, topics), { practised: 0, averageLevel: 0, mastered: 0 });
});

test('recordFor never returns undefined', () => {
  const r = recordFor({}, 'missing');
  assert.equal(r.level, 0);
  assert.equal(r.attempts, 0);
});
