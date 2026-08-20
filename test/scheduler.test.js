import test from 'node:test';
import assert from 'node:assert/strict';

import { planSchedule, groupByWeek, sessionsForTopic, upcomingSessions } from '../src/core/scheduler.js';
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

test('repeats every topic 2-3 times', () => {
  const list = topics([
    ['Hard topic', 'hard'],
    ['Medium topic', 'medium'],
    ['Easy topic', 'easy'],
  ]);
  const plan = planSchedule({ topics: list, startDate: START });

  for (const topic of list) {
    const sessions = sessionsForTopic(plan, topic.id);
    assert.ok(
      sessions.length >= 2 && sessions.length <= 3,
      `${topic.topic} scheduled ${sessions.length} times, expected 2-3`,
    );
  }

  assert.equal(sessionsForTopic(plan, 't0').length, 3, 'hard topics get three passes');
  assert.equal(sessionsForTopic(plan, 't2').length, 2, 'easy topics get two passes');
});

test('hard topics land on day 1, day 3-4, and about two weeks later', () => {
  const plan = planSchedule({ topics: topics([['Integration by parts', 'hard']]), startDate: START });
  const sessions = sessionsForTopic(plan, 't0');

  assert.equal(sessions[0].dayIndex, 0, 'first pass is day 1');

  const secondDayNumber = sessions[1].dayIndex + 1; // 0-indexed -> "Day N"
  assert.ok(
    secondDayNumber >= 3 && secondDayNumber <= 4,
    `second pass on day ${secondDayNumber}, expected day 3 or 4`,
  );

  const thirdDayNumber = sessions[2].dayIndex + 1;
  assert.ok(
    thirdDayNumber >= 13 && thirdDayNumber <= 17,
    `third pass on day ${thirdDayNumber}, expected roughly two weeks later`,
  );
});

test('repetitions of one topic are strictly increasing and never adjacent', () => {
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
      assert.ok(days[i] - days[i - 1] >= 2, 'a gap of at least two days between passes');
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
  assert.equal(plan.sessions.length, 14 * 3, 'every pass is placed somewhere');
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
  assert.equal(plan.days.length, 28);
});
