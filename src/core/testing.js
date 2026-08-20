/**
 * Testing Mode — question practice with adaptive difficulty.
 *
 * Questions are generated strictly from the learner's own notes, so they stay
 * on-topic and at the right scope. The engine never reveals an answer: hints
 * escalate from "what is this question really asking" to "which part of your
 * notes to reread", and stop there. Grading only tells the learner whether
 * their reasoning is heading the right way.
 */

import { extractTerms, parseNotes } from './notes.js';

export const DIFFICULTY_LEVELS = ['easy', 'medium', 'hard'];

const STOP_SHORT = new Set(
  ('a an the and or but is are was were be been being to of in on at for with by from as it its this that these those ' +
    'not no do does did can could will would should may might have has had you your i we they them he she').split(' '),
);

/** Trim a note line down to something that reads well inside a question stem. */
function condense(line, maxWords = 9) {
  const words = String(line)
    .replace(/^([-*•]|\d+[.)])\s+/, '')
    .replace(/[.;:]+$/, '')
    .split(/\s+/);
  return words.slice(0, maxWords).join(' ') + (words.length > maxWords ? '…' : '');
}

/**
 * Question templates. `needs` declares what material a template requires, so a
 * template is skipped rather than rendered with placeholder junk when the notes
 * cannot supply it (e.g. a comparison needs two distinct terms).
 */
const TEMPLATES = {
  easy: [
    { needs: ['term'], build: ({ term }) => `Define **${term}** in one sentence, in your own words and without looking at your notes.` },
    { needs: ['term'], build: ({ term, topic }) => `What role does **${term}** play in ${topic}? One or two lines.` },
    { needs: [], build: ({ topic }) => `List the main components or stages of ${topic}. Aim for completeness, not detail.` },
    { needs: ['line'], build: ({ line }) => `Your notes say: "${condense(line)}". Restate that idea in your own words.` },
    { needs: ['term'], build: ({ term }) => `Give one concrete example of **${term}** in action.` },
  ],
  medium: [
    { needs: ['term'], build: ({ term, topic }) => `Explain **why** ${term} matters in ${topic}. What would go wrong if it were missing?` },
    { needs: [], build: ({ topic }) => `Walk through ${topic} step by step, and say what each step achieves. Order matters.` },
    { needs: ['pair'], build: ({ a, b }) => `Compare **${a}** and **${b}**. What is the single clearest test that tells them apart?` },
    { needs: ['line'], build: ({ line }) => `Your notes claim: "${condense(line, 12)}". What is the reasoning behind that claim?` },
    { needs: ['term'], build: ({ term, topic }) => `Under what conditions does **${term}** behave differently than you would first expect in ${topic}?` },
    { needs: [], build: ({ topic }) => `What is the most common mistake people make with ${topic}, and what causes it?` },
  ],
  hard: [
    { needs: ['term'], build: ({ term, topic }) => `Someone argues that **${term}** can be ignored when dealing with ${topic}. Build the strongest case against them — and then the strongest case *for* them.` },
    { needs: [], build: ({ topic }) => `Design a scenario in which ${topic} gives a misleading or outright wrong result. What exactly causes the failure?` },
    { needs: ['term'], build: ({ term, topic }) => `How would ${topic} change if **${term}** were removed entirely? Reason through the knock-on effects.` },
    { needs: ['pair'], build: ({ a, b }) => `Trace the causal chain connecting **${a}** and **${b}**. Where could that chain break?` },
    { needs: [], build: ({ topic }) => `Explain ${topic} in 60 seconds to a non-expert. Then: what probing follow-up would an examiner or interviewer ask, and how would you handle it?` },
    { needs: ['line'], build: ({ line, topic }) => `Your notes state: "${condense(line, 12)}". Under what circumstances would that stop being true, and what does that tell you about ${topic}?` },
  ],
};

/** Do we have enough material to test on? */
export function assessContext(rawNotes, topic) {
  const parsed = parseNotes(rawNotes);
  const terms = extractTerms(parsed);
  const usableTerms = terms.filter((t) => t.weight >= 2);

  const enough = parsed.wordCount >= 40 || usableTerms.length >= 4 || parsed.bullets.length >= 3;

  if (enough) return { ok: true, parsed, terms };

  return {
    ok: false,
    parsed,
    terms,
    message:
      `There is not enough here to build questions that are genuinely about ${topic || 'this topic'} — ` +
      'anything I generated would be generic, and generic questions do not find your gaps.',
    options: [
      'Paste or type more of your notes (aim for a paragraph or a handful of bullets).',
      'Run Study Buddy mode on this topic first — it will show you which sections are missing.',
      'Check your calendar: if this topic has a Learn session scheduled, do that pass first, then come back.',
    ],
  };
}

/**
 * Generate a question set from the learner's notes.
 *
 * @param {object} options
 * @param {string} options.notes      Raw notes.
 * @param {string} options.topic      Topic name.
 * @param {string} [options.difficulty] 'easy' | 'medium' | 'hard' | 'custom'
 * @param {number} [options.count]
 * @param {string[]} [options.mix]    For 'custom': which levels to draw from.
 */
export function generateQuestions({ notes, topic = 'this topic', difficulty = 'medium', count = 6, mix } = {}) {
  const context = assessContext(notes, topic);
  if (!context.ok) return { ok: false, ...context };

  const { parsed, terms } = context;
  const termList = terms.map((t) => t.term);
  const lines = (parsed.bullets.length ? parsed.bullets : parsed.sentences).filter((l) => l.split(/\s+/).length >= 4);

  const levels = difficulty === 'custom' && mix?.length ? mix : [difficulty];
  const questions = [];
  const seen = new Set();

  for (let i = 0; questions.length < count && i < count * 8; i += 1) {
    const level = levels[i % levels.length];
    const pool = TEMPLATES[level] || TEMPLATES.medium;
    const template = pool[i % pool.length];

    const term = termList.length ? termList[i % termList.length] : '';
    const a = term;
    const b = termList.length > 1 ? termList[(i + 1) % termList.length] : '';
    const line = lines.length ? lines[i % lines.length] : '';

    // Skip templates whose material the notes cannot supply.
    if (template.needs.includes('term') && !term) continue;
    if (template.needs.includes('pair') && (!a || !b || a === b)) continue;
    if (template.needs.includes('line') && !line) continue;

    const text = template.build({ term, topic, a, b, line });
    if (!text || seen.has(text)) continue;
    seen.add(text);

    questions.push({
      id: `q${questions.length}`,
      text,
      level,
      topic,
      // Kept for hint generation only — never shown as an answer.
      source: line,
      focusTerm: term || topic,
    });
  }

  return { ok: true, questions, terms, parsed };
}

/**
 * Escalating hints. Level 0 clarifies the question, level 1 names the concept,
 * level 2 points at where in the learner's own notes to look, level 3 breaks
 * the question into smaller questions. None of them state the answer.
 */
export function hintsFor(question, comparison) {
  const term = question.focusTerm;
  const hints = [
    {
      level: 1,
      label: 'What is this really asking?',
      text:
        question.level === 'easy'
          ? `This wants a clean, self-contained statement about ${term}. Not an example, not a story — the core idea, in your own words.`
          : question.level === 'medium'
            ? `This is asking for reasoning, not recall. A list of facts will not score; the marks are in the "why" and in the order things happen.`
            : `This is a transfer question: it checks whether you can move ${question.topic} into a situation you have not seen. Start from the principle, not from a memorised case.`,
    },
    {
      level: 2,
      label: 'Which concept is being tested',
      text: `Everything here turns on ${term}. Before writing, ask yourself: could I define ${term} precisely right now? If not, that is the real gap, and it is worth fixing before answering.`,
    },
    {
      level: 3,
      label: 'Where to look',
      text: question.source
        ? `Reread the part of your notes that begins "${condense(question.source, 5)}". The material you need is in there — I am not going to read it out for you.`
        : `Reread your notes on ${question.topic}, specifically the section that introduces ${term}.`,
    },
    {
      level: 4,
      label: 'Break it into smaller questions',
      text: [
        `1. What is ${term}, in one sentence?`,
        `2. What does ${term} do or cause within ${question.topic}?`,
        `3. What would be different if it were absent or changed?`,
        '4. Now assemble those three answers into one — that is your response.',
      ].join(' '),
    },
  ];

  if (comparison?.weakest?.length) {
    hints.push({
      level: 5,
      label: 'A structural nudge',
      text: `Your notes on this topic are thin on: ${comparison.weakest.join(', ')}. If this question feels impossible, that is probably why — and the fix is a Learn Mode pass, not a harder guess.`,
    });
  }

  return hints;
}

/**
 * Judge an attempt by how much of the relevant material it engages with.
 * Deliberately coarse: it reports direction, never correctness of content.
 */
export function gradeAttempt(question, answer) {
  const response = String(answer || '').trim();
  if (response.split(/\s+/).filter(Boolean).length < 3) {
    return {
      quality: 'empty',
      verdict: 'Nothing to work with yet',
      note: 'Write at least a sentence, even a wrong one. A wrong attempt tells us both exactly where the misunderstanding is; a blank tells us nothing.',
    };
  }

  const keyOf = (text) =>
    new Set(
      String(text)
        .toLowerCase()
        .split(/[^a-z0-9'-]+/)
        .filter((w) => w.length > 2 && !STOP_SHORT.has(w)),
    );

  const target = keyOf(`${question.source} ${question.focusTerm}`);
  const given = keyOf(response);
  let overlap = 0;
  for (const word of target) if (given.has(word)) overlap += 1;

  const ratio = target.size ? overlap / target.size : 0;
  const substantive = response.split(/\s+/).length >= 25;
  const reasons = /\bbecause\b|\bsince\b|\btherefore\b|\bso that\b|\bwhich means\b|\bleads? to\b/i.test(response);

  let quality;
  if (ratio >= 0.35 || (ratio >= 0.2 && reasons && substantive)) quality = 'strong';
  else if (ratio >= 0.12 || reasons) quality = 'partial';
  else quality = 'off';

  const notes = {
    strong: 'Your reasoning is engaging the right material and heading the right way. Push it further: add the case where it *stops* holding.',
    partial:
      'Part of this connects, but you have left out material that this question depends on. Reread your notes on ' +
      `${question.focusTerm} and try again — do not look at the answer anywhere, just at the concept.`,
    off:
      'This is not the direction the question wants. That is useful information, not a failure: it means the underlying concept ' +
      'needs a pass before the question is answerable. Take a hint and rebuild from the definition.',
  };

  return {
    quality,
    verdict: quality === 'strong' ? 'On track' : quality === 'partial' ? 'Partly there' : 'Not yet',
    note: notes[quality],
    engagedReasoning: reasons,
  };
}

/** Fresh adaptive session state. */
export function createSession(difficulty = 'medium') {
  const index = Math.max(0, DIFFICULTY_LEVELS.indexOf(difficulty));
  return {
    levelIndex: index === -1 ? 1 : index,
    streak: 0,
    misses: 0,
    answered: 0,
    strong: 0,
    history: [],
  };
}

/**
 * Advance adaptive difficulty. Two clean answers in a row step up; two
 * struggles step down and slow the pace.
 */
export function adaptSession(session, grade) {
  const next = { ...session, history: [...session.history, grade.quality] };
  next.answered += 1;

  if (grade.quality === 'strong') {
    next.strong += 1;
    next.streak += 1;
    next.misses = 0;
    if (next.streak >= 2 && next.levelIndex < DIFFICULTY_LEVELS.length - 1) {
      next.levelIndex += 1;
      next.streak = 0;
      next.change = 'up';
    } else {
      next.change = null;
    }
  } else if (grade.quality === 'partial') {
    next.streak = 0;
    next.change = null;
  } else if (grade.quality === 'off') {
    next.streak = 0;
    next.misses += 1;
    if (next.misses >= 2 && next.levelIndex > 0) {
      next.levelIndex -= 1;
      next.misses = 0;
      next.change = 'down';
    } else {
      next.change = null;
    }
  } else {
    next.change = null;
  }

  next.level = DIFFICULTY_LEVELS[next.levelIndex];
  return next;
}

/** Message shown when difficulty shifts, so the learner knows why. */
export function adaptationMessage(session) {
  if (session.change === 'up') {
    return `Two solid answers in a row — stepping up to ${DIFFICULTY_LEVELS[session.levelIndex]}. Questions will now ask you to apply and transfer, not just recall.`;
  }
  if (session.change === 'down') {
    return `Let's slow down and rebuild from the foundations — dropping to ${DIFFICULTY_LEVELS[session.levelIndex]}. This is the right move, not a setback.`;
  }
  return null;
}
