import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIFFICULTY_LEVELS,
  adaptSession,
  adaptationMessage,
  assessContext,
  createSession,
  generateQuestions,
  gradeAttempt,
  hintsFor,
} from '../src/core/testing.js';

const NOTES = `SQL joins

- INNER JOIN returns only rows matching in both tables
- LEFT JOIN returns all rows from the left table, with nulls where no match exists
- RIGHT JOIN is the mirror of a left join
- FULL OUTER JOIN returns rows from both sides, matched where possible
- CROSS JOIN produces the cartesian product of both tables

Common mistakes
- Filtering a left join in the WHERE clause silently turns it into an inner join
- Forgetting that null never equals null in a join condition`;

test('rejects notes too thin to build real questions from', () => {
  const context = assessContext('joins', 'SQL joins');
  assert.equal(context.ok, false);
  assert.ok(context.message.includes('SQL joins'));
  assert.ok(context.options.length >= 2, 'offers ways forward');
  assert.ok(
    context.options.some((o) => /study buddy/i.test(o)),
    'points at Study Buddy mode',
  );
});

test('accepts substantial notes', () => {
  assert.equal(assessContext(NOTES, 'SQL joins').ok, true);
});

test('generates the requested number of distinct questions', () => {
  const result = generateQuestions({ notes: NOTES, topic: 'SQL joins', difficulty: 'medium', count: 6 });

  assert.ok(result.ok);
  assert.equal(result.questions.length, 6);
  assert.equal(new Set(result.questions.map((q) => q.text)).size, 6, 'no duplicates');

  for (const question of result.questions) {
    assert.equal(question.level, 'medium');
    assert.ok(question.text.length > 20);
    assert.ok(!question.text.includes('undefined'), 'no unfilled placeholders');
    assert.ok(!question.text.includes('${'), 'no raw template syntax');
  }
});

test('questions stay tied to the learner\'s own material', () => {
  const result = generateQuestions({ notes: NOTES, topic: 'SQL joins', difficulty: 'easy', count: 5 });
  const joined = result.questions.map((q) => q.text.toLowerCase()).join(' ');

  assert.ok(joined.includes('sql joins') || joined.includes('join'), 'questions reference the topic');
  for (const question of result.questions) {
    assert.ok(question.focusTerm, 'each question has a focus term drawn from the notes');
  }
});

test('generates for every difficulty level, including a custom mix', () => {
  for (const level of DIFFICULTY_LEVELS) {
    const result = generateQuestions({ notes: NOTES, topic: 'SQL joins', difficulty: level, count: 4 });
    assert.ok(result.ok, `${level} generation failed`);
    assert.equal(result.questions.length, 4);
    assert.ok(result.questions.every((q) => q.level === level));
  }

  const custom = generateQuestions({
    notes: NOTES,
    topic: 'SQL joins',
    difficulty: 'custom',
    mix: ['easy', 'hard'],
    count: 6,
  });
  const levels = new Set(custom.questions.map((q) => q.level));
  assert.deepEqual([...levels].sort(), ['easy', 'hard']);
});

test('hints escalate and never state an answer', () => {
  const result = generateQuestions({ notes: NOTES, topic: 'SQL joins', difficulty: 'medium', count: 3 });
  const hints = hintsFor(result.questions[0], null);

  assert.ok(hints.length >= 4, 'a ladder, not a single hint');
  for (let i = 1; i < hints.length; i += 1) {
    assert.ok(hints[i].level > hints[i - 1].level, 'levels increase');
  }

  // The deepest hint points at where to look and breaks the task down — it
  // must not simply recite the source line as the answer.
  const deepest = hints[hints.length - 1].text;
  assert.ok(/\d\./.test(deepest) || /reread|look/i.test(deepest), 'guides rather than answers');
});

test('grading reports direction, and refuses to grade a blank', () => {
  const result = generateQuestions({ notes: NOTES, topic: 'SQL joins', difficulty: 'easy', count: 3 });
  const question = result.questions[0];

  const blank = gradeAttempt(question, '   ');
  assert.equal(blank.quality, 'empty');
  assert.match(blank.note, /wrong attempt|blank|sentence/i);

  const offTopic = gradeAttempt(question, 'I like pizza and long walks on the beach');
  assert.equal(offTopic.quality, 'off');

  const engaged = gradeAttempt(
    question,
    `${question.focusTerm} matters because it determines which rows survive the join, ` +
      'and therefore whether nulls appear in the result set for unmatched rows',
  );
  assert.ok(['strong', 'partial'].includes(engaged.quality), `expected engagement, got ${engaged.quality}`);
  assert.equal(engaged.engagedReasoning, true, 'detects causal reasoning');
});

test('difficulty steps up after two strong answers', () => {
  let session = createSession('easy');
  assert.equal(session.levelIndex, 0);

  session = adaptSession(session, { quality: 'strong' });
  assert.equal(session.levelIndex, 0, 'one good answer is not enough');

  session = adaptSession(session, { quality: 'strong' });
  assert.equal(session.levelIndex, 1, 'two in a row steps up');
  assert.equal(session.change, 'up');
  assert.match(adaptationMessage(session), /stepping up/i);
  assert.equal(session.answered, 2);
  assert.equal(session.strong, 2);
});

test('difficulty steps down after two misses, and never below easy', () => {
  let session = createSession('medium');

  session = adaptSession(session, { quality: 'off' });
  assert.equal(session.levelIndex, 1, 'one miss is not enough to drop');

  session = adaptSession(session, { quality: 'off' });
  assert.equal(session.levelIndex, 0, 'two misses drops a level');
  assert.match(adaptationMessage(session), /slow down|foundations/i);

  session = adaptSession(session, { quality: 'off' });
  session = adaptSession(session, { quality: 'off' });
  assert.equal(session.levelIndex, 0, 'never drops below easy');
});

test('difficulty never rises above hard, and partials hold steady', () => {
  let session = createSession('hard');
  session = adaptSession(session, { quality: 'strong' });
  session = adaptSession(session, { quality: 'strong' });
  assert.equal(session.levelIndex, DIFFICULTY_LEVELS.length - 1, 'capped at hard');

  let steady = createSession('medium');
  steady = adaptSession(steady, { quality: 'partial' });
  steady = adaptSession(steady, { quality: 'partial' });
  assert.equal(steady.levelIndex, 1, 'partial answers hold the level');
  assert.equal(adaptationMessage(steady), null);
});

test('a strong answer resets an accumulated miss', () => {
  let session = createSession('medium');
  session = adaptSession(session, { quality: 'off' });
  session = adaptSession(session, { quality: 'strong' });
  session = adaptSession(session, { quality: 'off' });
  assert.equal(session.levelIndex, 1, 'the misses were not consecutive, so no drop');
});
