# Study Buddy

A spaced-repetition study planner, revision timetable and practice engine. You give it
subjects and topics; every topic climbs the expanding ladder
**D1 · D2 · D4 · D7 · D14 · D30 · D60 · D120** from the day you start it, and each session
carries a specific checklist rather than a vague "revise chapter 4".

It runs entirely in the browser. No build step, no dependencies, no server, no accounts —
your data stays in `localStorage`.

```bash
npm run serve   # http://localhost:5173
npm test        # 64 unit tests, no dependencies
```

## What it does

**Plan.** Four views of the same schedule: a week-by-week revision timetable (subjects and
topics down the side, weeks across the top), a day calendar, a chronological list, and a
timeline that makes the spacing itself visible.

**Spacing.** Every topic follows the same expanding ladder, each interval roughly doubling
the last. Difficulty decides how many rungs it uses — everything still reaches D120, because
long-term retention is the point; easier material just skips the dense early passes.

| Difficulty | Passes | Ladder |
| ---------- | ------ | ------ |
| Hard | 8 | D1 · D2 · D4 · D7 · D14 · D30 · D60 · D120 |
| Medium | 7 | D1 · D4 · D7 · D14 · D30 · D60 · D120 |
| Easy | 6 | D1 · D7 · D14 · D30 · D60 · D120 |

Each rung asks for different work: D1 builds the representation, D2 catches what already
faded overnight, the middle rungs test it under timed conditions, and D30 onward are cold
retrieval — if you cannot recall it unaided at D60, the earlier passes did not stick.

**Timing is exact, and nothing is allowed to bend it.** Intervals are the whole mechanism
of spaced repetition, so no session is ever nudged off its rung to keep the calendar tidy.
Days therefore stack: if six topics start together, all six are due on D1, again on D2, and
so on. The plan says so plainly — stacked days are flagged with a count and the total
minutes, so the load is visible rather than hidden.

The one exception is your own **study days** setting. Switch a weekday off and sessions
landing there move to the nearest day you do study. Leave all seven on and drift is exactly
zero, which the test suite asserts.

**Dates.** Each topic climbs the ladder from **its own** start date — the day you added it,
or any date you set on it afterwards. A topic added three weeks into a plan starts then, not
back-dated to the plan's origin, and existing topics keep the schedule you are following.
Moving a topic's D1 is also how you spread load: stagger the start dates and the stacks come
apart, without touching the intervals.

Because the ladder is fixed, plan length does not depend on how many topics you have —
fourteen topics finish on D120 just like one. Only the daily load changes.

**Cram mode.** Give it a test date and time and it compresses the same logic into whatever
runway is left: hard topics first while you have room to recover, final reviews on the last
available day. Nothing is dropped for lack of room — days stack and the plan tells you how
crowded the worst one is, so you can cut topics yourself rather than discovering later that
the app quietly dropped them. A topic still never repeats twice in one day, because
re-reading something an hour later is not spacing. Under a day to go, it switches to a
timeline of 40-minute blocks ending 30 minutes before the test.

**Study Buddy.** Paste your notes and get a side-by-side comparison: column A is what you
wrote, column B is the same material refiled into the eight sections complete notes have
(definition, mechanism, worked examples, pitfalls, exam angles…). Empty sections are shown
as prompts, and thin coverage offers to re-mark the topic *hard* so it gets more passes.
Learn Mode then walks the concept step by step, each step ending in something for you to do.

**Testing mode.** Questions are generated from the terms and claims in your own notes, so
they stay on-topic. Two strong answers in a row raises the difficulty; two misses lowers it.

**Export.** Google Calendar (`.ics` or CSV), Notion (markdown with real checkboxes, or a
database CSV), and a flat one-row-per-task CSV for Excel or Sheets. Every export keeps the
same shape: one topic per event per day, titled `[Subject] – [Topic]`, with the day's
checklist as the description.

Times are written as RFC 5545 *floating* local times, so a session set for 18:00 stays at
18:00 in whatever calendar and timezone opens it, and does not shift when you travel. All
three exporters agree on the wall-clock time, and the test suite runs across several
timezones to keep them honest.

## It will not do your homework

Ask for an answer and you get the problem broken into steps, the underlying concept named,
and guiding questions — never the answer. In Testing Mode, hints escalate from "what is this
question really asking" to "which part of your notes to reread", and stop there. Grading
tells you whether your reasoning is heading the right way; the answer stays yours to build.

This is enforced in code (`src/core/policy.js`), not just in wording, and it is covered by
tests that check both directions: `"just tell me the answer"` is blocked, while
`"explain how integration by parts works"` and `"I think the answer involves photosynthesis
— am I on the right track?"` pass through untouched.

## What it does not do

There is no language model behind this. That shapes one feature honestly: Study Buddy
**cannot write factual notes on your topic for you**, and it does not pretend to. Inventing
confident-sounding content in a study tool would be worse than useless. What column B gives
you instead is your own material, restructured, with the gaps named — which is the part that
actually finds what you are missing.

Binary note formats (PDF, DOCX) are not parsed; the app says so and asks you to paste the
text rather than silently analysing garbage.

## Layout

```
index.html
assets/styles.css
src/core/       pure logic — no DOM, directly unit-tested
  dates.js      local-midnight date arithmetic
  scheduler.js  the spaced-repetition engine
  tasks.js      per-day checklist generation
  cram.js       compressed pre-test scheduling
  notes.js      note parsing, structural coverage, Learn Mode
  testing.js    question generation, hints, adaptive difficulty
  policy.js     the no-direct-answers guard
  exporters.js  ICS / CSV / Notion output
src/app/        DOM layer — store, helpers, one module per view
test/           node:test suites for every core module
```

`src/core` holds no browser APIs, so the scheduling and grading logic is testable directly
under Node. The invariants that matter most — every topic landing exactly on the D1–D120
ladder with zero drift, no topic scheduled before it was added, no topic repeating twice in
a day, and exports that agree on wall-clock time — are asserted in `test/scheduler.test.js`
and `test/exporters.test.js`.
