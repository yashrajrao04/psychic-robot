import test from 'node:test';
import assert from 'node:assert/strict';

import { planSchedule } from '../src/core/scheduler.js';
import {
  eventTitle,
  eventDescription,
  googleCalendarLink,
  toCSV,
  toICS,
  toNotionCSV,
  toNotionMarkdown,
  toTaskCSV,
} from '../src/core/exporters.js';

const plan = planSchedule({
  topics: [
    { id: 't0', subject: 'Biology', topic: 'Photosynthesis', difficulty: 'hard' },
    { id: 't1', subject: 'Maths', topic: 'Integration, by parts', difficulty: 'medium' },
  ],
  startDate: new Date(2025, 0, 6),
});

test('event titles follow "[Subject] – [Topic]"', () => {
  for (const session of plan.sessions) {
    assert.equal(eventTitle(session), `${session.subject} – ${session.topic}`);
  }
});

test('event descriptions carry the day checklist', () => {
  const session = plan.sessions[0];
  const description = eventDescription(session);
  assert.match(description, /Checklist:/);
  for (const task of session.tasks) {
    assert.ok(description.includes(task.text), 'every task appears in the description');
  }
});

test('ICS times are floating local, so 18:00 stays 18:00 anywhere', () => {
  const ics = toICS(plan.sessions, { startTime: '18:00' });

  const starts = ics.match(/DTSTART:[^\r\n]*/g);
  for (const line of starts) {
    assert.match(line, /^DTSTART:\d{8}T180000$/, `expected floating 18:00, got "${line}"`);
    assert.ok(!line.endsWith('Z'), 'an absolute UTC instant would shift when imported elsewhere');
  }

  // DTSTAMP genuinely is a moment in time and stays absolute.
  assert.match(ics.match(/DTSTAMP:[^\r\n]*/)[0], /Z$/);

  // The Google link must agree with the .ics rather than contradicting it.
  const gcal = new URL(googleCalendarLink(plan.sessions[0], { startTime: '18:00' }));
  assert.equal(gcal.searchParams.get('dates').split('/')[0], starts[0].replace('DTSTART:', ''));
});

test('the CSV start time matches the ICS start time', () => {
  const csvTime = toCSV(plan.sessions, { startTime: '18:00' }).split('\r\n')[1].split(',')[2];
  assert.equal(csvTime, '6:00 PM', 'all three exports describe the same wall-clock time');
});

test('ICS output is well formed and has one event per session', () => {
  const ics = toICS(plan.sessions, { startTime: '18:00' });

  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR$/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, plan.sessions.length);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, (ics.match(/END:VEVENT/g) || []).length);

  // Commas inside a topic name must be escaped, not left to split the field.
  assert.ok(ics.includes('Integration\\, by parts'), 'commas are escaped per RFC 5545');

  // No unfolded line may exceed 75 octets.
  for (const line of ics.split('\r\n')) {
    assert.ok(line.length <= 75, `line too long (${line.length}): ${line.slice(0, 40)}…`);
  }
});

test('CSV quotes fields containing commas', () => {
  const csv = toCSV(plan.sessions);
  const [header] = csv.split('\r\n');
  assert.equal(header, 'Subject,Start Date,Start Time,End Date,End Time,All Day Event,Description,Location,Private');
  assert.ok(csv.includes('"Maths – Integration, by parts"'), 'a comma in a field forces quoting');
  assert.equal(csv.split('\r\n').length, plan.sessions.length + 1);
});

test('task CSV emits one row per task', () => {
  const csv = toTaskCSV(plan.sessions);
  const rows = csv.split('\r\n').length - 1;
  const taskCount = plan.sessions.reduce((sum, s) => sum + s.tasks.length, 0);
  assert.equal(rows, taskCount);
});

test('Notion markdown groups by week and uses checkboxes', () => {
  const md = toNotionMarkdown(plan.sessions, { title: 'Revision Plan' });
  assert.match(md, /^# Revision Plan/);
  assert.match(md, /## Week 1/);
  assert.match(md, /- \[ \] /, 'tasks become Notion checkboxes');

  const checkboxes = (md.match(/- \[ \] /g) || []).length;
  const taskCount = plan.sessions.reduce((sum, s) => sum + s.tasks.length, 0);
  assert.equal(checkboxes, taskCount);
});

test('Notion CSV keeps one row per session', () => {
  const csv = toNotionCSV(plan.sessions);
  assert.equal(csv.split('\r\n').length - 1, plan.sessions.length);
  assert.match(csv.split('\r\n')[0], /^Name,Date,Subject,Topic/);
});

test('Google Calendar links encode a valid time range', () => {
  const link = googleCalendarLink(plan.sessions[0], { startTime: '18:00' });
  const url = new URL(link);
  assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(url.searchParams.get('action'), 'TEMPLATE');
  assert.equal(url.searchParams.get('text'), eventTitle(plan.sessions[0]));

  const dates = url.searchParams.get('dates');
  assert.match(dates, /^\d{8}T\d{6}\/\d{8}T\d{6}$/);
  const [start, end] = dates.split('/');
  assert.ok(end > start, 'the event ends after it starts');
  assert.ok(start.endsWith('T180000'), 'honours the configured start time');
});

/** A real RFC 4180 parser, so quoted commas and embedded newlines survive. */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

test('exported CSV round-trips through a real parser, one event per day', () => {
  const rows = parseCSV(toNotionCSV(plan.sessions));
  const [header, ...body] = rows;

  assert.equal(header[0], 'Name');
  assert.equal(body.length, plan.sessions.length);

  // The topic containing a comma must come back intact, not split across cells.
  const mathsRow = body.find((r) => r[0].startsWith('Maths'));
  assert.equal(mathsRow[0], 'Maths – Integration, by parts');
  assert.equal(mathsRow[3], 'Integration, by parts');

  const dates = body.map((r) => r[1]);
  assert.equal(new Set(dates).size, dates.length, 'one event per day, end to end');
});
