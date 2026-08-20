import test from 'node:test';
import assert from 'node:assert/strict';

import { planCram } from '../src/core/cram.js';

const NOW = new Date(2025, 0, 6, 9, 0); // Mon 6 Jan 2025, 09:00

function topics(specs) {
  return specs.map(([topic, difficulty], i) => ({ id: `t${i}`, subject: 'Exam', topic, difficulty }));
}

test('one topic per day still holds under cram pressure', () => {
  const result = planCram({
    topics: topics([
      ['Kinematics', 'hard'],
      ['Forces', 'hard'],
      ['Energy', 'medium'],
      ['Momentum', 'medium'],
      ['Waves', 'easy'],
    ]),
    testDate: new Date(2025, 0, 20, 9, 0),
    now: NOW,
  });

  assert.ok(result.ok);
  const days = result.sessions.map((s) => s.dayIndex);
  assert.equal(new Set(days).size, days.length, 'no day holds two topics');
});

test('hard topics are seen first', () => {
  const result = planCram({
    topics: topics([
      ['Easy one', 'easy'],
      ['Hard one', 'hard'],
      ['Medium one', 'medium'],
    ]),
    testDate: new Date(2025, 0, 16, 9, 0),
    now: NOW,
  });

  assert.ok(result.ok);
  const first = result.sessions[0];
  assert.equal(first.topic, 'Hard one', 'the hardest topic opens the cram plan');
});

test('hard topics get more passes than easy ones when time allows', () => {
  const result = planCram({
    topics: topics([
      ['Hard one', 'hard'],
      ['Easy one', 'easy'],
    ]),
    testDate: new Date(2025, 0, 20, 9, 0),
    now: NOW,
  });

  const hardPasses = result.sessions.filter((s) => s.topic === 'Hard one').length;
  const easyPasses = result.sessions.filter((s) => s.topic === 'Easy one').length;
  assert.ok(hardPasses > easyPasses, `hard=${hardPasses} should exceed easy=${easyPasses}`);
});

test('never schedules past the test, and stops the day before an early test', () => {
  const testDate = new Date(2025, 0, 10, 8, 30); // 08:30 start -> no session that morning
  const result = planCram({
    topics: topics([['A', 'hard'], ['B', 'medium']]),
    testDate,
    now: NOW,
  });

  assert.ok(result.ok);
  for (const session of result.sessions) {
    assert.ok(session.date < testDate, `${session.iso} is not before the test`);
  }
  assert.ok(result.sessions.every((s) => !s.isTestDay), 'an 08:30 test leaves no time to study that morning');
});

test('a late-morning test leaves the test day usable', () => {
  const result = planCram({
    topics: topics([['A', 'hard'], ['B', 'hard'], ['C', 'medium'], ['D', 'medium']]),
    testDate: new Date(2025, 0, 9, 14, 0), // 14:00
    now: NOW,
  });

  assert.ok(result.ok);
  assert.equal(result.daysAvailable, 4, 'Mon, Tue, Wed and the Thursday morning');
});

test('uses the full runway, finishing on the last day before the test', () => {
  const result = planCram({
    topics: topics([
      ['Photosynthesis', 'hard'],
      ['Cell respiration', 'medium'],
    ]),
    testDate: new Date(2025, 0, 18, 9, 0), // 12 days out
    now: NOW,
  });

  assert.ok(result.ok);
  const last = result.sessions[result.sessions.length - 1];
  assert.equal(
    last.dayIndex,
    result.daysAvailable - 1,
    'the final review sits on the last available day, not days before the test',
  );
  assert.equal(result.sessions[0].dayIndex, 0, 'and the first pass starts immediately');
});

test('reports topics that cannot fit rather than doubling them up', () => {
  const result = planCram({
    topics: topics([
      ['A', 'hard'],
      ['B', 'hard'],
      ['C', 'hard'],
      ['D', 'hard'],
      ['E', 'hard'],
    ]),
    testDate: new Date(2025, 0, 8, 9, 0), // only 2 study days
    now: NOW,
  });

  assert.ok(result.ok);
  assert.equal(result.sessions.length, 2, 'two days means two sessions, no more');
  assert.equal(result.uncovered.length, 3, 'the rest are reported as uncovered');
});

test('falls back to hour blocks when the test is today', () => {
  const result = planCram({
    topics: topics([['A', 'hard'], ['B', 'medium']]),
    testDate: new Date(2025, 0, 6, 15, 0), // same day, 6 hours out
    now: NOW,
  });

  assert.ok(result.ok);
  assert.equal(result.mode, 'blocks');
  assert.ok(result.blocks.length > 0);

  // Blocks must not overlap, and must finish before the test.
  for (let i = 1; i < result.blocks.length; i += 1) {
    assert.ok(result.blocks[i].start >= result.blocks[i - 1].end, 'blocks do not overlap');
  }
  for (const block of result.blocks) {
    assert.ok(block.end <= new Date(2025, 0, 6, 14, 30), 'stops at least 30 min before the test');
  }
  assert.equal(result.blocks[0].topic, 'A', 'hardest topic goes first, while freshest');
});

test('refuses a test date in the past', () => {
  const result = planCram({
    topics: topics([['A', 'hard']]),
    testDate: new Date(2025, 0, 5, 9, 0),
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /past/i);
});

test('requires topics and a test date', () => {
  assert.equal(planCram({ topics: [], testDate: new Date(2025, 0, 20), now: NOW }).ok, false);
  assert.equal(planCram({ topics: topics([['A', 'hard']]), now: NOW }).ok, false);
});

test('cram checklists are active-recall shaped', () => {
  const result = planCram({
    topics: topics([['SQL joins', 'hard']]),
    testDate: new Date(2025, 0, 16, 9, 0),
    now: NOW,
  });

  const allTasks = result.sessions.flatMap((s) => s.tasks.map((t) => t.text.toLowerCase()));
  assert.ok(allTasks.some((t) => t.includes('recall')), 'includes active recall');
  assert.ok(allTasks.some((t) => t.includes('practice') || t.includes('questions')), 'includes practice');
  assert.ok(allTasks.some((t) => t.includes('error') || t.includes('wrong')), 'includes error review');
});
