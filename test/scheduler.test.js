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

test('never schedules two topics on the same day', () => {
  const plan = planSchedule({
    topics: topics([
      ['Photosynthesis', 'hard'],
      ['Respiration', 'hard'],
      ['Enzymes', 'medium'],
      ['Genetics', 'medium'],
      ['Osmosis', 'easy'],
      ['Mitosis', 'hard'],
    ]),
    startDate: START,
  });

  const days = plan.sessions.map((s) => s.dayIndex);
  assert.equal(new Set(days).size, days.length, 'each day index must be unique');

  for (const day of plan.days) {
    const matching = plan.sessions.filter((s) => s.dayIndex === day.dayIndex);
    assert.ok(matching.length <= 1, `day ${day.iso} holds more than one session`);
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

test('grows the plan rather than doubling up when topics do not fit', () => {
  const many = topics(Array.from({ length: 14 }, (_, i) => [`Topic ${i}`, 'hard']));
  const plan = planSchedule({ topics: many, startDate: START, horizonDays: 28 });

  const days = plan.sessions.map((s) => s.dayIndex);
  assert.equal(new Set(days).size, days.length, 'still one topic per day');
  assert.equal(plan.sessions.length, 14 * 8, 'every rung is placed somewhere');
  assert.ok(plan.horizonDays > 28, 'the horizon extended to fit');
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
    assert.equal(day.session.id, session.id, 'day grid points back at the session');
    assert.equal(daysBetween(plan.startDate, session.date), session.dayIndex);
  }

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
