import test from 'node:test';
import assert from 'node:assert/strict';

import { isDirectAnswerRequest, buildGuidedRedirect, attemptFeedback } from '../src/core/policy.js';

test('flags requests for a finished answer', () => {
  const asks = [
    'just tell me the answer',
    'What is the answer to question 4?',
    'give me the final answer',
    'can you solve this for me',
    'do my homework',
    'Solve my assignment please',
    "what's the answer",
    'write my essay for me',
    'I need the answer key',
    'what should I put for the answer',
  ];

  for (const ask of asks) {
    assert.ok(isDirectAnswerRequest(ask), `should have been flagged: "${ask}"`);
  }
});

test('does not flag genuine learning requests', () => {
  const fine = [
    'explain how integration by parts works',
    'I think the answer involves photosynthesis because light is absorbed — am I on the right track?',
    'why does the Calvin cycle need ATP?',
    'can you test me on SQL joins',
    'here are my notes on enzymes',
    'what is a hash table?',
    'I answered 42 but I am not sure why',
    'help me understand the difference between mitosis and meiosis',
  ];

  for (const message of fine) {
    assert.ok(!isDirectAnswerRequest(message), `should NOT have been flagged: "${message}"`);
  }
});

test('the redirect guides rather than answering', () => {
  const redirect = buildGuidedRedirect('just tell me the answer to question 4 about photosynthesis');

  assert.equal(redirect.blocked, true);
  assert.ok(redirect.steps.length >= 4, 'the problem is broken into steps');
  assert.ok(redirect.prompts.length >= 2, 'guiding questions are offered');

  for (const step of redirect.steps) {
    assert.ok(step.title && step.detail.length > 20);
  }

  // The redirect must ask the learner to attempt, not present a solution.
  const text = JSON.stringify(redirect).toLowerCase();
  assert.ok(text.includes('your own words') || text.includes('attempt'), 'pushes the learner to attempt');
});

test('attempt feedback confirms direction without supplying content', () => {
  for (const quality of ['strong', 'partial', 'weak']) {
    const feedback = attemptFeedback(quality);
    assert.ok(feedback.verdict.length > 0);
    assert.ok(feedback.note.length > 20);
  }

  assert.match(attemptFeedback('strong').verdict, /on track/i);
  assert.match(attemptFeedback('partial').verdict, /part/i);
  assert.match(attemptFeedback('weak').verdict, /not yet/i);
});

test('empty and non-string input is handled', () => {
  for (const input of ['', null, undefined, 0]) {
    assert.equal(isDirectAnswerRequest(input), false);
  }
  assert.doesNotThrow(() => buildGuidedRedirect(''));
});
