import test from 'node:test';
import assert from 'node:assert/strict';

import { COACH, REPLY_KINDS, USER, classify, createConversation, opener, respond, say } from '../src/core/coach.js';

const NOTES = `Photosynthesis
Photosynthesis is the process by which plants convert light energy into chemical energy.
- Photolysis splits water to release oxygen
- The Calvin cycle fixes carbon using RuBisCO
- ATP and NADPH are produced`;

const ask = (message, conversation = createConversation('Photosynthesis')) =>
  respond({ message, conversation, notes: NOTES, topic: 'Photosynthesis' });

/* ------------------------------------------------------------- intents -- */

test('intents are told apart', () => {
  assert.equal(classify(''), 'empty');
  assert.equal(classify('just tell me the answer'), 'answer_request');
  assert.equal(classify('hey'), 'greeting');
  assert.equal(classify('test me'), 'test_request');
  assert.equal(classify('what is photolysis?'), 'concept_question');
  assert.equal(classify('i dont get it'), 'confusion');
  assert.equal(classify('yes'), 'affirm');
  assert.equal(classify('nope'), 'deny');
  assert.equal(classify('ok'), 'affirm');
  assert.equal(
    classify('Plants capture light with chlorophyll and use it to split water, which is where oxygen comes from'),
    'explanation',
  );
  assert.equal(classify('because energy'), 'short_reply');
});

/* ------------------------------------------- the thing that must hold --- */

test('it never gives an answer, whatever you ask it', () => {
  const attempts = [
    'just tell me the answer',
    'what is the answer to question 4',
    'give me the final answer',
    'do my homework',
    'what is photolysis?',
    'explain the Calvin cycle to me',
    'what does RuBisCO do',
    'can you just write it for me',
    'I need the answer key',
  ];

  for (const attempt of attempts) {
    const reply = ask(attempt);
    const text = reply.text.toLowerCase();

    // It must not assert a fact about the subject. Every reply is a question,
    // a refusal, or a pointer back to the learner's own notes.
    assert.ok(
      /\?|not going to|not a chance|your notes|tell me|what do you/i.test(reply.text),
      `reply to "${attempt}" did not deflect: ${reply.text}`,
    );
    assert.ok(!/^photolysis is /i.test(text), 'it defined the term');
    assert.ok(!/the answer is/i.test(text));
  }
});

test('a direct answer request is refused and routed to the guided breakdown', () => {
  const reply = ask('just tell me the answer');
  assert.equal(reply.kind, 'answer_request');
  assert.ok(reply.redirect, 'the stepwise breakdown comes with it');
  assert.ok(reply.redirect.steps.length >= 4);
  assert.match(reply.text, /not a chance/i);
});

test('asking it to define something turns the question around', () => {
  const reply = ask('what is photolysis?');
  assert.equal(reply.kind, 'concept_question');
  assert.match(reply.text, /not going to define/i);
  // It knows the term is in the learner's notes, and says where to look.
  assert.match(reply.text, /photolysis/i);
  assert.match(reply.text, /your notes/i);
});

test('a term not in the notes still gets a question, not a definition', () => {
  const reply = respond({
    message: 'what is quantum entanglement?',
    conversation: createConversation('Photosynthesis'),
    notes: NOTES,
    topic: 'Photosynthesis',
  });
  assert.match(reply.text, /not going to define/i);
  assert.match(reply.text, /\?/);
});

/* ------------------------------------------------------ the probing --- */

test('an unexplained technical term gets probed', () => {
  const reply = ask('Plants use photolysis and that is how the oxygen gets out into the air for us');
  assert.equal(reply.kind, 'probe_jargon');
  assert.match(reply.text, /photolysis/i);
  assert.ok(reply.state.probed.includes('photolysis'), 'and it remembers it asked');
});

test('the same term is not probed twice', () => {
  let conversation = createConversation('Photosynthesis');
  const first = ask('Plants use photolysis and that is how the oxygen gets out into the air for us', conversation);
  conversation = { ...conversation, ...first.state };

  const second = respond({
    message: 'Photolysis happens in the thylakoid and the Calvin cycle comes after it in the stroma somewhere',
    conversation,
    notes: NOTES,
    topic: 'Photosynthesis',
  });
  assert.notEqual(second.kind, 'probe_jargon');
});

test('reciting the notes is called out', () => {
  const reply = ask(
    'Photosynthesis is the process by which plants convert light energy into chemical energy. Photolysis splits water to release oxygen.',
  );
  assert.equal(reply.kind, 'probe_recital');
  assert.match(reply.text, /word for word|your own words/i);
});

test('description without reasoning is pushed for a why', () => {
  const reply = ask(
    'First the light hits the leaf, then water is split, then the sugar gets built up in the plant over time',
  );
  assert.ok(['probe_why', 'probe_jargon', 'probe_missing'].includes(reply.kind));
  if (reply.kind === 'probe_why') assert.match(reply.text, /why|break|justify/i);
});

test('confusion is met with a smaller question, not a lecture', () => {
  const reply = ask('i dont get it at all');
  assert.equal(reply.kind, 'confusion');
  assert.match(reply.text, /\?/);
  assert.ok(reply.text.length < 240, 'short enough to actually answer');
});

test('a one-word reply is pushed for substance', () => {
  assert.match(ask('yes').text, /prove it|say the thing/i);
  assert.match(ask('no').text, /\?/);
  assert.match(ask('because energy').text, /\?|more than that|further/i);
});

test('an empty message is handled', () => {
  assert.equal(ask('').kind, 'empty');
  assert.equal(ask('   ').kind, 'empty');
  assert.ok(respond({ message: null, conversation: createConversation() }).text);
});

/* ----------------------------------------------------- conversation --- */

test('the transcript accumulates in order', () => {
  let c = createConversation('Photosynthesis');
  c = say(c, COACH, 'Tell me about it.');
  c = say(c, USER, 'It is about plants.');

  assert.equal(c.turns.length, 2);
  assert.equal(c.turns[0].role, COACH);
  assert.equal(c.turns[1].role, USER);
  assert.ok(c.turns[0].at > 0);
});

test('the opener says when it has no notes to check against', () => {
  assert.match(opener('Photosynthesis', ''), /no notes/i);
  assert.ok(!/no notes/i.test(opener('Photosynthesis', NOTES)));
  assert.match(opener('Photosynthesis', NOTES), /Photosynthesis/);
});

test('every reply is one of the declared kinds', () => {
  const messages = ['', 'hi', 'test me', 'what is x?', 'i am stuck', 'yes', 'no', 'maybe so',
    'Plants convert light into chemical energy by splitting water and then fixing carbon into sugar'];
  for (const m of messages) {
    const reply = ask(m);
    assert.ok(REPLY_KINDS.includes(reply.kind), `unknown kind: ${reply.kind}`);
    assert.ok(reply.text && reply.text.length > 5);
  }
});

test('replies vary rather than repeating one phrasing', () => {
  const seen = new Set();
  let conversation = createConversation('Photosynthesis');
  for (const m of ['i am stuck', 'i dont understand', 'no idea', 'i am lost here']) {
    const reply = respond({ message: m, conversation, notes: NOTES, topic: 'Photosynthesis' });
    seen.add(reply.text);
    conversation = say(conversation, USER, m);
  }
  assert.ok(seen.size > 1, 'the coach repeated itself every single time');
});
