/**
 * Feynman technique — analysis of an explanation.
 *
 * The method is: explain the topic in plain language as if to someone who has
 * never met it, and the places you stall or reach for jargon are exactly the
 * places you do not understand it. This module looks for those places.
 *
 * It reads the explanation against the learner's own notes, which is what makes
 * the feedback specific rather than generic. The checks map onto the real
 * failure modes of the technique:
 *
 *   - reciting the notes instead of rebuilding the idea
 *   - using a technical term as a substitute for explaining it
 *   - listing what happens without ever saying why
 *   - hedging, which is what not-quite-knowing sounds like
 *   - skipping concepts the notes treat as central
 *
 * Nothing here invents subject knowledge, and nothing here hands over an
 * answer: the output is a set of questions a curious listener would ask next.
 */

import { extractTerms, parseNotes } from './notes.js';

const STOPWORDS = new Set(
  ('a an and are as at be been being but by can could did do does for from had has have how i if in into is it its ' +
    'may might must not of on or should so some such than that the their them then there these they this those to ' +
    'too us was we were what when where which who why will with would you your it\'s also more most very just about ' +
    'between during each other over under our they\'re we\'re there\'s here one two get got make makes made use used ' +
    'using thing things way ways lot really actually').split(' '),
);

/** Definitional cues — the shape of someone actually unpacking a term. */
const DEFINITION_CUES = [
  /\bis\s+(a|an|the|when|where|what|basically|essentially|just)\b/i,
  /\bmeans\b/i,
  /\brefers?\s+to\b/i,
  /\bin other words\b/i,
  // "that is, the splitting of water" defines; "that is how it works" does not.
  /\bthat is,/i,
  /\bthat is to say\b/i,
  /\bwhich is\b/i,
  /\bstands for\b/i,
  /\bthink of (it|this) as\b/i,
  /\bwhat (this|that|it) does is\b/i,
  /\bworks? by\b/i,
  /\bcalled\b/i,
  /\bi\.e\./i,
];

/**
 * Phrases that look definitional but only assert importance. "X is the key
 * step" tells a listener nothing about what X *is* — it is precisely the move
 * that lets someone talk past a term they cannot explain, so it must not count
 * as unpacking it.
 */
const IMPORTANCE_NOT_DEFINITION = [
  /\bis\s+(a|an|the)\s+(key|main|most|important|crucial|central|biggest|hardest|essential|fundamental|vital|critical|major|primary|first|last|best|worst)\b/i,
  /\bis\s+(really|very|super|extremely)\b/i,
  /\bis\s+(hard|easy|difficult|tricky|simple|complicated)\b/i,
];

/** Causal connectives — the difference between describing and explaining. */
const REASONING_CUES = [
  /\bbecause\b/i, /\bsince\b/i, /\btherefore\b/i, /\bso that\b/i, /\bwhich means\b/i,
  /\bleads? to\b/i, /\bcauses?\b/i, /\bresults? in\b/i, /\bas a result\b/i, /\bthis is why\b/i,
  /\bin order to\b/i, /\bdue to\b/i, /\botherwise\b/i, /\bif .+ then\b/i, /\bwhy\b/i,
];

/** Analogy markers — Feynman's own favourite move. */
const ANALOGY_CUES = [
  /\blike a\b/i, /\blike an\b/i, /\blike when\b/i, /\bsimilar to\b/i, /\bimagine\b/i,
  /\bthink of it as\b/i, /\bpicture a\b/i, /\bthe same way\b/i, /\banalogy\b/i,
  /\bit'?s basically a\b/i, /\bcompare(d)? (it )?to\b/i,
  // "it is like charging a power bank" — a verb after "like" is still a comparison
  /\b(is|are|it'?s|acts|behaves|works?|feels?)\s+(just\s+)?like\b/i,
  /\blike \w+ing\b/i, /\bsort of like\b/i, /\bthink of\b/i,
];

/** Hedges — what not-quite-knowing sounds like out loud. */
const HEDGE_CUES = [
  /\bsort of\b/i, /\bkind of\b/i, /\bkinda\b/i, /\bsomehow\b/i, /\bsomething like\b/i,
  /\bi think\b/i, /\bi guess\b/i, /\bmaybe\b/i, /\bprobably\b/i, /\bor whatever\b/i,
  /\bstuff like that\b/i, /\band so on\b/i, /\bbasically just\b/i, /\bnot really sure\b/i,
  /\bsome kind of\b/i,
];

function words(text) {
  return String(text).toLowerCase().match(/[a-z0-9'-]+/g) || [];
}

function sentences(text) {
  return String(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).filter(Boolean).length >= 3);
}

/** Rough syllable count — good enough for a readability grade. */
function syllables(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/**
 * Flesch–Kincaid grade level. Feynman's whole point is that a real explanation
 * survives being said simply, so a high grade here is a signal, not a virtue.
 */
export function readingGrade(text) {
  const ws = words(text);
  const ss = sentences(text);
  if (!ws.length || !ss.length) return 0;
  const syl = ws.reduce((sum, w) => sum + syllables(w), 0);
  const grade = 0.39 * (ws.length / ss.length) + 11.8 * (syl / ws.length) - 15.59;
  return Math.max(0, Math.round(grade * 10) / 10);
}

/**
 * Overlapping n-word shingles of content words, for verbatim-overlap detection.
 *
 * Four is deliberate: study notes are written in short bullets, so a six-word
 * window straddles sentence boundaries more often than it sits inside one and
 * badly under-reports copying. Four catches a lifted clause while still being
 * long enough that shared vocabulary alone will not trip it.
 */
function shingles(text, n = 4) {
  const ws = words(text).filter((w) => !STOPWORDS.has(w));
  const out = new Set();
  for (let i = 0; i + n <= ws.length; i += 1) out.add(ws.slice(i, i + n).join(' '));
  return out;
}

/**
 * How much of the explanation is lifted from the notes rather than rebuilt.
 * This is the single most diagnostic Feynman check: reciting is not knowing.
 */
export function verbatimOverlap(explanation, notes) {
  const mine = shingles(explanation);
  if (!mine.size || !notes) return { ratio: 0, matched: [] };
  const theirs = shingles(notes);
  const matched = [...mine].filter((s) => theirs.has(s));
  return { ratio: matched.length / mine.size, matched: matched.slice(0, 3) };
}

function countCues(text, cues) {
  return cues.reduce((n, cue) => n + (cue.test(text) ? 1 : 0), 0);
}

function matchedCues(text, cues) {
  const found = [];
  for (const sentence of sentences(text)) {
    if (cues.some((cue) => cue.test(sentence))) found.push(sentence);
  }
  return found;
}

/**
 * Terms the explanation leans on without ever unpacking.
 *
 * A term counts as unpacked if some sentence both mentions it and carries a
 * definitional cue. Using "photolysis" and never saying what it is, is exactly
 * the move the Feynman technique exists to catch.
 */
export function findJargon(explanation, candidateTerms) {
  const ss = sentences(explanation);
  const lower = String(explanation).toLowerCase();
  const jargon = [];

  for (const term of candidateTerms) {
    if (!lower.includes(term)) continue;
    const unpacked = ss.some(
      (sentence) =>
        sentence.toLowerCase().includes(term) &&
        DEFINITION_CUES.some((cue) => cue.test(sentence)) &&
        !IMPORTANCE_NOT_DEFINITION.some((veto) => veto.test(sentence)),
    );
    if (!unpacked) jargon.push(term);
  }
  return jargon;
}

/** "X is when X ..." — a definition that leans on the word it is defining. */
export function findCircular(explanation) {
  const circular = [];
  for (const sentence of sentences(explanation)) {
    const match = sentence.match(/^\s*(?:the\s+)?([a-z][a-z '-]{2,30}?)\s+(?:is|are|means)\b(.*)$/i);
    if (!match) continue;
    const subject = match[1].trim().toLowerCase();
    const rest = match[2].toLowerCase();
    const head = subject.split(/\s+/).filter((w) => w.length > 3 && !STOPWORDS.has(w));
    if (head.length && head.every((w) => rest.includes(w))) circular.push(sentence);
  }
  return circular;
}

/**
 * Analyse an explanation.
 *
 * @param {string} explanation What the learner said, in their own words.
 * @param {object} options `{ notes, topic }` — notes are optional but make the
 *   coverage and recital checks possible.
 */
export function analyseExplanation(explanation, { notes = '', topic = 'this topic', minWords = 25 } = {}) {
  const text = String(explanation || '').trim();
  const ws = words(text);
  const ss = sentences(text);

  // The Feynman tab wants a full attempt before it will score one. A
  // conversation turn is shorter by nature, so the coach lowers this bar
  // rather than telling someone to "write more" after every sentence.
  if (ws.length < minWords) {
    return {
      ok: false,
      tooShort: true,
      wordCount: ws.length,
      message:
        `That is too short to tell you anything useful about ${topic}. Aim for a few sentences — ` +
        'the gaps only show up once you have to keep talking.',
    };
  }

  const parsedNotes = parseNotes(notes);
  const noteTerms = notes.trim() ? extractTerms(parsedNotes, 14).map((t) => t.term) : [];
  const usedTerms = noteTerms.filter((t) => text.toLowerCase().includes(t));

  // The topic's own name is not a missing concept — telling someone their
  // explanation of photosynthesis never says "photosynthesis" is pedantry,
  // not feedback.
  const topicWords = new Set(words(topic));
  const missingTerms = noteTerms.filter(
    (t) => !text.toLowerCase().includes(t) && !topicWords.has(t),
  );

  // Only genuinely technical-looking terms count as jargon. Flagging ordinary
  // words like "occur" or "carbon" as unexplained jargon would be noise, and
  // noise is what makes feedback easy to ignore.
  const acronyms = new Set((String(notes).match(/\b[A-Z]{2,6}\b/g) || []).map((a) => a.toLowerCase()));
  const isTechnical = (term) => term.includes('-') || term.length >= 9 || acronyms.has(term);

  const longWords = [...new Set(ws.filter((w) => w.length >= 10 && !STOPWORDS.has(w)))];
  const candidates = [...new Set([...usedTerms, ...longWords])].filter(isTechnical);

  const jargon = findJargon(text, candidates);
  const circular = findCircular(text);
  const overlap = verbatimOverlap(text, notes);
  const grade = readingGrade(text);

  const reasoningSentences = matchedCues(text, REASONING_CUES);
  const analogies = matchedCues(text, ANALOGY_CUES);
  const hedges = matchedCues(text, HEDGE_CUES);
  const reasoningDensity = ss.length ? reasoningSentences.length / ss.length : 0;

  // Longest sentences are the ones most likely to lose a listener.
  const longSentences = [...ss]
    .filter((s) => s.split(/\s+/).length > 28)
    .sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length)
    .slice(0, 2);

  // --- score ------------------------------------------------------------
  let score = 100;
  score -= Math.round(overlap.ratio * 45); // reciting is the worst failure
  score -= Math.min(20, jargon.length * 7);
  score -= Math.min(12, circular.length * 6);
  score -= Math.min(12, hedges.length * 4);
  score -= Math.min(12, Math.max(0, Math.round((grade - 9) * 2)));
  if (reasoningDensity < 0.2) score -= 12;
  if (missingTerms.length > noteTerms.length / 2 && noteTerms.length) score -= 10;
  if (analogies.length) score += 6;
  score = Math.max(0, Math.min(100, score));

  // With no notes there is nothing to check recital or coverage against — the
  // two strongest signals are simply switched off. Capping the score keeps it
  // from claiming a confidence the analysis has not earned.
  const verified = Boolean(notes.trim());
  if (!verified) score = Math.min(score, 85);

  // --- feedback, worst problem first ------------------------------------
  const strengths = [];
  const improvements = [];

  if (overlap.ratio >= 0.25) {
    improvements.push({
      title: 'You are reciting, not explaining',
      detail:
        `About ${Math.round(overlap.ratio * 100)}% of this matches your notes word for word. ` +
        'Close them and say it again from memory — if the phrasing does not change, the understanding is borrowed.',
    });
  } else if (overlap.ratio < 0.08 && notes.trim()) {
    strengths.push('This is in your own words, not your notes’ words — which is the whole point of the technique.');
  }

  if (jargon.length) {
    improvements.push({
      title: `You leaned on ${jargon.length} term${jargon.length === 1 ? '' : 's'} without unpacking ${jargon.length === 1 ? 'it' : 'them'}`,
      detail:
        `${jargon.slice(0, 4).map((t) => `"${t}"`).join(', ')} — each appears without you ever saying what it means. ` +
        'Replace one with a plain-language description and see whether the sentence still holds together.',
      items: jargon.slice(0, 6),
    });
  } else if (candidates.length) {
    strengths.push('Every technical term you used, you also explained. That is the hardest part to get right.');
  }

  if (circular.length) {
    improvements.push({
      title: 'One of your definitions is circular',
      detail: `"${circular[0].slice(0, 110)}" defines the idea using the idea. What would you say to someone who does not already know the word?`,
    });
  }

  if (reasoningDensity < 0.2) {
    improvements.push({
      title: 'This describes what happens, not why',
      detail:
        'Almost none of your sentences carry a "because", "so that" or "which means". A list of steps is memorised; ' +
        'a chain of causes is understood. Go back and justify each step.',
    });
  } else {
    strengths.push(`${reasoningSentences.length} of your ${ss.length} sentences explain *why*, not just *what*.`);
  }

  if (grade > 12) {
    improvements.push({
      title: `Reading level is grade ${grade} — too high for a real Feynman pass`,
      detail:
        'The test is whether a bright twelve-year-old would follow it. Long words and long sentences often hide ' +
        'the fact that a step has not been thought through.',
      items: longSentences,
    });
  } else if (grade > 0 && grade <= 9) {
    strengths.push(`Plain enough to follow (reading level grade ${grade}) — that is exactly the target.`);
  }

  if (hedges.length >= 2) {
    improvements.push({
      title: 'You hedged several times',
      detail:
        `Phrases like "${hedges[0].match(new RegExp(HEDGE_CUES.map((h) => h.source).join('|'), 'i'))?.[0] || 'sort of'}" ` +
        'mark the exact spots you are unsure. Those are not filler — they are a map of what to review.',
      items: hedges.slice(0, 3),
    });
  }

  if (missingTerms.length && noteTerms.length) {
    improvements.push({
      title: 'Your notes cover ideas your explanation skipped',
      detail: `Never mentioned: ${missingTerms.slice(0, 6).join(', ')}. Are they genuinely irrelevant here, or did you avoid them?`,
      items: missingTerms.slice(0, 6),
    });
  }

  if (analogies.length) {
    strengths.push('You reached for an analogy — the clearest sign you are working from a mental model, not a memorised script.');
  } else {
    improvements.push({
      title: 'No analogy anywhere',
      detail: `Find one everyday thing ${topic} behaves like, and one way that comparison breaks down. Both halves matter.`,
    });
  }

  if (!strengths.length) strengths.push('You wrote a real attempt rather than a sentence — that is what makes the gaps findable.');

  return {
    ok: true,
    topic,
    score,
    verified,
    verdict: verdictFor(score, verified),
    wordCount: ws.length,
    sentenceCount: ss.length,
    grade,
    overlapRatio: Math.round(overlap.ratio * 100),
    reasoningDensity: Math.round(reasoningDensity * 100),
    jargon,
    circular,
    hedges,
    analogies,
    missingTerms,
    usedTerms,
    longSentences,
    strengths,
    improvements,
    questions: childQuestions({ jargon, missingTerms, topic, reasoningDensity, analogies }),
    hasNotes: Boolean(notes.trim()),
  };
}

function verdictFor(score, verified = true) {
  if (score >= 80) return verified ? 'You could teach this' : 'Reads well — but unverified';
  if (score >= 60) return 'Mostly yours, with soft spots';
  if (score >= 40) return 'Half explained, half recited';
  return 'Not understood yet — and now you know where';
}

/**
 * The questions a curious listener would ask next.
 *
 * These are the deliverable, not the answers. Each one points at a specific
 * weakness the analysis found, so working through them is the next pass.
 */
export function childQuestions({ jargon = [], missingTerms = [], topic = 'this', reasoningDensity = 0, analogies = [] }) {
  const questions = [];

  for (const term of jargon.slice(0, 3)) {
    questions.push(`You said "${term}" — what is that, in words you would use with a friend?`);
  }
  if (reasoningDensity < 0.25) {
    questions.push(`Why does ${topic} work that way? What would break if it did not?`);
  }
  for (const term of missingTerms.slice(0, 2)) {
    questions.push(`Your notes mention "${term}" but your explanation did not. Where does it fit?`);
  }
  if (!analogies.length) {
    questions.push(`What everyday thing is ${topic} most like — and where does that comparison fall apart?`);
  }

  questions.push(`What is the one part of ${topic} you would least like to be asked about right now?`);
  return questions.slice(0, 6);
}
