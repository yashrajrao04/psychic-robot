import test from 'node:test';
import assert from 'node:assert/strict';

import {
  planSchedule,
  groupByWeek,
  sessionsForTopic,
  upcomingSessions,
  ladderFor,
  LADDER_DAYS,
} from '../src/core/scheduler.js';
import { addDays, daysBetween } from '../src/core/dates.js';

const START = new Date(2025, 0, 6); // a Monday

function topics(specs) {
  return specs.map(([topic, difficulty], i) => ({
    id: `t${i}`,
    subject: 'Test Subject',
    topic,
    difficulty,
  }));
}

test('exact timing wins over tidy days — topics may share a day', () => {
  const list = topics([
    ['Photosynthesis', 'hard'],
    ['Respiration', 'hard'],
    ['Enzymes', 'medium'],
    ['Genetics', 'medium'],
    ['Osmosis', 'easy'],
    ['Mitosis', 'hard'],
  ]);
  const plan = planSchedule({ topics: list, startDate: START });

  // Every topic starts the day it was added and hits every rung exactly.
  for (const topic of list) {
    const dayNumbers = sessionsForTopic(plan, topic.id).map((s) => s.dayIndex + 1);
    assert.deepEqual(
      dayNumbers,
      ladderFor(topic.difficulty).map((r) => r.day),
      `${topic.topic} did not land on its ladder`,
    );
    assert.ok(
      sessionsForTopic(plan, topic.id).every((s) => s.drift === 0),
      `${topic.topic} was nudged off its rung`,
    );
  }

  // All six share D1, and the day grid reports the stack rather than hiding it.
  const firstDay = plan.days[0];
  assert.equal(firstDay.sessions.length, 6, 'every topic is due on day one');
  assert.equal(plan.busiestDay, 6);
});

test('a topic never appears twice on the same day', () => {
  const plan = planSchedule({
    topics: topics([['A', 'hard'], ['B', 'hard'], ['C', 'medium']]),
    startDate: START,
  });

  for (const day of plan.days) {
    const ids = day.sessions.map((s) => s.topicId);
    assert.equal(new Set(ids).size, ids.length, `${day.iso} repeats a topic within the day`);
  }
});

test('follows the D1 D2 D4 D7 D14 D30 D60 D120 ladder exactly', () => {
  assert.deepEqual(LADDER_DAYS, [1, 2, 4, 7, 14, 30, 60, 120], 'the ladder is the one asked for');

  const plan = planSchedule({ topics: topics([['Photosynthesis', 'hard']]), startDate: START });
  const sessions = sessionsForTopic(plan, 't0');

  const dayNumbers = sessions.map((s) => s.dayIndex + 1);
  assert.deepEqual(dayNumbers, LADDER_DAYS, 'an unobstructed hard topic hits every rung on the nose');

  assert.deepEqual(
    sessions.map((s) => s.ladderDay),
    LADDER_DAYS,
    'each session records which rung it is',
  );
});

test('difficulty decides how much of the ladder a topic climbs', () => {
  const list = topics([
    ['Hard topic', 'hard'],
    ['Medium topic', 'medium'],
    ['Easy topic', 'easy'],
  ]);
  const plan = planSchedule({ topics: list, startDate: START });

  assert.equal(sessionsForTopic(plan, 't0').length, 8, 'hard topics take every rung');
  assert.equal(sessionsForTopic(plan, 't1').length, 7, 'medium skips the D2 rung');
  assert.equal(sessionsForTopic(plan, 't2').length, 6, 'easy skips D2 and D4');

  // Whatever the difficulty, the ladder still starts at D1 and reaches D120.
  for (const topic of list) {
    const rungs = ladderFor(topic.difficulty).map((r) => r.day);
    assert.equal(rungs[0], 1, 'every topic starts at D1');
    assert.equal(rungs[rungs.length - 1], 120, 'and every topic reaches D120');
  }
});

test('stays close to the ideal rungs even when topics compete for days', () => {
  const list = topics([
    ['A', 'hard'],
    ['B', 'medium'],
    ['C', 'easy'],
    ['D', 'hard'],
    ['E', 'medium'],
    ['F', 'hard'],
    ['G', 'easy'],
  ]);
  const plan = planSchedule({ topics: list, startDate: START });

  for (const topic of list) {
    const sessions = sessionsForTopic(plan, topic.id);
    const ideal = ladderFor(topic.difficulty).map((r) => r.day);
    const first = sessions[0].dayIndex;

    assert.equal(sessions.length, ideal.length, `${topic.topic} kept all its rungs`);
    sessions.forEach((session, i) => {
      const actualDay = session.dayIndex - first + 1;
      const drift = Math.abs(actualDay - ideal[i]);
      assert.ok(drift <= 2, `${topic.topic} rung D${ideal[i]} drifted ${drift} days`);
    });
  }
});

test('passes of one topic move forward and never share a day', () => {
  const plan = planSchedule({
    topics: topics([
      ['A', 'hard'],
      ['B', 'medium'],
      ['C', 'easy'],
      ['D', 'hard'],
    ]),
    startDate: START,
  });

  for (const id of ['t0', 't1', 't2', 't3']) {
    const days = sessionsForTopic(plan, id).map((s) => s.dayIndex);
    for (let i = 1; i < days.length; i += 1) {
      assert.ok(days[i] > days[i - 1], 'passes must move forward in time');
    }
  }
});

test('respects the available-weekdays filter', () => {
  const plan = planSchedule({
    topics: topics([
      ['A', 'hard'],
      ['B', 'medium'],
      ['C', 'hard'],
    ]),
    startDate: START,
    availableWeekdays: [1, 2, 3, 4, 5], // weekdays only
  });

  for (const session of plan.sessions) {
    const weekday = session.date.getDay();
    assert.ok(weekday >= 1 && weekday <= 5, `${session.iso} falls on a weekend`);
  }
});

test('with every weekday available the ladder never drifts at all', () => {
  const plan = planSchedule({
    topics: topics([['A', 'hard'], ['B', 'medium'], ['C', 'easy'], ['D', 'hard']]),
    startDate: START,
  });
  for (const session of plan.sessions) {
    assert.equal(session.drift, 0, `${session.topic} D${session.ladderDay} drifted`);
  }
});

test('plan length is set by the ladder, not by how many topics there are', () => {
  const many = topics(Array.from({ length: 14 }, (_, i) => [`Topic ${i}`, 'hard']));
  const plan = planSchedule({ topics: many, startDate: START, horizonDays: 28 });

  assert.equal(plan.sessions.length, 14 * 8, 'every rung is placed');
  assert.equal(plan.busiestDay, 14, 'all 14 topics start together, and that is reported');

  // 14 topics take exactly as long as one: the D120 rung sets the horizon.
  const lastDay = Math.max(...plan.sessions.map((s) => s.dayIndex));
  assert.equal(lastDay + 1, 120, 'the plan ends on D120 regardless of topic count');
  assert.ok(plan.horizonDays >= 120);
  assert.equal(plan.horizonDays % 7, 0, 'plan length stays a whole number of weeks');
});

test('every session carries a specific, topic-named checklist', () => {
  const plan = planSchedule({ topics: topics([['Photosynthesis', 'hard']]), startDate: START });

  for (const session of plan.sessions) {
    assert.ok(session.tasks.length >= 2, 'at least two tasks per day');
    assert.ok(
      session.tasks.some((t) => t.text.includes('Photosynthesis')),
      'tasks name the actual topic rather than being generic',
    );
    for (const task of session.tasks) {
      assert.ok(task.id && task.text.length > 10, 'tasks are concrete');
    }
  }
});

test('days grid aligns with sessions and covers whole weeks', () => {
  const plan = planSchedule({ topics: topics([['A', 'medium'], ['B', 'hard']]), startDate: START });

  assert.equal(plan.days.length % 7, 0);
  assert.equal(plan.days.length, plan.weeks * 7);

  for (const session of plan.sessions) {
    const day = plan.days[session.dayIndex];
    assert.ok(
      day.sessions.some((s) => s.id === session.id),
      'day grid points back at the session',
    );
    assert.equal(daysBetween(plan.startDate, session.date), session.dayIndex);
  }

  // Every session appears in exactly one day bucket.
  const bucketed = plan.days.reduce((n, d) => n + d.sessions.length, 0);
  assert.equal(bucketed, plan.sessions.length);

  const weeks = groupByWeek(plan.days);
  assert.equal(weeks.length, plan.weeks);
  for (const week of weeks) assert.equal(week.length, 7);
});

test('upcomingSessions windows correctly', () => {
  const plan = planSchedule({
    topics: topics([['A', 'hard'], ['B', 'hard'], ['C', 'medium']]),
    startDate: START,
  });

  const next7 = upcomingSessions(plan, START, 7);
  assert.ok(next7.length > 0);
  for (const session of next7) assert.ok(session.dayIndex < 7);

  const laterWindow = upcomingSessions(plan, addDays(START, 7), 7);
  for (const session of laterWindow) {
    assert.ok(session.dayIndex >= 7 && session.dayIndex < 14);
  }
});

test('handles an empty topic list without throwing', () => {
  const plan = planSchedule({ topics: [], startDate: START });
  assert.equal(plan.sessions.length, 0);
  assert.equal(plan.days.length, 126, 'an empty plan still spans the default horizon');
});

/* ------------------------------------------------- start-date anchoring -- */

test('a topic added later starts from its own date, not the plan origin', () => {
  const planStart = new Date(2025, 0, 6);
  const threeWeeksLater = new Date(2025, 0, 27);

  const plan = planSchedule({
    topics: [
      { id: 'old', subject: 'Bio', topic: 'Started at the beginning', difficulty: 'hard', startDate: planStart },
      { id: 'new', subject: 'Bio', topic: 'Added three weeks in', difficulty: 'hard', startDate: threeWeeksLater },
    ],
    startDate: planStart,
  });

  const added = sessionsForTopic(plan, 'new');
  assert.ok(added.length > 0);
  for (const session of added) {
    assert.ok(session.date >= threeWeeksLater, `${session.iso} is before the topic was even added`);
  }
  assert.equal(added[0].iso, '2025-01-27', 'its D1 is the day it was added');

  // The pre-existing topic keeps the schedule it already had.
  assert.equal(sessionsForTopic(plan, 'old')[0].iso, '2025-01-06');
});

test('the calendar origin follows the topics rather than a stale plan date', () => {
  const stale = new Date(2024, 0, 1);
  const actualStart = new Date(2025, 0, 6);

  const plan = planSchedule({
    topics: [{ id: 'a', subject: 'Bio', topic: 'X', difficulty: 'easy', startDate: actualStart }],
    startDate: stale,
  });

  assert.equal(
    plan.startDate.getTime(),
    actualStart.getTime(),
    'a year of empty calendar is not prepended just because the setting is old',
  );
  assert.equal(plan.sessions[0].iso, '2025-01-06');
});

test('topics without a start date still schedule from the plan start', () => {
  const plan = planSchedule({ topics: topics([['A', 'hard']]), startDate: START });
  assert.equal(plan.sessions[0].dayIndex, 0);
  assert.equal(plan.startDate.getTime(), START.getTime());
});
