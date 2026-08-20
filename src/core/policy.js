/**
 * Homework / direct-answer policy.
 *
 * The app never hands over a finished answer. This module spots requests that
 * are really "do it for me" and turns them into a guided breakdown instead.
 * It is deliberately conservative: it flags the *ask*, not the topic, so
 * "explain how integration by parts works" passes while "solve question 4"
 * does not.
 */

const DIRECT_ANSWER_PATTERNS = [
  /\b(what|which)\s+is\s+the\s+(correct\s+)?answer\b/i,
  /\bgive\s+me\s+the\s+(final\s+)?(answer|solution|result)\b/i,
  /\b(just\s+)?tell\s+me\s+the\s+answer\b/i,
  /\bwhat'?s\s+the\s+answer\b/i,
  /\b(solve|answer|do|complete|finish)\s+(this|these|it|that|my|the)\s+(for\s+me\b|.*\b(homework|assignment|worksheet|problem\s*set|question\s*\d+|q\s*\d+))/i,
  /\bdo\s+my\s+(homework|assignment|coursework|essay)\b/i,
  /\bwrite\s+(my|the)\s+(essay|assignment|answer|report)\s+for\s+me\b/i,
  /\banswer\s+key\b/i,
  /\bshow\s+me\s+the\s+worked\s+solution\s+to\s+(my|this|question)\b/i,
  /\bwhat\s+should\s+i\s+(put|write)\s+(down\s+)?(for|as)\s+(the\s+)?answer\b/i,
];

/** True when the message is asking to be handed a finished answer. */
export function isDirectAnswerRequest(text) {
  const input = String(text || '');
  return DIRECT_ANSWER_PATTERNS.some((pattern) => pattern.test(input));
}

/**
 * Pull the substantive noun phrase out of the request so the redirect can name
 * the actual topic rather than answering in the abstract.
 */
function guessSubject(text) {
  const cleaned = String(text || '')
    .replace(/[?.!]+$/g, '')
    .replace(
      /\b(please|can you|could you|just|for me|the answer to|answer to|solve|give me|tell me|what is|whats|what's|do|my|homework|assignment)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 2 ? cleaned : 'this problem';
}

/**
 * Build the guided reply used everywhere a direct answer was requested.
 * Returns structure, not prose, so each surface can render it its own way.
 */
export function buildGuidedRedirect(text) {
  const subject = guessSubject(text);
  return {
    blocked: true,
    headline: 'I will not hand over the answer — but I will get you to it.',
    reason:
      'An answer you did not build yourself disappears the moment the question changes. ' +
      'Here is the same problem, broken into steps you can actually own.',
    steps: [
      {
        title: '1. Restate it in your own words',
        detail: `Write out what ${subject} is actually asking for, and what you are given. If you cannot state the goal in one sentence, that is the first gap.`,
      },
      {
        title: '2. Name the underlying concept',
        detail: 'Which idea, rule, or method is this question testing? Questions are rarely about the numbers in front of you — they are about a technique.',
      },
      {
        title: '3. Find the nearest worked example',
        detail: 'Look for a solved example of the same *type* in your notes. Do not copy it — identify the step-by-step shape it follows.',
      },
      {
        title: '4. Attempt step one only',
        detail: 'Do the first step and stop. Bring it back here and I will tell you whether your reasoning is on track.',
      },
      {
        title: '5. Reflect',
        detail: 'Once you have it: what would you look for to recognise this question type again?',
      },
    ],
    prompts: [
      `What do you already know about ${subject}?`,
      'Where exactly does your reasoning stall — the setup, the method, or the arithmetic?',
      'What would you try if you had to guess at the approach?',
    ],
  };
}

/**
 * Feedback on a learner's attempt. Confirms direction only — never states the
 * answer, never completes the step for them.
 */
export function attemptFeedback(quality) {
  switch (quality) {
    case 'strong':
      return {
        verdict: 'On track',
        note: 'Your reasoning is heading the right way. Carry it through to the next step and check the units/edge cases as you go.',
      };
    case 'partial':
      return {
        verdict: 'Partly there',
        note: 'Part of this is right, but a piece of the method is missing. Re-read the step where you moved from the given information to your first line of working — what justified that move?',
      };
    default:
      return {
        verdict: 'Not yet',
        note: 'This is not the route the question wants. Go back to the concept it is testing and find a worked example of the same type before trying again.',
      };
  }
}
