/**
 * The Study Buddy coach — a conversation you can actually have, which still
 * never hands over an answer.
 *
 * This is a rule-based Socratic partner, not a language model. What makes it
 * useful rather than an ELIZA toy is that every move is grounded in the
 * learner's own notes: it knows which terms they wrote down, which ones they
 * used without explaining, and which parts of the topic they have never
 * mentioned. A reply is chosen by reading what they just said against that
 * material.
 *
 * It is honest about its limits by construction — it cannot state a fact about
 * the subject, because it has no facts. Everything it says is a question, a
 * reflection of the learner's own words, or a pointer back to their notes.
 * That constraint is the feature: it is structurally incapable of doing the
 * homework.
 */

import { analyseExplanation } from './feynman.js';
import { extractTerms, parseNotes } from './notes.js';
import { buildGuidedRedirect, isDirectAnswerRequest } from './policy.js';

export const USER = 'user';
export const COACH = 'coach';

/* ----------------------------------------------------------- intent --- */

const CONFUSION = [
  /\bi\s*(don'?t|do not|dont)\s*(get|understand|know)\b/i,
  /\bno\s*idea\b/i, /\bi'?m\s*(stuck|lost|confused)\b/i, /\bconfus/i,
  /\bmakes no sense\b/i, /\bcan'?t\s*(work|figure)\b/i, /\bhelp\b/i,
  /^\s*(idk|dunno)\b/i,
];

const CONCEPT_QUESTION = [
  /^\s*(what|what'?s|whats)\s+(is|are|does|do)\b/i,
  /^\s*(how|why|when|where)\s+(do|does|is|are|can|did|would|could)\b/i,
  /\bexplain\b/i, /\bwhat does .+ mean\b/i, /\bcan you tell me\b/i,
];

const TEST_REQUEST = [
  /\b(test|quiz|ask)\s*me\b/i, /\bgive me a question\b/i, /\banother question\b/i,
  /\bnext question\b/i, /\bpractice\b/i,
];

const GREETING = [/^\s*(hi|hey|hello|yo|good (morning|afternoon|evening))\b/i];
const AFFIRM = [/^\s*(yes|yeah|yep|yup|ok|okay|sure|right|correct|i think so)\b[.!]?\s*$/i];
const DENY = [/^\s*(no|nope|nah|not really|not sure)\b[.!]?\s*$/i];

export function classify(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'empty';
  if (isDirectAnswerRequest(raw)) return 'answer_request';
  if (GREETING.some((r) => r.test(raw)) && raw.split(/\s+/).length <= 4) return 'greeting';
  if (TEST_REQUEST.some((r) => r.test(raw))) return 'test_request';
  if (AFFIRM.some((r) => r.test(raw))) return 'affirm';
  if (DENY.some((r) => r.test(raw))) return 'deny';
  if (CONFUSION.some((r) => r.test(raw))) return 'confusion';
  // A question mark plus question words, and short enough not to be an attempt.
  if (CONCEPT_QUESTION.some((r) => r.test(raw)) && raw.split(/\s+/).length < 25) return 'concept_question';
  if (raw.split(/\s+/).length >= 12) return 'explanation';
  return 'short_reply';
}

/* ------------------------------------------------------------- state --- */

export function createConversation(topic = 'this topic') {
  return { topic, turns: [], asked: [], probed: [], hintLevel: 0, awaiting: null };
}

export function say(conversation, role, text, meta = {}) {
  return { ...conversation, turns: [...conversation.turns, { role, text, at: Date.now(), ...meta }] };
}

/** Deterministic variation, so the coach does not repeat one phrasing forever. */
function pick(list, seed) {
  return list[Math.abs(seed) % list.length];
}

function hash(text) {
  let h = 0;
  for (let i = 0; i < String(text).length; i += 1) h = (h * 31 + String(text).charCodeAt(i)) | 0;
  return h;
}

/* ------------------------------------------------------------- moves --- */

const OPENERS = [
  (t) => `Right — ${t}. Don't look anything up yet: tell me what you already know, in whatever words come out.`,
  (t) => `Let's do ${t}. Start anywhere. What is it *for*, in one sentence?`,
  (t) => `${t}, then. Pretend I have never heard of it — where would you start explaining?`,
];

const PROBE_JARGON = [
  (term) => `You used "${term}" there. Unpack that for me — what is it, without the technical word?`,
  (term) => `Stop on "${term}" a second. If I asked a ten-year-old to define that, what would you want them to say?`,
  (term) => `"${term}" is doing a lot of work in that sentence. What does it actually mean?`,
];

const PROBE_WHY = [
  () => `That is what happens. Why does it happen that way?`,
  () => `Good — now the harder half. What would break if that step were missing?`,
  () => `You've described it. Now justify it: what makes that true rather than just customary?`,
];

const PROBE_MISSING = [
  (term) => `Your notes mention "${term}" and you haven't touched it. Where does it fit in what you just said?`,
  (term) => `What about "${term}"? It's in your notes but not in your explanation.`,
];

const PROBE_DEEPEN = [
  (t) => `Where does ${t} stop working? Every idea has an edge, and questions love sitting on it.`,
  (t) => `Give me an example of ${t} — then one where the obvious approach would mislead you.`,
  (t) => `If you had to teach ${t} in sixty seconds, what would you cut first, and what could you never cut?`,
];

const CONFUSION_MOVES = [
  (t) => `Fine — confusion is information. Narrow it for me: is it the words, the steps, or why it matters?`,
  (t) => `Then we start smaller. What is the *one* thing about ${t} you are sure of? We'll build out from there.`,
  (t) => `Being stuck is where the learning is. Tell me the last part that did make sense, and we'll start at the next sentence.`,
];

const SHORT_REPLY_MOVES = [
  () => `Say more than that — a sentence I could disagree with.`,
  () => `Push it further. What makes you say so?`,
  () => `That is a start, not an answer. Keep going.`,
];

/**
 * The coach's reply to one user message.
 *
 * @param {object} options
 * @param {string} options.message  what the learner typed
 * @param {object} options.conversation
 * @param {string} options.notes    the learner's notes on the topic
 * @param {string} options.topic
 * @returns {{text: string, kind: string, redirect?: object, analysis?: object}}
 */
export function respond({ message, conversation, notes = '', topic = 'this topic' } = {}) {
  const intent = classify(message);
  const seed = hash(message) + conversation.turns.length;
  const parsed = parseNotes(notes);
  const terms = extractTerms(parsed, 20).map((t) => t.term);
  const noteWords = new Set((String(notes).toLowerCase().match(/[a-z][a-z-]{3,}/g) || []));

  /**
   * A word worth probing: long enough to be technical, and present in the
   * learner's own notes. Frequency ranking alone misses terms that appear once
   * — which is exactly where the hard vocabulary lives.
   */
  const technicalIn = (text) =>
    (String(text).toLowerCase().match(/[a-z][a-z-]{5,}/g) || [])
      .filter((w) => noteWords.has(w))
      .sort((a, b) => b.length - a.length)[0] || null;

  switch (intent) {
    case 'empty':
      return { kind: intent, text: 'Nothing came through — type something and I will work with it.' };

    case 'answer_request': {
      const redirect = buildGuidedRedirect(message);
      return {
        kind: intent,
        redirect,
        text:
          'Not a chance — and not because I am being difficult. An answer you did not build yourself ' +
          'evaporates the moment the question is worded differently. Let us get you there instead.',
      };
    }

    case 'greeting':
      return { kind: intent, text: pick(OPENERS, seed)(topic) };

    case 'test_request':
      return { kind: intent, text: `Then explain ${topic} to me first — I will find the holes from what you say, and ask about those.` };

    case 'concept_question': {
      // The whole point: a question back, never a definition.
      const known = technicalIn(message) || terms.find((t) => message.toLowerCase().includes(t));
      return {
        kind: intent,
        text: known
          ? `I am not going to define "${known}" for you — that part has to happen in your head. ` +
            `It is in your notes, though. Find the line, read it once, then tell me what it means in words you would use out loud.`
          : `I am not going to define it for you — that part has to happen in your head. ` +
            `What do you already have on it? A half-memory or an outright wrong guess both give us something to work with.`,
      };
    }

    case 'confusion': {
      const next = { hintLevel: Math.min(3, conversation.hintLevel + 1) };
      return { kind: intent, text: pick(CONFUSION_MOVES, seed)(topic), state: next };
    }

    case 'affirm':
      return { kind: intent, text: `Then prove it — say the thing itself, not that you know it.` };

    case 'deny':
      return { kind: intent, text: `Honest, and useful. What is the first part you would need explained before the rest could land?` };

    case 'short_reply':
      return { kind: intent, text: pick(SHORT_REPLY_MOVES, seed)() };

    case 'explanation':
    default: {
      // A real attempt: analyse it and probe the weakest point.
      // A conversational turn is shorter than a written explanation, so the
      // bar for "this is a real attempt" is lower here than in the Feynman tab.
      const analysis = analyseExplanation(message, { notes, topic, minWords: 12 });
      if (!analysis.ok) {
        return { kind: 'short_reply', text: pick(SHORT_REPLY_MOVES, seed)(), analysis };
      }

      // Recital is checked before anything else. If the words are lifted
      // straight from the page, asking them to unpack a term is beside the
      // point — they have not said anything of their own to unpack yet.
      if (analysis.overlapRatio >= 30) {
        return {
          kind: 'probe_recital',
          analysis,
          text:
            `That came out almost word for word from your notes — ${analysis.overlapRatio}% of it. ` +
            `Close them and say it again badly, in your own words. Badly is fine; borrowed is not.`,
        };
      }

      const freshJargon = analysis.jargon.filter((t) => !conversation.probed.includes(t));
      if (freshJargon.length) {
        const term = freshJargon[0];
        return {
          kind: 'probe_jargon',
          text: pick(PROBE_JARGON, seed)(term),
          analysis,
          state: { probed: [...conversation.probed, term] },
        };
      }

      if (analysis.reasoningDensity < 25) {
        return { kind: 'probe_why', text: pick(PROBE_WHY, seed)(), analysis };
      }

      // Prefer a substantial term — being asked "what about 'energy'?" is noise.
      const missing = analysis.missingTerms
        .filter((t) => !conversation.probed.includes(t))
        .sort((a, b) => b.length - a.length)
        .filter((t) => t.length >= 6);
      if (missing.length) {
        const term = missing[0];
        return {
          kind: 'probe_missing',
          text: pick(PROBE_MISSING, seed)(term),
          analysis,
          state: { probed: [...conversation.probed, term] },
        };
      }

      return {
        kind: 'probe_deepen',
        text: `${analysis.score >= 80 ? 'That holds up.' : 'Better.'} ${pick(PROBE_DEEPEN, seed)(topic)}`,
        analysis,
      };
    }
  }
}

/** The coach's opening line for a topic. */
export function opener(topic, notes = '') {
  const parsed = parseNotes(notes);
  const seed = hash(topic);
  const base = pick(OPENERS, seed)(topic);
  if (parsed.isEmpty) {
    return `${base}\n\n(You have no notes saved for this yet — that is fine, but I will not be able to tell whether you are reciting or thinking.)`;
  }
  return base;
}

/**
 * Everything the coach ever says is one of these. Used by the tests to assert,
 * mechanically, that it cannot assert a fact about the subject.
 */
export const REPLY_KINDS = [
  'empty', 'answer_request', 'greeting', 'test_request', 'concept_question',
  'confusion', 'affirm', 'deny', 'short_reply',
  'probe_jargon', 'probe_recital', 'probe_why', 'probe_missing', 'probe_deepen',
];
