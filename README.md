# Study Buddy

A spaced-repetition study planner, revision timetable and practice engine. You give it
subjects and topics; it builds a calendar where **exactly one topic falls on each day**,
every topic comes back two or three times, and each day carries a specific checklist
rather than a vague "revise chapter 4".

It runs entirely in the browser. No build step, no dependencies, no server, no accounts —
your data stays in `localStorage`.

```bash
npm run serve   # http://localhost:5173
npm test        # 56 unit tests, no dependencies
```

## What it does

**Plan.** Four views of the same schedule: a week-by-week revision timetable (subjects and
topics down the side, Week 1–4 across the top), a day calendar, a chronological list, and a
timeline that makes the spacing itself visible.

**Spacing.** Difficulty drives repetition:

| Difficulty | Passes | Days |
| ---------- | ------ | ---- |
| Hard | 3 | 1, 3–4, ~15 |
| Medium | 3 | 1, 5, ~16 |
| Easy | 2 | 1, 8 |

Where two topics want the same day, the scheduler moves one to the nearest free day —
preferring to slip *later*, since studying early costs more than studying late. If the
topics genuinely do not fit, the plan gets longer. It never doubles two topics onto a day.

**Cram mode.** Give it a test date and time and it compresses the same logic into whatever
runway is left: hard topics first while you have room to recover, final reviews on the last
available day. Under a day to go, it switches to a timeline of 40-minute blocks ending
30 minutes before the test.

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
under Node. The invariants that matter most — one topic per day, 2–3 repetitions, hard
topics on days 1 / 3–4 / ~15, no export leaking two events onto one day — are asserted in
`test/scheduler.test.js` and `test/exporters.test.js`.
